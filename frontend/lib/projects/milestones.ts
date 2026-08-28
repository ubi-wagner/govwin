/**
 * Milestones and deliverables — and the distinction the whole module exists to keep.
 *
 * ── UPLOAD AND ACCEPTANCE ARE TWO FACTS ──────────────────────────────────────────────────────
 * A file being present is not a deliverable met. Someone has to say so.
 *
 * Collapsing them would make "we uploaded a draft" and "the government accepted it"
 * indistinguishable, and the second is the one that closes a CLIN. Every function here keeps them
 * apart: `uploadDeliverable` never sets `accepted_at`, `acceptDeliverable` never touches the file,
 * and a milestone cannot be met while a required deliverable is unaccepted.
 *
 * ── A MET MILESTONE IS A FACT, NOT A FORECAST ────────────────────────────────────────────────
 * `met_at` is when it happened. `forecast_date` is what we currently expect. `baseline_date` is what
 * we promised, and migration 216's trigger refuses to move it. Rebaseline shifts forecasts and
 * deliberately skips anything already met (see `lib/projects/baseline.ts`).
 */
import { randomUUID } from 'crypto';
import { starterFromPreset, isBlankPreset, countNodes } from '@/lib/documents/starter';
import { createNode, type CanvasNode } from '@/lib/types/canvas-document';
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { putObject } from '@/lib/storage/s3-client';
import { customerProjectPath } from '@/lib/storage/paths';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import { daysBetween, isoDate } from './dates';
import { closeTodosUnder } from './todos';
import { blockingReview } from './reviews';
import type { Fail, Ok } from './project';

export interface Milestone {
  id: string;
  projectId: string;
  clinId: string | null;
  wbsNodeId: string | null;
  title: string;
  /** The start of the segment. Serial by default (the previous milestone's end + 1 day) but
   *  pinnable — see `lib/projects/milestone-tasks.ts`. Planning, not a promise: it is NOT
   *  baselined, so a rebaseline does not argue with a work breakdown. */
  startsOn: string | null;
  baselineDate: string | null;
  forecastDate: string | null;
  status: string;
  metAt: string | null;
  ownerUserId: string | null;
  /** What a person wants to say about how it went. "met" alone is unreadable six months later. */
  completionNote: string | null;
  /** Whatever this milestone actually measured — units, tests, hours. Open jsonb because the shape
   *  varies per contract, and a column per metric would be a schema change per customer. */
  completionMetrics: Record<string, unknown> | null;
  sortIndex: number;
}

export interface Deliverable {
  id: string;
  milestoneId: string;
  /** An AUTHORED canvas document backing this deliverable (mig 220). A sibling of `storageKey`, not
   *  a replacement: both are ways to ATTACH evidence, and neither is acceptance. */
  documentId?: string | null;
  documentTitle?: string | null;
  title: string;
  requiredBy: string | null;
  storageKey: string | null;
  filename: string | null;
  contentType: string | null;
  byteSize: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  /** The email of the person IN THIS PRODUCT who accepted it — never the customer. The workspace
   *  renders "accepted by <this> · evidence: …", and merging the two would be exactly the claim
   *  mig 224 exists to prevent. */
  acceptedByEmail?: string | null;
  sortIndex: number;
}

function asDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false };
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? { ok: false } : { ok: true, value: v };
}

export async function listMilestones(tenantId: string, projectId: string): Promise<Milestone[]> {
  try {
    return await sql<Milestone[]>`
      SELECT id, project_id, clin_id, wbs_node_id, title, starts_on, baseline_date,
             forecast_date, status, met_at, owner_user_id, completion_note, completion_metrics,
             sort_index
        FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, forecast_date NULLS LAST`;
  } catch (err) {
    console.error('[projects/milestones] listMilestones failed:', err);
    return [];
  }
}

export async function listDeliverables(tenantId: string, projectId: string): Promise<Deliverable[]> {
  try {
    return await sql<Deliverable[]>`
      SELECT d.id, d.milestone_id, d.title, d.required_by, d.storage_key, d.filename,
             d.content_type, d.byte_size, d.uploaded_by, d.uploaded_at,
             d.accepted_at, d.accepted_by, d.sort_index,
             d.document_id, td.title AS document_title, au.email AS accepted_by_email
        FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
        LEFT JOIN tenant_documents td ON td.id = d.document_id
        LEFT JOIN users au ON au.id = d.accepted_by
       WHERE m.project_id = ${projectId}::uuid AND d.tenant_id = ${tenantId}::uuid
       ORDER BY d.sort_index, d.title`;
  } catch (err) {
    console.error('[projects/milestones] listDeliverables failed:', err);
    return [];
  }
}

export async function createMilestone(
  actor: ProjectActor,
  projectId: string,
  input: { title: string; clinId?: string | null; wbsNodeId?: string | null; forecastDate?: string | null; sortIndex?: number },
): Promise<Ok<Milestone> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can add milestones', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const title = (input.title ?? '').trim();
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A milestone title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }
  const forecast = asDate(input.forecastDate);
  if (!forecast.ok) {
    return { ok: false, status: 400, error: 'forecastDate must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-before-write, scoped to THIS project — a CLIN or WBS node from another project satisfies
    // the FK and would silently attach one contract's milestone to another's line item.
    for (const [label, id, table] of [
      ['clinId', input.clinId, 'clins'], ['wbsNodeId', input.wbsNodeId, 'wbs'],
    ] as const) {
      if (!id) continue;
      const rows = table === 'clins'
        ? await sql<{ id: string }[]>`SELECT id FROM project_clins WHERE id = ${id}::uuid AND project_id = ${projectId}::uuid LIMIT 1`
        : await sql<{ id: string }[]>`SELECT id FROM project_wbs_nodes WHERE id = ${id}::uuid AND project_id = ${projectId}::uuid LIMIT 1`;
      if (rows.length === 0) {
        return { ok: false, status: 400, error: `${label} does not belong to this project`, code: 'VALIDATION_ERROR' };
      }
    }

    const [row] = await sql<Milestone[]>`
      INSERT INTO project_milestones
        (tenant_id, project_id, clin_id, wbs_node_id, title, forecast_date, sort_index)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${input.clinId ?? null},
         ${input.wbsNodeId ?? null}, ${title}, ${forecast.value}, ${input.sortIndex ?? 0})
      RETURNING id, project_id, clin_id, wbs_node_id, title, starts_on, baseline_date,
                forecast_date, status, met_at, owner_user_id, completion_note, completion_metrics,
                sort_index`;

    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.milestone_created',
      entityType: 'project_milestone', entityId: row.id, metadata: { projectId, title },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/milestones] createMilestone failed:', err);
    return { ok: false, status: 500, error: 'Failed to add the milestone', code: 'DB_ERROR' };
  }
}

/**
 * Mark a milestone met.
 *
 * **Refuses while a deliverable attached to it is unaccepted.** A milestone whose deliverables the
 * government has not accepted is not met — it is a milestone we believe we have finished, which is
 * a different claim and the one that gets contractors into trouble.
 *
 * The compare-and-swap on `status = 'pending'` means a double-click cannot produce two `met_at`
 * timestamps or two events.
 */
export async function markMilestoneMet(
  actor: ProjectActor,
  projectId: string,
  milestoneId: string,
  completion: { note?: string | null; metrics?: Record<string, unknown> | null } = {},
): Promise<Ok<Milestone> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can close a milestone', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  // Metrics are an OBJECT or nothing. A scalar or an array reaches mig 218's CHECK as a
  // constraint name; refusing it here reaches the caller as a sentence.
  const metrics = completion.metrics ?? null;
  if (metrics !== null && (typeof metrics !== 'object' || Array.isArray(metrics))) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'metrics must be an object of named measurements, e.g. { unitsShipped: 12 }',
    };
  }
  const note = (completion.note ?? '').trim() || null;

  try {
    // ── THE WORK, THEN THE ACCEPTANCE — two refusals, deliberately separate ────────────────
    // An open task means the work is not finished. An unaccepted deliverable means the customer
    // has not signed for it. They are different problems with different next actions, so they get
    // different messages rather than one "milestone not ready".
    const openTasks = await sql<{ title: string }[]>`
      SELECT title FROM project_milestone_tasks
       WHERE milestone_id = ${milestoneId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND status <> 'done'
       ORDER BY sort_index`;
    if (openTasks.length) {
      return {
        ok: false, status: 409, code: 'TASKS_OUTSTANDING',
        error: `${openTasks.length} task(s) on this milestone are not done: `
          + `${openTasks.slice(0, 3).map((t) => t.title).join(', ')}`
          + `${openTasks.length > 3 ? ', …' : ''}.`,
      };
    }

    const outstanding = await sql<{ title: string }[]>`
      SELECT d.title FROM project_deliverables d
       WHERE d.milestone_id = ${milestoneId}::uuid AND d.tenant_id = ${actor.tenantId}::uuid
         AND d.accepted_at IS NULL
       ORDER BY d.sort_index`;
    if (outstanding.length) {
      return {
        ok: false, status: 409, code: 'DELIVERABLES_OUTSTANDING',
        error: `${outstanding.length} deliverable(s) on this milestone have not been accepted: `
          + `${outstanding.slice(0, 3).map((d) => d.title).join(', ')}`
          + `${outstanding.length > 3 ? ', …' : ''}. Uploading a file is not acceptance.`,
      };
    }

    const [row] = await sql<Milestone[]>`
      UPDATE project_milestones
         SET status = 'met', met_at = now(), updated_at = now(),
             completion_note = ${note},
             completion_metrics = ${metrics === null ? null
               // `sql.json`, never `JSON.stringify(...)::jsonb` — the latter reads back as a
               // STRING and then char-iterates (CLAUDE.md's jsonb rule). The cast is to
               // postgres.js's JSONValue, which does not admit a bare index signature.
               : sql.json(metrics as Record<string, never>)}
       WHERE id = ${milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid AND status = 'pending'
      RETURNING id, project_id, clin_id, wbs_node_id, title, starts_on, baseline_date,
                forecast_date, status, met_at, owner_user_id, completion_note, completion_metrics,
                sort_index`;
    if (!row) {
      return {
        ok: false, status: 409, code: 'NOT_PENDING',
        error: 'That milestone is not pending — it may already be met, missed or waived.',
      };
    }

    // The variance, computed once and carried in the payload, so the activity feed can say
    // "met, nine days late" without re-deriving it from two dates a reader has to subtract.
    //
    // Via `daysBetween`, NOT by slicing the string form of a Date. This line used to read
    // `String(row.baselineDate).slice(0, 10)` — which is "Tue Apr 28", so the subtraction was NaN,
    // and `JSON.stringify(NaN)` is `null`: the event carried "no baseline" instead of "nine days
    // late", silently and forever. Same defect as the D8 page bug, in the sibling the D8 fix did
    // not touch.
    const variance = daysBetween(row.baselineDate, row.metAt);

    // Sweep up any ToDo still standing under this phase. The gate above means there should be
    // none — but a task can be REASSIGNED, and a queue holding work on a finished phase is exactly
    // how people stop trusting the queue.
    await closeTodosUnder(actor, { milestoneId }, { via: 'milestone met' });

    await emitEventSingle({
      namespace: 'project',
      type: 'milestone.met',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, milestoneId, title: row.title, varianceDays: variance,
        ...(note ? { note } : {}), ...(metrics ? { metrics } : {}),
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.milestone_met',
      entityType: 'project_milestone', entityId: milestoneId, metadata: { projectId, varianceDays: variance },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/milestones] markMilestoneMet failed:', err);
    return { ok: false, status: 500, error: 'Failed to close the milestone', code: 'DB_ERROR' };
  }
}

export async function createDeliverable(
  actor: ProjectActor,
  projectId: string,
  input: { milestoneId: string; title: string; requiredBy?: string | null; sortIndex?: number },
): Promise<Ok<Deliverable> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can add deliverables', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const title = (input.title ?? '').trim();
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A deliverable title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }
  const required = asDate(input.requiredBy);
  if (!required.ok) {
    return { ok: false, status: 400, error: 'requiredBy must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }

  try {
    const [ms] = await sql<{ id: string }[]>`
      SELECT id FROM project_milestones
       WHERE id = ${input.milestoneId}::uuid AND project_id = ${projectId}::uuid LIMIT 1`;
    if (!ms) {
      return { ok: false, status: 400, error: 'That milestone does not belong to this project', code: 'VALIDATION_ERROR' };
    }

    const [row] = await sql<Deliverable[]>`
      INSERT INTO project_deliverables (tenant_id, milestone_id, title, required_by, sort_index)
      VALUES (${actor.tenantId}::uuid, ${input.milestoneId}::uuid, ${title}, ${required.value},
              ${input.sortIndex ?? 0})
      RETURNING id, milestone_id, title, required_by, storage_key, filename, content_type,
                byte_size, uploaded_by, uploaded_at, accepted_at, accepted_by, sort_index,
                document_id`;

    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.deliverable_created',
      entityType: 'project_deliverable', entityId: row.id, metadata: { projectId, title },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/milestones] createDeliverable failed:', err);
    return { ok: false, status: 500, error: 'Failed to add the deliverable', code: 'DB_ERROR' };
  }
}

const ALLOWED_EXT = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv', 'zip', 'png', 'jpg', 'jpeg']);
const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Attach a file. **Assigned employees may do this** — it is the everyday act of project work, and
 * requiring a tenant_admin for every progress report would make the roster pointless.
 *
 * It never sets `accepted_at`. Re-uploading replaces the file and **clears any prior acceptance**,
 * because an accepted deliverable whose file has since changed is not an accepted deliverable.
 */
export async function uploadDeliverable(
  actor: ProjectActor,
  projectId: string,
  deliverableId: string,
  input: { filename: string; body: Buffer; contentType?: string | null },
): Promise<Ok<Deliverable> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
  }

  const filename = (input.filename ?? '').trim();
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!filename || filename.includes('/') || filename.includes('..') || !ALLOWED_EXT.has(ext)) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `A filename ending in one of ${[...ALLOWED_EXT].join(', ')} is required`,
    };
  }
  if (!input.body?.length) {
    return { ok: false, status: 400, error: 'The uploaded file is empty', code: 'VALIDATION_ERROR' };
  }
  if (input.body.length > MAX_BYTES) {
    return { ok: false, status: 413, error: 'That file exceeds the 100 MB limit', code: 'PAYLOAD_TOO_LARGE' };
  }

  try {
    const [existing] = await sql<{ id: string; acceptedAt: string | null; title: string }[]>`
      SELECT d.id, d.accepted_at, d.title FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
       WHERE d.id = ${deliverableId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!existing) return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };

    const [tenant] = await sql<{ slug: string }[]>`
      SELECT slug FROM tenants WHERE id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!tenant) return { ok: false, status: 404, error: 'Tenant not found', code: 'NOT_FOUND' };

    // The key is derived from ids; the user's filename is kept for display and never reaches the
    // object key. A new uuid per upload, so a replaced file does not overwrite the prior bytes —
    // the row points at the current one and the old object remains for audit.
    const key = customerProjectPath(tenant.slug, projectId, `deliverables/${deliverableId}/${randomUUID()}.${ext}`);
    await putObject({ key, body: input.body, contentType: input.contentType ?? undefined });

    const [row] = await sql<Deliverable[]>`
      UPDATE project_deliverables
         SET storage_key = ${key}, filename = ${filename}, content_type = ${input.contentType ?? null},
             byte_size = ${input.body.length}, uploaded_by = ${actor.userId}::uuid, uploaded_at = now(),
             -- A replaced file CLEARS acceptance. An accepted deliverable whose file has since
             -- changed is not an accepted deliverable, and leaving the flag set would let a
             -- milestone close against a document nobody approved.
             accepted_at = NULL, accepted_by = NULL
       WHERE id = ${deliverableId}::uuid AND tenant_id = ${actor.tenantId}::uuid
      RETURNING id, milestone_id, title, required_by, storage_key, filename, content_type,
                byte_size, uploaded_by, uploaded_at, accepted_at, accepted_by, sort_index,
                document_id`;
    // The row was there a statement ago; if it is not now, something removed it mid-upload. Say so
    // rather than returning `{ ok: true, data: undefined }` — which type-checks (postgres.js rows
    // are not `| undefined` without noUncheckedIndexedAccess) and reaches the client as `{}`.
    if (!row) {
      return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'deliverable.uploaded',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, deliverableId, title: existing.title, filename,
        replacedAcceptance: Boolean(existing.acceptedAt),
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.deliverable_uploaded',
      entityType: 'project_deliverable', entityId: deliverableId,
      metadata: { projectId, filename, replacedAcceptance: Boolean(existing.acceptedAt) },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/milestones] uploadDeliverable failed:', err);
    return { ok: false, status: 500, error: 'Failed to store the deliverable', code: 'STORAGE_ERROR' };
  }
}

/**
 * Accept a deliverable — the second fact.
 *
 * `tenant_admin`+ only, and only when a file is present: accepting nothing is not a thing anyone
 * means to do, and allowing it would let a milestone close with no evidence at all.
 */
export async function acceptDeliverable(
  actor: ProjectActor,
  projectId: string,
  deliverableId: string,
): Promise<Ok<Deliverable> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can accept a deliverable', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
  }

  try {
    // ── AN OPEN OR REJECTED REVIEW BLOCKS ACCEPTANCE (mig 223) ──────────────────────────────
    // Checked BEFORE the compare-and-swap, so the refusal names the review rather than coming back
    // as a generic conflict. Only the LATEST review counts: a rejection a fresh request superseded
    // is history, not a standing objection — that is what makes reject → fix → re-request →
    // approve a loop instead of a dead end. A deliverable nobody ever sent for review accepts
    // exactly as it did before, so nothing that worked stops working.
    const blocker = await blockingReview(actor.tenantId, 'deliverable', deliverableId);
    if (blocker) {
      return blocker.status === 'pending'
        ? {
          ok: false, status: 409, code: 'REVIEW_PENDING',
          error: 'That is still out for review. Decide or withdraw the review before accepting it.',
        }
        : {
          ok: false, status: 409, code: 'REVIEW_REJECTED',
          error: `A reviewer rejected it: ${blocker.reason ?? 'no reason recorded'}. `
            + 'Fix it and ask for a fresh review.',
        };
    }

    // CAS on `storage_key IS NOT NULL AND accepted_at IS NULL` — one statement that refuses both
    // "nothing to accept" and a double-accept, without a read-then-write race between them.
    const [row] = await sql<Deliverable[]>`
      UPDATE project_deliverables d
         SET accepted_at = now(), accepted_by = ${actor.userId}::uuid
        FROM project_milestones m
       WHERE d.milestone_id = m.id
         AND d.id = ${deliverableId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${actor.tenantId}::uuid
         AND (d.storage_key IS NOT NULL OR d.document_id IS NOT NULL)
         AND d.accepted_at IS NULL
      RETURNING d.id, d.milestone_id, d.title, d.required_by, d.storage_key, d.filename,
                d.content_type, d.byte_size, d.uploaded_by, d.uploaded_at,
                d.accepted_at, d.accepted_by, d.sort_index, d.document_id`;
    if (!row) {
      const [why] = await sql<{ storageKey: string | null; documentId: string | null; acceptedAt: string | null }[]>`
        SELECT storage_key, document_id, accepted_at FROM project_deliverables
         WHERE id = ${deliverableId}::uuid AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!why) return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
      if (!why.storageKey && !why.documentId) {
        return {
          ok: false, status: 409, code: 'NOTHING_ATTACHED',
          error: 'There is nothing on this deliverable to accept. Upload a file or author the '
            + 'document first.',
        };
      }
      return { ok: false, status: 409, code: 'ALREADY_ACCEPTED', error: 'That deliverable is already accepted.' };
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'deliverable.accepted',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, deliverableId, title: row.title, filename: row.filename },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.deliverable_accepted',
      entityType: 'project_deliverable', entityId: deliverableId, metadata: { projectId },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/milestones] acceptDeliverable failed:', err);
    return { ok: false, status: 500, error: 'Failed to accept the deliverable', code: 'DB_ERROR' };
  }
}

/**
 * Author a deliverable in-product: create the canvas document that satisfies it.
 *
 * ── THE SAME CANVAS THE BUILD PORTAL USES ────────────────────────────────────────────────────
 * A `tenant_documents` row holding a `CanvasDocument`, made from the same presets
 * (`flier | letter | deck | sheet`), edited in the same editor, measured by the same compliance
 * floor, and exported by the same route to **docx · pptx · xlsx · pdf**. A report, a deck, a
 * workbook and a PDF for a contract deliverable are the same artifacts a proposal volume is — the
 * only thing that was missing was a column saying which deliverable a document belongs to.
 *
 * ── AUTHORING IS NOT ACCEPTANCE, STILL ───────────────────────────────────────────────────────
 * This attaches evidence, exactly as uploading a file does. `accepted_at` remains the separate,
 * deliberate act by a tenant_admin, because a deck someone wrote is not a deliverable the customer
 * has signed for.
 */
/** What the system already knows about a deliverable, and can therefore put on the page. */
interface DeliverableFacts {
  id: string;
  title: string;
  documentId: string | null;
  requiredBy: string | Date | null;
  milestone: string;
  project: string;
}

/**
 * The opening nodes of an authored deliverable.
 *
 * ── ONLY FACTS THE SYSTEM HOLDS ──────────────────────────────────────────────────────────────
 * A title, and one line of context: the project, the phase, and the date it is due. Nothing else.
 * It is tempting to scaffold plausible section headings — Introduction, Approach, Results — and it
 * would make the starter look more finished, but the product would then be putting structure into
 * a contract deliverable that nobody asked it for. That is the same rule the ingest spine runs on:
 * *a value the product did not read from the source must never look like one it did*
 * (docs/INGEST_PROVENANCE.md). Every string below is read from a row.
 *
 * The provenance is `template`, the same source `starterFromTemplate` stamps on a scaffolded
 * heading — not `ai_draft`. A reader opening the node's history should be told the product read
 * these off a row, rather than left to wonder whether a model wrote them.
 */
function seedNodes(actorId: string, title: string, facts: DeliverableFacts): CanvasNode[] {
  const due = isoDate(facts.requiredBy);
  const context = [
    facts.project,
    facts.milestone,
    due ? `Required by ${due}` : null,
  ].filter(Boolean).join(' · ');

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

export async function authorDeliverable(
  actor: ProjectActor,
  projectId: string,
  deliverableId: string,
  input: { preset?: string; title?: string | null },
): Promise<Ok<{ deliverableId: string; documentId: string; title: string; docType: string }> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
  }
  const preset = (input.preset ?? 'letter').trim();
  if (!isBlankPreset(preset)) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: "preset must be one of: flier, letter, deck, sheet",
    };
  }

  try {
    const [existing] = await sql<DeliverableFacts[]>`
      SELECT d.id, d.title, d.document_id, d.required_by,
             m.title AS milestone, p.name AS project
        FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
        JOIN projects p ON p.id = m.project_id
       WHERE d.id = ${deliverableId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!existing) return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
    if (existing.documentId) {
      // Not an error to ask twice — hand back the document that already exists rather than
      // silently making a second draft nobody will find.
      return {
        ok: false, status: 409, code: 'ALREADY_AUTHORED',
        error: 'This deliverable already has a document. Open it rather than starting a second draft.',
      };
    }

    // The id is generated first so the canvas can key its own `document_id` to the row, exactly as
    // the standalone documents route does.
    const documentId = randomUUID();
    const starter = starterFromPreset(preset, {
      documentId,
      actorId: actor.userId,
      title: (input.title ?? '').trim() || existing.title,
    });
    // `starterFromPreset` builds a BLANK canvas — right for the "New document" chooser, where a
    // person clicked "blank letter" and means it. It is wrong HERE, and it shipped: the authored
    // report exported as an empty page, which a magic-number check on the bytes cannot see (an
    // 865-byte `%PDF` passed). A deliverable is not a blank page — it is a named obligation on a
    // named project with a date, and the system already holds all three.
    starter.canvas.nodes = seedNodes(actor.userId, starter.title, existing);

    await sql`
      INSERT INTO tenant_documents
        (id, tenant_id, title, doc_type, canvas, node_count, version, created_by)
      VALUES
        (${documentId}::uuid, ${actor.tenantId}::uuid, ${starter.title}, ${starter.docType},
         ${sql.json(starter.canvas as unknown as Parameters<typeof sql.json>[0])},
         ${countNodes(starter.canvas)}, 1, ${actor.userId}::uuid)`;

    await sql`
      UPDATE project_deliverables SET document_id = ${documentId}::uuid
       WHERE id = ${deliverableId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;

    await emitEventSingle({
      namespace: 'project',
      type: 'deliverable.authored',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, deliverableId, documentId, title: starter.title, preset },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.deliverable_authored',
      entityType: 'project_deliverable', entityId: deliverableId,
      metadata: { projectId, documentId, preset },
    });
    return { ok: true, data: { deliverableId, documentId, title: starter.title, docType: starter.docType } };
  } catch (err) {
    console.error('[projects/milestones] authorDeliverable failed:', err);
    return { ok: false, status: 500, error: 'Failed to start the document', code: 'DB_ERROR' };
  }
}
