/**
 * "I looked at this and it is not right, because X."
 *
 * ── THE STATE THAT DID NOT EXIST ─────────────────────────────────────────────────────────────
 * A deliverable was either accepted or silently not, so a rejection happened in a meeting and the
 * row went on looking like something nobody had got round to. "Not yet accepted" and "rejected, for
 * these reasons" are different states, and only one of them tells the next person what to do.
 *
 * ── APPROVING IS NOT ACCEPTING ───────────────────────────────────────────────────────────────
 * The separation this whole module runs on. Uploading is not accepting, authoring is not accepting,
 * and a reviewer approving is not accepting: a review says an internal reader is satisfied, while
 * `accepted_at` says the obligation is met — a different claim, made by a tenant_admin, and the one
 * that closes a CLIN.
 *
 * What a review DOES is gate that act (`blockingReview` below): open means it is still being looked
 * at, rejected means somebody said no and nothing has superseded it. A deliverable that was never
 * sent for review accepts exactly as it did before, so nothing that worked stops working.
 *
 * ── WHO MAY DO WHAT ──────────────────────────────────────────────────────────────────────────
 * REQUESTING is open to anyone on the project — asking a colleague to check something is
 * collaboration, the same act as an @mention. DECIDING belongs to the named reviewer, or to a
 * tenant_admin, because a gate anyone can open is not a gate. WITHDRAWING belongs to whoever asked
 * or a tenant_admin, so a request made in error cannot hold a deliverable hostage.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import type { Role } from '@/lib/rbac';
import { canAccessProject, canAssign, listAssignees, type ProjectActor } from './access';
import { retireTodosByEntity } from './todos';
import { isoDate } from './dates';
import type { Fail, Ok } from './project';

export const REVIEW_ENTITIES = ['deliverable', 'document', 'milestone'] as const;
export type ReviewEntity = (typeof REVIEW_ENTITIES)[number];

export function isReviewEntity(v: unknown): v is ReviewEntity {
  return typeof v === 'string' && (REVIEW_ENTITIES as readonly string[]).includes(v);
}

export interface ProjectReview {
  id: string;
  projectId: string;
  entityType: ReviewEntity;
  entityId: string;
  requestedBy: string;
  reviewerUserId: string | null;
  reviewerRole: string | null;
  reviewerEmail?: string | null;
  note: string | null;
  dueOn: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string | null;
}

/** Every review on a project, newest first. One read; the workspace renders them all together. */
export async function listProjectReviews(
  tenantId: string,
  projectId: string,
): Promise<ProjectReview[]> {
  try {
    return await sql<ProjectReview[]>`
      SELECT r.id, r.project_id, r.entity_type, r.entity_id, r.requested_by,
             r.reviewer_user_id, r.reviewer_role, u.email AS reviewer_email,
             r.note, r.due_on, r.status, r.decided_by, r.decided_at, r.reason, r.created_at
        FROM project_reviews r
        LEFT JOIN users u ON u.id = r.reviewer_user_id
       WHERE r.project_id = ${projectId}::uuid AND r.tenant_id = ${tenantId}::uuid
       ORDER BY r.created_at DESC`;
  } catch (err) {
    console.error('[projects/reviews] listProjectReviews failed:', err);
    return [];
  }
}

/**
 * The review standing in the way of accepting something, or null.
 *
 * Only the LATEST review counts. A rejection that a fresh request superseded is history, not a
 * standing objection — that is what makes reject → fix → re-request → approve a loop rather than a
 * dead end.
 */
export async function blockingReview(
  tenantId: string,
  entityType: ReviewEntity,
  entityId: string,
): Promise<{ status: string; reason: string | null } | null> {
  try {
    const [latest] = await sql<{ status: string; reason: string | null }[]>`
      SELECT status, reason FROM project_reviews
       WHERE entity_type = ${entityType} AND entity_id = ${entityId}::uuid
         AND tenant_id = ${tenantId}::uuid
       ORDER BY created_at DESC LIMIT 1`;
    if (!latest) return null;
    return latest.status === 'pending' || latest.status === 'rejected' ? latest : null;
  } catch (err) {
    // A gate that cannot read its own state must not silently open. Reporting no blocker here
    // would turn a database blip into an acceptance nobody reviewed.
    console.error('[projects/reviews] blockingReview failed:', err);
    return { status: 'unknown', reason: null };
  }
}

function asTaskActor(actor: ProjectActor) {
  return { id: actor.userId, email: null, role: actor.role as Role, tenantId: actor.tenantId };
}

/** The table each anchor validates against — there is no FK on `entity_id` (it points at three). */
async function anchorExists(
  tenantId: string,
  projectId: string,
  entityType: ReviewEntity,
  entityId: string,
): Promise<boolean> {
  if (entityType === 'deliverable') {
    const rows = await sql<{ id: string }[]>`
      SELECT d.id FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
       WHERE d.id = ${entityId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${tenantId}::uuid LIMIT 1`;
    return rows.length > 0;
  }
  if (entityType === 'milestone') {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM project_milestones
       WHERE id = ${entityId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    return rows.length > 0;
  }
  // A document reaches the project through the deliverable it backs; a tenant document that is not
  // on this project has no business being reviewed here.
  const rows = await sql<{ id: string }[]>`
    SELECT d.id FROM project_deliverables d
      JOIN project_milestones m ON m.id = d.milestone_id
     WHERE d.document_id = ${entityId}::uuid AND m.project_id = ${projectId}::uuid
       AND d.tenant_id = ${tenantId}::uuid LIMIT 1`;
  return rows.length > 0;
}

export async function requestReview(
  actor: ProjectActor,
  projectId: string,
  input: {
    entityType?: string; entityId?: string;
    reviewerUserId?: string | null; reviewerRole?: string | null;
    note?: string | null; dueOn?: string | null;
  },
): Promise<Ok<ProjectReview> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  if (!isReviewEntity(input.entityType) || !input.entityId) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `entityType must be one of: ${REVIEW_ENTITIES.join(', ')}, with an entityId`,
    };
  }
  const reviewerUserId = input.reviewerUserId ?? null;
  const reviewerRole = reviewerUserId ? null : (input.reviewerRole ?? null);
  if (!reviewerUserId && !reviewerRole) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'Say who should review it — a review addressed to nobody sits forever looking like work in hand.',
    };
  }
  if (reviewerRole && !['tenant_admin', 'tenant_user'].includes(reviewerRole)) {
    return { ok: false, status: 400, error: 'reviewerRole must be tenant_admin or tenant_user', code: 'VALIDATION_ERROR' };
  }
  const due = input.dueOn ?? null;
  if (due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return { ok: false, status: 400, error: 'dueOn must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }

  try {
    if (!(await anchorExists(actor.tenantId, projectId, input.entityType, input.entityId))) {
      return {
        ok: false, status: 400, code: 'VALIDATION_ERROR',
        error: `That ${input.entityType} does not belong to this project`,
      };
    }
    // The same boundary task assignment enforces: a reviewer who cannot open the project would
    // never see the request, and granting access as a side effect of a review form would make the
    // boundary stop meaning anything.
    if (reviewerUserId) {
      const roster = await listAssignees(actor.tenantId, projectId);
      if (!roster.some((a) => a.userId === reviewerUserId)) {
        return {
          ok: false, status: 409, code: 'NOT_ON_PROJECT',
          error: 'That person is not on this project, so they would never see the request. '
            + 'Add them to the project first.',
        };
      }
    }

    const [row] = await sql<ProjectReview[]>`
      INSERT INTO project_reviews
        (tenant_id, project_id, entity_type, entity_id, requested_by,
         reviewer_user_id, reviewer_role, note, due_on)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${input.entityType}, ${input.entityId}::uuid,
         ${actor.userId}::uuid, ${reviewerUserId}, ${reviewerRole},
         ${(input.note ?? '').trim() || null}, ${due}::date)
      RETURNING id, project_id, entity_type, entity_id, requested_by, reviewer_user_id,
                reviewer_role, note, due_on, status, decided_by, decided_at, reason, created_at`;
    if (!row) return { ok: false, status: 500, error: 'Failed to request the review', code: 'DB_ERROR' };

    await emitEventSingle({
      namespace: 'project',
      type: 'review.requested',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, reviewId: row.id, entityType: input.entityType, entityId: input.entityId,
        reviewer: reviewerUserId ?? reviewerRole, dueOn: due,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.review_requested',
      entityType: 'project_review', entityId: row.id,
      metadata: { projectId, anchor: input.entityType, reviewer: reviewerUserId ?? reviewerRole },
    });

    await notifyReviewer(actor, projectId, row).catch((e) => {
      console.error('[projects/reviews] notifyReviewer failed:', e);
    });
    return { ok: true, data: row };
  } catch (err) {
    // The partial unique index is the gate's own rule, so its violation gets its own sentence
    // rather than a 500: three open reviews on one thing is three people believing they decide.
    if ((err as { code?: string })?.code === '23505') {
      return {
        ok: false, status: 409, code: 'REVIEW_ALREADY_OPEN',
        error: 'That already has a review open. Decide or withdraw it before asking again.',
      };
    }
    console.error('[projects/reviews] requestReview failed:', err);
    return { ok: false, status: 500, error: 'Failed to request the review', code: 'DB_ERROR' };
  }
}

/** The reviewer's ToDo and one email, through the seams the product already has. */
async function notifyReviewer(
  actor: ProjectActor,
  projectId: string,
  review: ProjectReview,
): Promise<void> {
  const [proj] = await sql<{ name: string }[]>`
    SELECT name FROM projects WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
  const projectName = proj?.name ?? 'a project';
  const due = isoDate(review.dueOn);

  const res = await createTask({
    actor: asTaskActor(actor),
    tenantId: actor.tenantId,
    assigneeUserId: review.reviewerUserId,
    assigneeRole: review.reviewerUserId ? null : review.reviewerRole,
    taskType: 'project_review',
    title: `Review a ${review.entityType} on ${projectName}`,
    description: review.note ?? 'Approve it, or reject it with a reason.',
    entityType: 'project_review',
    entityId: review.id,
    // A review CAN carry a due date, unlike a mention — somebody is waiting on the answer, and
    // that is exactly the case a nudge exists for.
    dueAt: due ? `${due}T17:00:00Z` : null,
    ...(due ? { nudgeDays: [3, 1, 0] } : {}),
    params: { projectId, reviewId: review.id },
  });
  if (!res.ok) console.error('[projects/reviews] review ToDo refused:', res.error);

  await emitEventSingle({
    namespace: 'system',
    type: 'notification.requested',
    actor: userActor(actor.userId),
    tenantId: actor.tenantId,
    payload: {
      channel: 'email',
      template: 'project_review_requested',
      tenant_ids: [actor.tenantId],
      assigneeUserId: review.reviewerUserId,
      project: projectName,
      projectId,
      reviewId: review.id,
      kind: review.entityType,
      note: review.note,
      dueOn: due,
    },
  });
}

/**
 * Decide a review: approve, reject with a reason, or withdraw the request.
 *
 * The named reviewer or a tenant_admin decides; the requester or a tenant_admin withdraws. A gate
 * anyone can open is not a gate — and a request made in error must not be able to hold a
 * deliverable hostage, which is what withdrawal is for.
 */
export async function decideReview(
  actor: ProjectActor,
  projectId: string,
  reviewId: string,
  decision: 'approved' | 'rejected' | 'withdrawn',
  reason?: string | null,
): Promise<Ok<ProjectReview> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Review not found', code: 'NOT_FOUND' };
  }
  if (!['approved', 'rejected', 'withdrawn'].includes(decision)) {
    return { ok: false, status: 400, error: "decision must be approved, rejected or withdrawn", code: 'VALIDATION_ERROR' };
  }
  const why = (reason ?? '').trim();
  if (decision === 'rejected' && !why) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'Say what is wrong with it. A rejection with no reason leaves the next person guessing, '
        + 'which is the thing this replaces.',
    };
  }

  try {
    const [review] = await sql<ProjectReview[]>`
      SELECT id, project_id, entity_type, entity_id, requested_by, reviewer_user_id, reviewer_role,
             note, due_on, status, decided_by, decided_at, reason, created_at
        FROM project_reviews
       WHERE id = ${reviewId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!review) return { ok: false, status: 404, error: 'Review not found', code: 'NOT_FOUND' };

    const isAdmin = canAssign(actor.role);
    const isReviewer = review.reviewerUserId
      ? review.reviewerUserId === actor.userId
      // A role-addressed review is anyone's to answer, the way a role-assigned ToDo is.
      : review.reviewerRole === actor.role || isAdmin;
    const mayDecide = decision === 'withdrawn'
      ? (review.requestedBy === actor.userId || isAdmin)
      : (isReviewer || isAdmin);
    if (!mayDecide) {
      return {
        ok: false, status: 403, code: 'FORBIDDEN',
        error: decision === 'withdrawn'
          ? 'Only whoever asked for the review, or a tenant admin, can withdraw it.'
          : 'Only the reviewer, or a tenant admin, can decide a review.',
      };
    }

    // Plain values — a nested tagged template in a value position is a Promise, not a fragment.
    const decidedAt = new Date();
    const [row] = await sql<ProjectReview[]>`
      UPDATE project_reviews
         SET status = ${decision}, decided_by = ${actor.userId}::uuid, decided_at = ${decidedAt},
             reason = ${why || null}, updated_at = now()
       WHERE id = ${reviewId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND status = 'pending'
      RETURNING id, project_id, entity_type, entity_id, requested_by, reviewer_user_id,
                reviewer_role, note, due_on, status, decided_by, decided_at, reason, created_at`;
    if (!row) {
      return {
        ok: false, status: 409, code: 'ALREADY_DECIDED',
        error: `That review is already ${review.status}.`,
      };
    }

    // The question was answered, so the request is done — whoever's queue it was in.
    await retireTodosByEntity(actor, 'project_review', reviewId, { via: `review ${decision}` });

    await emitEventSingle({
      namespace: 'project',
      type: decision === 'approved' ? 'review.approved'
        : decision === 'rejected' ? 'review.rejected' : 'review.withdrawn',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, reviewId, entityType: row.entityType, entityId: row.entityId,
        ...(why ? { reason: why } : {}),
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: `project.review_${decision}`,
      entityType: 'project_review', entityId: reviewId,
      metadata: { projectId, anchor: row.entityType, ...(why ? { reason: why } : {}) },
    });

    // Tell whoever asked. A decision nobody hears about is the meeting this replaces.
    if (decision !== 'withdrawn' && review.requestedBy !== actor.userId) {
      const [proj] = await sql<{ name: string }[]>`
        SELECT name FROM projects WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
      await emitEventSingle({
        namespace: 'system',
        type: 'notification.requested',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: {
          channel: 'email',
          template: 'project_review_decided',
          tenant_ids: [actor.tenantId],
          assigneeUserId: review.requestedBy,
          project: proj?.name ?? 'a project',
          projectId,
          reviewId,
          kind: row.entityType,
          decision,
          reason: why || null,
        },
      });
    }
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/reviews] decideReview failed:', err);
    return { ok: false, status: 500, error: 'Failed to record the decision', code: 'DB_ERROR' };
  }
}
