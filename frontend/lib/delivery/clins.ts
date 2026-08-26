/**
 * CLINs — the contract line items a delivery project is measured against.
 *
 * Every field a person types here is a claim about what the contract says, so every field can carry
 * a citation. `recordProvenance` refuses a citing method with nothing to cite, which is what stops
 * "Read from source" from appearing against a source nobody can open.
 *
 * ── ORDERING IS `sort_index`, NEVER `clin_number` ────────────────────────────────────────────
 * `'0010'` sorts before `'0002AA'` in some sets and after in others once suffixes appear, and a
 * string sort on numbering is the exact bug migration 143 fixed for `proposal_sections`. The number
 * is an identifier; the order is an integer.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, type DeliveryActor } from './access';
import { recordProvenance, type ProvenanceMethod } from './provenance';
import type { Fail, Ok } from './projects';

export interface Clin {
  id: string;
  projectId: string;
  clinNumber: string;
  title: string;
  contractType: string | null;
  popStart: string | null;
  popEnd: string | null;
  fundedAmount: string | null;
  sortIndex: number;
}

/** A citation offered alongside a field value. */
export interface FieldCitation {
  method: ProvenanceMethod;
  sourceDocId?: string | null;
  page?: number | null;
  excerpt?: string | null;
  charOffset?: number | null;
}

export interface ClinInput {
  clinNumber: string;
  title: string;
  contractType?: string | null;
  popStart?: string | null;
  popEnd?: string | null;
  fundedAmount?: number | null;
  sortIndex?: number;
  /** Per-field citations, keyed by column name. Absent ⇒ the field is unverified, and shows as such. */
  citations?: Record<string, FieldCitation>;
}

const CITABLE_FIELDS = new Set(['clin_number', 'title', 'contract_type', 'pop_start', 'pop_end', 'funded_amount']);

/** A date the database will accept, or null. Rejects rather than coercing — a silently-dropped date
 *  is worse than a refused one, because the CLIN then looks like it has no period of performance. */
function asDate(v: unknown, field: string): { ok: true; value: string | null } | { ok: false; field: string } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, field };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, field };
  return { ok: true, value: v };
}

export async function listClins(tenantId: string, projectId: string): Promise<Clin[]> {
  try {
    return await sql<Clin[]>`
      SELECT id, project_id, clin_number, title, contract_type, pop_start, pop_end,
             funded_amount, sort_index
        FROM delivery_clins
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, clin_number`;
  } catch (err) {
    console.error('[delivery/clins] listClins failed:', err);
    return [];
  }
}

export async function createClin(
  actor: DeliveryActor,
  projectId: string,
  input: ClinInput,
): Promise<Ok<Clin> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can add CLINs', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const clinNumber = (input.clinNumber ?? '').trim();
  const title = (input.title ?? '').trim();
  if (!clinNumber || clinNumber.length > 40) {
    return { ok: false, status: 400, error: 'A CLIN number of 1–40 characters is required', code: 'VALIDATION_ERROR' };
  }
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A CLIN title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }

  const start = asDate(input.popStart, 'popStart');
  const end = asDate(input.popEnd, 'popEnd');
  if (!start.ok) return { ok: false, status: 400, error: 'popStart must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  if (!end.ok) return { ok: false, status: 400, error: 'popEnd must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  if (start.value && end.value && end.value < start.value) {
    return { ok: false, status: 400, error: 'popEnd cannot precede popStart', code: 'VALIDATION_ERROR' };
  }

  const funded = input.fundedAmount;
  if (funded !== null && funded !== undefined && (!Number.isFinite(funded) || funded < 0)) {
    return { ok: false, status: 400, error: 'fundedAmount must be a non-negative number', code: 'VALIDATION_ERROR' };
  }

  try {
    const rows = await sql<Clin[]>`
      INSERT INTO delivery_clins
        (tenant_id, project_id, clin_number, title, contract_type, pop_start, pop_end,
         funded_amount, sort_index)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${clinNumber}, ${title},
         ${input.contractType ?? null}, ${start.value}, ${end.value},
         ${funded ?? null}, ${input.sortIndex ?? 0})
      ON CONFLICT (project_id, clin_number) DO NOTHING
      RETURNING id, project_id, clin_number, title, contract_type, pop_start, pop_end,
                funded_amount, sort_index`;

    if (rows.length === 0) {
      return {
        ok: false, status: 409, code: 'DUPLICATE',
        error: `CLIN ${clinNumber} already exists on this project`,
      };
    }
    const clin = rows[0];

    await recordCitations(actor, projectId, clin.id, input.citations);

    await emitEventSingle({
      namespace: 'project',
      type: 'clin.created',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, clinId: clin.id, clinNumber, title },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.clin_created',
      entityType: 'delivery_clin', entityId: clin.id, metadata: { projectId, clinNumber },
    });

    return { ok: true, data: clin };
  } catch (err) {
    console.error('[delivery/clins] createClin failed:', err);
    return { ok: false, status: 500, error: 'Failed to create the CLIN', code: 'DB_ERROR' };
  }
}

/**
 * Write the citations offered for a CLIN's fields.
 *
 * Best-effort and non-fatal: the CLIN row is already committed, and refusing the whole write
 * because a citation was malformed would lose the data the user actually entered. Each rejection is
 * logged by `recordProvenance` with the reason.
 *
 * Fields with no citation are left with NO provenance row, and `badgeFor` renders that as
 * **unverified** rather than as neutral — silence about where a number came from is the same claim
 * as "we made it up".
 */
async function recordCitations(
  actor: DeliveryActor,
  projectId: string,
  clinId: string,
  citations: Record<string, FieldCitation> | undefined,
): Promise<void> {
  if (!citations) return;
  for (const [field, cite] of Object.entries(citations)) {
    if (!CITABLE_FIELDS.has(field)) {
      console.error(`[delivery/clins] '${field}' is not a citable CLIN field — ignored`);
      continue;
    }
    await recordProvenance({
      tenantId: actor.tenantId,
      projectId,
      targetTable: 'delivery_clins',
      targetId: clinId,
      field,
      method: cite.method,
      sourceDocId: cite.sourceDocId ?? null,
      page: cite.page ?? null,
      excerpt: cite.excerpt ?? null,
      charOffset: cite.charOffset ?? null,
      userId: actor.userId,
    });
  }
}
