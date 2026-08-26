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
 * deliberately skips anything already met (see `lib/delivery/baseline.ts`).
 */
import { randomUUID } from 'crypto';
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { putObject } from '@/lib/storage/s3-client';
import { customerDeliveryPath } from '@/lib/storage/paths';
import { canAccessProject, canAssign, type DeliveryActor } from './access';
import type { Fail, Ok } from './projects';

export interface Milestone {
  id: string;
  projectId: string;
  clinId: string | null;
  wbsNodeId: string | null;
  title: string;
  baselineDate: string | null;
  forecastDate: string | null;
  status: string;
  metAt: string | null;
  sortIndex: number;
}

export interface Deliverable {
  id: string;
  milestoneId: string;
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
      SELECT id, project_id, clin_id, wbs_node_id, title, baseline_date, forecast_date,
             status, met_at, sort_index
        FROM delivery_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, forecast_date NULLS LAST`;
  } catch (err) {
    console.error('[delivery/milestones] listMilestones failed:', err);
    return [];
  }
}

export async function listDeliverables(tenantId: string, projectId: string): Promise<Deliverable[]> {
  try {
    return await sql<Deliverable[]>`
      SELECT d.id, d.milestone_id, d.title, d.required_by, d.storage_key, d.filename,
             d.content_type, d.byte_size, d.uploaded_by, d.uploaded_at,
             d.accepted_at, d.accepted_by, d.sort_index
        FROM delivery_deliverables d
        JOIN delivery_milestones m ON m.id = d.milestone_id
       WHERE m.project_id = ${projectId}::uuid AND d.tenant_id = ${tenantId}::uuid
       ORDER BY d.sort_index, d.title`;
  } catch (err) {
    console.error('[delivery/milestones] listDeliverables failed:', err);
    return [];
  }
}

export async function createMilestone(
  actor: DeliveryActor,
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
        ? await sql<{ id: string }[]>`SELECT id FROM delivery_clins WHERE id = ${id}::uuid AND project_id = ${projectId}::uuid LIMIT 1`
        : await sql<{ id: string }[]>`SELECT id FROM delivery_wbs_nodes WHERE id = ${id}::uuid AND project_id = ${projectId}::uuid LIMIT 1`;
      if (rows.length === 0) {
        return { ok: false, status: 400, error: `${label} does not belong to this project`, code: 'VALIDATION_ERROR' };
      }
    }

    const [row] = await sql<Milestone[]>`
      INSERT INTO delivery_milestones
        (tenant_id, project_id, clin_id, wbs_node_id, title, forecast_date, sort_index)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${input.clinId ?? null},
         ${input.wbsNodeId ?? null}, ${title}, ${forecast.value}, ${input.sortIndex ?? 0})
      RETURNING id, project_id, clin_id, wbs_node_id, title, baseline_date, forecast_date,
                status, met_at, sort_index`;

    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.milestone_created',
      entityType: 'delivery_milestone', entityId: row.id, metadata: { projectId, title },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[delivery/milestones] createMilestone failed:', err);
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
  actor: DeliveryActor,
  projectId: string,
  milestoneId: string,
): Promise<Ok<Milestone> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can close a milestone', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  try {
    const outstanding = await sql<{ title: string }[]>`
      SELECT d.title FROM delivery_deliverables d
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
      UPDATE delivery_milestones
         SET status = 'met', met_at = now(), updated_at = now()
       WHERE id = ${milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid AND status = 'pending'
      RETURNING id, project_id, clin_id, wbs_node_id, title, baseline_date, forecast_date,
                status, met_at, sort_index`;
    if (!row) {
      return {
        ok: false, status: 409, code: 'NOT_PENDING',
        error: 'That milestone is not pending — it may already be met, missed or waived.',
      };
    }

    // The variance, computed once and carried in the payload, so the activity feed can say
    // "met, nine days late" without re-deriving it from two dates a reader has to subtract.
    const variance = row.baselineDate && row.metAt
      ? Math.round((Date.parse(String(row.metAt)) - Date.parse(`${String(row.baselineDate).slice(0, 10)}T00:00:00Z`)) / 86_400_000)
      : null;

    await emitEventSingle({
      namespace: 'project',
      type: 'milestone.met',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, milestoneId, title: row.title, varianceDays: variance },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.milestone_met',
      entityType: 'delivery_milestone', entityId: milestoneId, metadata: { projectId, varianceDays: variance },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[delivery/milestones] markMilestoneMet failed:', err);
    return { ok: false, status: 500, error: 'Failed to close the milestone', code: 'DB_ERROR' };
  }
}

export async function createDeliverable(
  actor: DeliveryActor,
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
      SELECT id FROM delivery_milestones
       WHERE id = ${input.milestoneId}::uuid AND project_id = ${projectId}::uuid LIMIT 1`;
    if (!ms) {
      return { ok: false, status: 400, error: 'That milestone does not belong to this project', code: 'VALIDATION_ERROR' };
    }

    const [row] = await sql<Deliverable[]>`
      INSERT INTO delivery_deliverables (tenant_id, milestone_id, title, required_by, sort_index)
      VALUES (${actor.tenantId}::uuid, ${input.milestoneId}::uuid, ${title}, ${required.value},
              ${input.sortIndex ?? 0})
      RETURNING id, milestone_id, title, required_by, storage_key, filename, content_type,
                byte_size, uploaded_by, uploaded_at, accepted_at, accepted_by, sort_index`;

    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.deliverable_created',
      entityType: 'delivery_deliverable', entityId: row.id, metadata: { projectId, title },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[delivery/milestones] createDeliverable failed:', err);
    return { ok: false, status: 500, error: 'Failed to add the deliverable', code: 'DB_ERROR' };
  }
}

const ALLOWED_EXT = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv', 'zip', 'png', 'jpg', 'jpeg']);
const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Attach a file. **Assigned employees may do this** — it is the everyday act of delivery work, and
 * requiring a tenant_admin for every progress report would make the roster pointless.
 *
 * It never sets `accepted_at`. Re-uploading replaces the file and **clears any prior acceptance**,
 * because an accepted deliverable whose file has since changed is not an accepted deliverable.
 */
export async function uploadDeliverable(
  actor: DeliveryActor,
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
      SELECT d.id, d.accepted_at, d.title FROM delivery_deliverables d
        JOIN delivery_milestones m ON m.id = d.milestone_id
       WHERE d.id = ${deliverableId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!existing) return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };

    const [tenant] = await sql<{ slug: string }[]>`
      SELECT slug FROM tenants WHERE id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!tenant) return { ok: false, status: 404, error: 'Tenant not found', code: 'NOT_FOUND' };

    // The key is derived from ids; the user's filename is kept for display and never reaches the
    // object key. A new uuid per upload, so a replaced file does not overwrite the prior bytes —
    // the row points at the current one and the old object remains for audit.
    const key = customerDeliveryPath(tenant.slug, projectId, `deliverables/${deliverableId}/${randomUUID()}.${ext}`);
    await putObject({ key, body: input.body, contentType: input.contentType ?? undefined });

    const [row] = await sql<Deliverable[]>`
      UPDATE delivery_deliverables
         SET storage_key = ${key}, filename = ${filename}, content_type = ${input.contentType ?? null},
             byte_size = ${input.body.length}, uploaded_by = ${actor.userId}::uuid, uploaded_at = now(),
             -- A replaced file CLEARS acceptance. An accepted deliverable whose file has since
             -- changed is not an accepted deliverable, and leaving the flag set would let a
             -- milestone close against a document nobody approved.
             accepted_at = NULL, accepted_by = NULL
       WHERE id = ${deliverableId}::uuid AND tenant_id = ${actor.tenantId}::uuid
      RETURNING id, milestone_id, title, required_by, storage_key, filename, content_type,
                byte_size, uploaded_by, uploaded_at, accepted_at, accepted_by, sort_index`;

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
      tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.deliverable_uploaded',
      entityType: 'delivery_deliverable', entityId: deliverableId,
      metadata: { projectId, filename, replacedAcceptance: Boolean(existing.acceptedAt) },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[delivery/milestones] uploadDeliverable failed:', err);
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
  actor: DeliveryActor,
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
    // CAS on `storage_key IS NOT NULL AND accepted_at IS NULL` — one statement that refuses both
    // "nothing to accept" and a double-accept, without a read-then-write race between them.
    const [row] = await sql<Deliverable[]>`
      UPDATE delivery_deliverables d
         SET accepted_at = now(), accepted_by = ${actor.userId}::uuid
        FROM delivery_milestones m
       WHERE d.milestone_id = m.id
         AND d.id = ${deliverableId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${actor.tenantId}::uuid
         AND d.storage_key IS NOT NULL AND d.accepted_at IS NULL
      RETURNING d.id, d.milestone_id, d.title, d.required_by, d.storage_key, d.filename,
                d.content_type, d.byte_size, d.uploaded_by, d.uploaded_at,
                d.accepted_at, d.accepted_by, d.sort_index`;
    if (!row) {
      const [why] = await sql<{ storageKey: string | null; acceptedAt: string | null }[]>`
        SELECT storage_key, accepted_at FROM delivery_deliverables
         WHERE id = ${deliverableId}::uuid AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!why) return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
      if (!why.storageKey) {
        return {
          ok: false, status: 409, code: 'NOTHING_UPLOADED',
          error: 'There is no file on this deliverable to accept. Upload one first.',
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
      tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.deliverable_accepted',
      entityType: 'delivery_deliverable', entityId: deliverableId, metadata: { projectId },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[delivery/milestones] acceptDeliverable failed:', err);
    return { ok: false, status: 500, error: 'Failed to accept the deliverable', code: 'DB_ERROR' };
  }
}
