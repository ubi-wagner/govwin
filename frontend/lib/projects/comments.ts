/**
 * The conversation on a project.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * Until now a project carried exactly one human decision — a tenant_admin accepting a deliverable.
 * Everything else it knew was a fact with no discussion attached: a date moved and nobody could
 * say why, a deliverable was rejected in a meeting and the row never heard about it. Automation on
 * top of that produces mail nobody can reply to, which is why this comes before more automation.
 *
 * ── OPEN TO EVERYONE ON THE PROJECT ──────────────────────────────────────────────────────────
 * Posting, replying and resolving are all gated on `canAccessProject` and nothing more. A comment
 * thread only a manager may close is a manager's notebook, the same argument that keeps ticking a
 * task off open to any member. Editing is narrower — only the author, because rewriting somebody
 * else's words is a different act entirely — and there is no delete: a resolved thread stays
 * readable, in keeping with docs/ARCHIVABLE_CONTRACT.md.
 *
 * ── THE MENTION IS THE POINT ─────────────────────────────────────────────────────────────────
 * A comment nobody is told about is a diary. `@email` resolves against the project ROSTER (never
 * the tenant directory) and raises a real platform ToDo plus one email through the single seam, so
 * it lands where every other piece of work in this product lands. Resolving the thread closes
 * those ToDos — a mention is "please look at this", and it is done when the conversation is.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import type { Role } from '@/lib/rbac';
import { canAccessProject, listAssignees, type ProjectActor } from './access';
import { resolveMentions } from './mentions';
import { closeCommentTodos } from './todos';
import type { Fail, Ok } from './project';

/** What a comment can be about. Closed vocabulary, matching mig 222's CHECK. */
export const COMMENT_ENTITIES = ['project', 'milestone', 'task', 'deliverable'] as const;
export type CommentEntity = (typeof COMMENT_ENTITIES)[number];

export function isCommentEntity(v: unknown): v is CommentEntity {
  return typeof v === 'string' && (COMMENT_ENTITIES as readonly string[]).includes(v);
}

/** The table each anchor validates against. There is no FK — see migration 222. */
const ENTITY_TABLE: Record<Exclude<CommentEntity, 'project'>, string> = {
  milestone: 'project_milestones',
  task: 'project_milestone_tasks',
  deliverable: 'project_deliverables',
};

export interface ProjectComment {
  id: string;
  projectId: string;
  entityType: CommentEntity;
  entityId: string | null;
  parentId: string | null;
  body: string;
  authorUserId: string;
  authorEmail?: string | null;
  authorName?: string | null;
  mentions: string[];
  resolvedAt: string | null;
  resolvedBy: string | null;
  editedAt: string | null;
  createdAt: string | null;
}

// The column list is repeated in each statement rather than hoisted. `lib/db.ts`'s `sql` is a
// Proxy that routes only the tagged-template CALL, so a hoisted fragment is a Promise, not SQL.

/**
 * Every comment on a project, oldest first.
 *
 * One read for the whole project rather than one per anchor: the workspace renders milestones,
 * tasks and deliverables together, so a per-entity route would turn one page into thirty requests.
 */
export async function listProjectComments(
  tenantId: string,
  projectId: string,
): Promise<ProjectComment[]> {
  try {
    return await sql<ProjectComment[]>`
      SELECT c.id, c.project_id, c.entity_type, c.entity_id, c.parent_id, c.body,
             c.author_user_id, c.mentions, c.resolved_at, c.resolved_by, c.edited_at, c.created_at,
             u.email AS author_email, u.name AS author_name
        FROM project_comments c
        LEFT JOIN users u ON u.id = c.author_user_id
       WHERE c.project_id = ${projectId}::uuid AND c.tenant_id = ${tenantId}::uuid
       ORDER BY c.created_at ASC`;
  } catch (err) {
    console.error('[projects/comments] listProjectComments failed:', err);
    return [];
  }
}

/** The platform actor shape `lib/tasks` wants, from the project actor we hold. */
function asTaskActor(actor: ProjectActor) {
  return { id: actor.userId, email: null, role: actor.role as Role, tenantId: actor.tenantId };
}

export interface PostResult {
  comment: ProjectComment;
  /** Emails that resolved to somebody on the project and were notified. */
  notified: string[];
  /** `@tokens` that matched nobody here. Returned so the UI can say so rather than let the author
   *  assume they were heard — the failure mode a mention feature quietly has. */
  unmatched: string[];
}

export async function postComment(
  actor: ProjectActor,
  projectId: string,
  input: { entityType?: string; entityId?: string | null; parentId?: string | null; body?: string },
): Promise<Ok<PostResult> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const body = (input.body ?? '').trim();
  if (!body || body.length > 10_000) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'A comment of 1–10,000 characters is required',
    };
  }
  const entityType = input.entityType ?? 'project';
  if (!isCommentEntity(entityType)) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `entityType must be one of: ${COMMENT_ENTITIES.join(', ')}`,
    };
  }
  // Derived, not taken twice. Mig 222's CHECK binds the pair, and two inputs that must agree
  // eventually will not — the same rule `scope` follows on a task.
  const entityId = entityType === 'project' ? null : (input.entityId ?? null);
  if (entityType !== 'project' && !entityId) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `A comment on a ${entityType} has to say which one`,
    };
  }

  try {
    // ── FK-BEFORE-WRITE, SCOPED TO THIS PROJECT ─────────────────────────────────────────────
    // There is no database FK on `entity_id` (it points at four tables), so this is the only thing
    // standing between a comment and another contract's milestone. Every other project write does
    // the same check for the same reason.
    if (entityId) {
      const table = ENTITY_TABLE[entityType as Exclude<CommentEntity, 'project'>];
      const rows = table === 'project_deliverables'
        // A deliverable reaches its project THROUGH its milestone; it has no project_id of its own.
        ? await sql<{ id: string }[]>`
            SELECT d.id FROM project_deliverables d
              JOIN project_milestones m ON m.id = d.milestone_id
             WHERE d.id = ${entityId}::uuid AND m.project_id = ${projectId}::uuid
               AND d.tenant_id = ${actor.tenantId}::uuid LIMIT 1`
        : table === 'project_milestones'
          ? await sql<{ id: string }[]>`
              SELECT id FROM project_milestones
               WHERE id = ${entityId}::uuid AND project_id = ${projectId}::uuid
                 AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`
          : await sql<{ id: string }[]>`
              SELECT id FROM project_milestone_tasks
               WHERE id = ${entityId}::uuid AND project_id = ${projectId}::uuid
                 AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (rows.length === 0) {
        return {
          ok: false, status: 400, code: 'VALIDATION_ERROR',
          error: `That ${entityType} does not belong to this project`,
        };
      }
    }

    // ── THREADS ARE ONE LEVEL ───────────────────────────────────────────────────────────────
    // A reply to a reply attaches to the same ROOT. Normalised here rather than refused, because
    // "you may not reply to that" is a strange thing to tell somebody mid-conversation, and an
    // arbitrarily deep tree is a reading problem long before it is a data problem.
    let parentId: string | null = null;
    if (input.parentId) {
      const [parent] = await sql<{ id: string; parentId: string | null }[]>`
        SELECT id, parent_id FROM project_comments
         WHERE id = ${input.parentId}::uuid AND project_id = ${projectId}::uuid
           AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!parent) {
        return { ok: false, status: 404, error: 'That comment is not on this project', code: 'NOT_FOUND' };
      }
      parentId = parent.parentId ?? parent.id;
    }

    // ── MENTIONS RESOLVE AGAINST THE ROSTER, NEVER THE DIRECTORY ────────────────────────────
    const roster = await listAssignees(actor.tenantId, projectId);
    const mentions = resolveMentions(body, roster, actor.userId);

    const [row] = await sql<ProjectComment[]>`
      INSERT INTO project_comments
        (tenant_id, project_id, entity_type, entity_id, parent_id, body, author_user_id, mentions)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${entityType}, ${entityId}, ${parentId},
         ${body}, ${actor.userId}::uuid, ${mentions.userIds}::uuid[])
      RETURNING id, project_id, entity_type, entity_id, parent_id, body, author_user_id,
                mentions, resolved_at, resolved_by, edited_at, created_at`;
    if (!row) return { ok: false, status: 500, error: 'Failed to post the comment', code: 'DB_ERROR' };

    await emitEventSingle({
      namespace: 'project',
      type: 'comment.posted',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, commentId: row.id, entityType, entityId,
        threaded: Boolean(parentId), mentioned: mentions.userIds.length,
        excerpt: body.slice(0, 120),
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.comment_posted',
      entityType: 'project_comment', entityId: row.id,
      metadata: { projectId, anchor: entityType, mentioned: mentions.userIds.length },
    });

    // Best-effort, after the comment is safely saved: a notification that fails must not lose
    // somebody's words.
    if (mentions.userIds.length) {
      await notifyMentions(actor, projectId, row.id, body, mentions.userIds).catch((e) => {
        console.error('[projects/comments] notifyMentions failed:', e);
      });
    }

    return { ok: true, data: { comment: row, notified: mentions.matched, unmatched: mentions.unmatched } };
  } catch (err) {
    console.error('[projects/comments] postComment failed:', err);
    return { ok: false, status: 500, error: 'Failed to post the comment', code: 'DB_ERROR' };
  }
}

/**
 * Tell the people who were mentioned — through the two seams the product already has.
 *
 * A ToDo, because `/todos` and the bell are where this product's users look and a second inbox is
 * the thing G1 refused to build. And one email per person through `system:notification.requested`,
 * never a direct send, so suppression and the ledger stay the CRM's single implementation.
 *
 * The ToDo points at the COMMENT, so resolving the thread can find and close exactly these.
 */
async function notifyMentions(
  actor: ProjectActor,
  projectId: string,
  commentId: string,
  body: string,
  userIds: string[],
): Promise<void> {
  const [proj] = await sql<{ name: string }[]>`
    SELECT name FROM projects WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
  const projectName = proj?.name ?? 'a project';

  for (const userId of userIds) {
    const res = await createTask({
      actor: asTaskActor(actor),
      tenantId: actor.tenantId,
      assigneeUserId: userId,
      assigneeRole: null,
      taskType: 'project_comment',
      title: `You were mentioned on ${projectName}`,
      description: body.slice(0, 300),
      entityType: 'project_comment',
      entityId: commentId,
      // NO due date and NO nudge schedule. A mention is a request to look, not a deadline, and
      // chasing somebody about a comment on a cadence is how a queue trains people to ignore it.
      dueAt: null,
      params: { projectId, commentId },
    });
    if (!res.ok) console.error('[projects/comments] mention ToDo refused:', res.error);

    await emitEventSingle({
      namespace: 'system',
      type: 'notification.requested',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        channel: 'email',
        template: 'project_comment_mention',
        tenant_ids: [actor.tenantId],
        assigneeUserId: userId,
        project: projectName,
        projectId,
        commentId,
        excerpt: body.slice(0, 300),
      },
    });
  }
}

/**
 * Resolve (or reopen) a thread.
 *
 * Open to anyone on the project. Resolving closes the mention ToDos standing against it, because a
 * finished conversation must not leave work in somebody's queue — the same sweep-up
 * `markMilestoneMet` does for a closed phase.
 */
export async function setCommentResolved(
  actor: ProjectActor,
  projectId: string,
  commentId: string,
  resolved: boolean,
): Promise<Ok<ProjectComment> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Comment not found', code: 'NOT_FOUND' };
  }
  try {
    // Plain JS values, never a nested tagged template in a value position — that is a Promise, not
    // a fragment, and postgres.js throws serialising it.
    const at = resolved ? new Date() : null;
    const by = resolved ? actor.userId : null;

    // Compare-and-swap on the current state, so a double-click cannot stamp twice or emit twice.
    const [row] = await sql<ProjectComment[]>`
      UPDATE project_comments
         SET resolved_at = ${at}, resolved_by = ${by}, updated_at = now()
       WHERE id = ${commentId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid
         AND (resolved_at IS NULL) = ${resolved}
      RETURNING id, project_id, entity_type, entity_id, parent_id, body, author_user_id,
                mentions, resolved_at, resolved_by, edited_at, created_at`;
    if (!row) {
      const [exists] = await sql<{ id: string }[]>`
        SELECT id FROM project_comments
         WHERE id = ${commentId}::uuid AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!exists) return { ok: false, status: 404, error: 'Comment not found', code: 'NOT_FOUND' };
      return {
        ok: false, status: 409, code: 'ALREADY_IN_STATE',
        error: resolved ? 'That comment is already resolved.' : 'That comment is not resolved.',
      };
    }

    // The thread is answered, so the "please look at this" is done — whoever it was addressed to.
    // Deliberately NOT `completeTask`: that asks whether this PERSON may complete somebody's task
    // and answers no, which would leave the mention in the mentioned person's queue forever. See
    // `retireProjectedTodos` in lib/projects/todos.ts.
    if (resolved) await closeCommentTodos(actor, commentId, { via: 'thread resolved' });

    await emitEventSingle({
      namespace: 'project',
      type: resolved ? 'comment.resolved' : 'comment.reopened',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, commentId, entityType: row.entityType, entityId: row.entityId },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId,
      action: resolved ? 'project.comment_resolved' : 'project.comment_reopened',
      entityType: 'project_comment', entityId: commentId, metadata: { projectId },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/comments] setCommentResolved failed:', err);
    return { ok: false, status: 500, error: 'Failed to update the comment', code: 'DB_ERROR' };
  }
}

/**
 * Edit your own words.
 *
 * The AUTHOR only — rewriting somebody else's comment is a different act, and one this product has
 * no reason to allow. `edited_at` is stamped so an edited comment never silently claims to be what
 * was originally said.
 *
 * New mentions in an edit ARE notified; removed ones are not un-notified, because a person already
 * told to look at something cannot be untold.
 */
export async function editComment(
  actor: ProjectActor,
  projectId: string,
  commentId: string,
  body: string,
): Promise<Ok<PostResult> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Comment not found', code: 'NOT_FOUND' };
  }
  const next = (body ?? '').trim();
  if (!next || next.length > 10_000) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'A comment of 1–10,000 characters is required',
    };
  }
  try {
    const [before] = await sql<{ authorUserId: string; mentions: string[] }[]>`
      SELECT author_user_id, mentions FROM project_comments
       WHERE id = ${commentId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!before) return { ok: false, status: 404, error: 'Comment not found', code: 'NOT_FOUND' };
    if (before.authorUserId !== actor.userId) {
      return {
        ok: false, status: 403, code: 'FORBIDDEN',
        error: 'Only the author can edit a comment. Reply to it instead.',
      };
    }

    const roster = await listAssignees(actor.tenantId, projectId);
    const mentions = resolveMentions(next, roster, actor.userId);

    const [row] = await sql<ProjectComment[]>`
      UPDATE project_comments
         SET body = ${next}, mentions = ${mentions.userIds}::uuid[],
             edited_at = now(), updated_at = now()
       WHERE id = ${commentId}::uuid AND tenant_id = ${actor.tenantId}::uuid
      RETURNING id, project_id, entity_type, entity_id, parent_id, body, author_user_id,
                mentions, resolved_at, resolved_by, edited_at, created_at`;
    if (!row) return { ok: false, status: 404, error: 'Comment not found', code: 'NOT_FOUND' };

    // Only the NEWLY mentioned. Re-notifying everyone on every typo fix is how a mention becomes
    // something people mute.
    const fresh = mentions.userIds.filter((id) => !(before.mentions ?? []).includes(id));
    if (fresh.length) {
      await notifyMentions(actor, projectId, commentId, next, fresh).catch((e) => {
        console.error('[projects/comments] notifyMentions (edit) failed:', e);
      });
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'comment.edited',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, commentId, newlyMentioned: fresh.length },
    });
    return { ok: true, data: { comment: row, notified: mentions.matched, unmatched: mentions.unmatched } };
  } catch (err) {
    console.error('[projects/comments] editComment failed:', err);
    return { ok: false, status: 500, error: 'Failed to edit the comment', code: 'DB_ERROR' };
  }
}
