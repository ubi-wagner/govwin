/**
 * Meetings, their notes, and the action items that come out of them.
 *
 * ── THE NOTES ARE A CANVAS DOCUMENT, NOT A TEXT FIELD ────────────────────────────────────────
 * The same `tenant_documents` row a deliverable uses (mig 220): the same editor, the same
 * compliance floor, the same docx · pptx · xlsx · pdf export. A `notes text` column would have been
 * a second authoring path — the exact mistake mig 220 exists to avoid — and minutes that cannot be
 * exported are minutes nobody can send.
 *
 * ── AN ACTION ITEM IS AN ORDINARY TASK ───────────────────────────────────────────────────────
 * Not a new kind of row. Work agreed in a meeting is work with an owner and a date, which is what
 * `project_milestone_tasks` already is — so it arrives with a ToDo, an email, nudges, reassignment
 * and attachments, and lands in the same list as everything else that person owes. A separate
 * "action items" table would be the fifth second-checklist this module has refused.
 *
 * What the meeting adds is the back-pointer: six weeks later, *"who agreed to this?"* is settled by
 * the notes it was decided in, and a task with no provenance cannot say.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────────────────────────
 * Recording a meeting is open to anyone on the project — whoever took the notes. Raising the action
 * items inherits `createMilestoneTask`'s authority (`tenant_admin`), because adding work to the plan
 * is a management act wherever it starts, and there should be one rule about that in one place.
 */
import { randomUUID } from 'crypto';
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { starterFromPreset, countNodes } from '@/lib/documents/starter';
import { createNode, type CanvasNode } from '@/lib/types/canvas-document';
import { canAccessProject, type ProjectActor } from './access';
import { createMilestoneTask } from './milestone-tasks';
import { isoDate } from './dates';
import type { Fail, Ok } from './project';

export interface ProjectMeeting {
  id: string;
  projectId: string;
  title: string;
  heldOn: string | null;
  attendees: string[];
  documentId: string | null;
  documentTitle?: string | null;
  createdBy: string | null;
  createdAt: string | null;
  /** How many action items trace back to this meeting, and how many are done. */
  actionItems?: number;
  actionItemsDone?: number;
}

export async function listProjectMeetings(
  tenantId: string,
  projectId: string,
): Promise<ProjectMeeting[]> {
  try {
    return await sql<ProjectMeeting[]>`
      SELECT m.id, m.project_id, m.title, m.held_on, m.attendees, m.document_id,
             td.title AS document_title, m.created_by, m.created_at,
             count(t.id)::int AS action_items,
             count(t.id) FILTER (WHERE t.status = 'done')::int AS action_items_done
        FROM project_meetings m
        LEFT JOIN tenant_documents td ON td.id = m.document_id
        LEFT JOIN project_milestone_tasks t ON t.meeting_id = m.id
       WHERE m.project_id = ${projectId}::uuid AND m.tenant_id = ${tenantId}::uuid
       GROUP BY m.id, td.title
       ORDER BY m.held_on DESC, m.created_at DESC`;
  } catch (err) {
    console.error('[projects/meetings] listProjectMeetings failed:', err);
    return [];
  }
}

/**
 * The opening nodes of a set of minutes.
 *
 * Only facts read off the row, exactly as `authorDeliverable` seeds a deliverable: the title, the
 * date, and who was there. No agenda headings — scaffolding "Attendees / Discussion / Actions"
 * would put structure into a record of what was actually said, and the product does not know what
 * was said.
 */
function seedMinutes(actorId: string, title: string, heldOn: string, attendees: string[]): CanvasNode[] {
  const context = [heldOn, attendees.length ? attendees.join(', ') : null]
    .filter(Boolean).join(' · ');
  return [
    createNode({
      type: 'heading', content: { level: 1, text: title },
      source: 'template', actorId, actorName: 'Project',
    }),
    createNode({
      type: 'text_block', content: { text: context },
      source: 'template', actorId, actorName: 'Project',
    }),
  ];
}

export async function recordMeeting(
  actor: ProjectActor,
  projectId: string,
  input: { title?: string; heldOn?: string; attendees?: unknown },
): Promise<Ok<ProjectMeeting> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const title = (input.title ?? '').trim();
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }
  const heldOn = (input.heldOn ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(heldOn)) {
    return { ok: false, status: 400, error: 'heldOn must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  // Names, trimmed and de-duplicated. Not resolved to users — half the room usually works for the
  // customer, and the product has no record of them.
  const attendees = Array.isArray(input.attendees)
    ? Array.from(new Set(input.attendees
      .filter((a): a is string => typeof a === 'string')
      .map((a) => a.trim())
      .filter((a) => a.length > 0 && a.length <= 200)))
      .slice(0, 50)
    : [];

  try {
    // The notes, in the same canvas everything else uses. The id is generated first so the document
    // can key its own `document_id`, exactly as the standalone documents route does.
    const documentId = randomUUID();
    const starter = starterFromPreset('letter', { documentId, actorId: actor.userId, title });
    starter.canvas.nodes = seedMinutes(actor.userId, title, heldOn, attendees);

    await sql`
      INSERT INTO tenant_documents
        (id, tenant_id, title, doc_type, canvas, node_count, version, created_by)
      VALUES
        (${documentId}::uuid, ${actor.tenantId}::uuid, ${title}, ${starter.docType},
         ${sql.json(starter.canvas as unknown as Parameters<typeof sql.json>[0])},
         ${countNodes(starter.canvas)}, 1, ${actor.userId}::uuid)`;

    const [row] = await sql<ProjectMeeting[]>`
      INSERT INTO project_meetings
        (tenant_id, project_id, title, held_on, attendees, document_id, created_by)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${title}, ${heldOn}::date,
         ${attendees}::text[], ${documentId}::uuid, ${actor.userId}::uuid)
      RETURNING id, project_id, title, held_on, attendees, document_id, created_by, created_at`;
    if (!row) return { ok: false, status: 500, error: 'Failed to record the meeting', code: 'DB_ERROR' };

    await emitEventSingle({
      namespace: 'project',
      type: 'meeting.recorded',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, meetingId: row.id, title, heldOn, attendees: attendees.length, documentId },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.meeting_recorded',
      entityType: 'project_meeting', entityId: row.id,
      metadata: { projectId, title, heldOn },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/meetings] recordMeeting failed:', err);
    return { ok: false, status: 500, error: 'Failed to record the meeting', code: 'DB_ERROR' };
  }
}

/**
 * Turn what was agreed into work.
 *
 * One call, many items — because that is how a meeting ends. Raising them one at a time would mean
 * six round trips and six chances to stop halfway, leaving a note that says "we agreed five things"
 * beside a plan carrying two of them.
 *
 * Each becomes an ORDINARY project task carrying `meeting_id`, so it appears in the owner's queue
 * like everything else and still knows where it came from.
 */
export async function raiseActionItems(
  actor: ProjectActor,
  projectId: string,
  meetingId: string,
  items: Array<{ title?: string; assigneeUserId?: string | null; dueDate?: string | null }>,
): Promise<Ok<{ meetingId: string; taskIds: string[]; refused: string[] }> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Meeting not found', code: 'NOT_FOUND' };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: 'Send at least one action item', code: 'VALIDATION_ERROR' };
  }
  if (items.length > 50) {
    return { ok: false, status: 400, error: 'That is more than 50 action items', code: 'VALIDATION_ERROR' };
  }

  try {
    const [meeting] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM project_meetings
       WHERE id = ${meetingId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!meeting) return { ok: false, status: 404, error: 'Meeting not found', code: 'NOT_FOUND' };

    const taskIds: string[] = [];
    const refused: string[] = [];
    for (const item of items) {
      const title = (item.title ?? '').trim();
      if (!title) continue;
      // Scope `project`: an action item from a review rarely belongs to one phase, and filing it
      // under one would make it gate that phase on screen while gating nothing in the database.
      const made = await createMilestoneTask(actor, projectId, {
        milestoneId: null,
        title: title.slice(0, 500),
        detail: `Agreed in "${meeting.title}".`,
        assigneeUserId: item.assigneeUserId ?? null,
        dueDate: item.dueDate ?? null,
      });
      if (!made.ok) {
        // ONE bad item does not lose the other five. What was refused comes back so the UI can say
        // which — silently dropping them would leave notes claiming five agreements beside a plan
        // holding two, which is worse than refusing the lot.
        refused.push(`${title}: ${made.error}`);
        continue;
      }
      taskIds.push(made.data.id);
      await sql`
        UPDATE project_milestone_tasks SET meeting_id = ${meetingId}::uuid
         WHERE id = ${made.data.id}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    }

    // An authority refusal is not a partial success: if NOTHING landed and something was refused,
    // the caller asked for a thing they may not do, and a 201 would say otherwise.
    if (taskIds.length === 0 && refused.length > 0) {
      return {
        ok: false, status: 403, code: 'FORBIDDEN',
        error: `No action items could be raised. ${refused[0]}`,
      };
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'meeting.actions_raised',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, meetingId, title: meeting.title,
        raised: taskIds.length, refused: refused.length,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.meeting_actions_raised',
      entityType: 'project_meeting', entityId: meetingId,
      metadata: { projectId, raised: taskIds.length, refused: refused.length },
    });
    return { ok: true, data: { meetingId, taskIds, refused } };
  } catch (err) {
    console.error('[projects/meetings] raiseActionItems failed:', err);
    return { ok: false, status: 500, error: 'Failed to raise the action items', code: 'DB_ERROR' };
  }
}

/** Every action item traced back to one meeting — "what did we agree, and did it happen?" */
export async function listMeetingActions(
  tenantId: string,
  meetingId: string,
): Promise<Array<{ id: string; title: string; status: string; assigneeEmail: string | null; dueDate: string | null }>> {
  try {
    return await sql<Array<{ id: string; title: string; status: string; assigneeEmail: string | null; dueDate: string | null }>>`
      SELECT t.id, t.title, t.status, u.email AS assignee_email, t.due_date
        FROM project_milestone_tasks t
        LEFT JOIN users u ON u.id = t.assignee_user_id
       WHERE t.meeting_id = ${meetingId}::uuid AND t.tenant_id = ${tenantId}::uuid
       ORDER BY t.created_at`;
  } catch (err) {
    console.error('[projects/meetings] listMeetingActions failed:', err);
    return [];
  }
}

/** Re-exported for the workspace, which renders dates it read as `Date` objects. */
export const meetingDate = isoDate;
