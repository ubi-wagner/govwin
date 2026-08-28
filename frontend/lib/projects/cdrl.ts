/**
 * The CDRL register — DD-1423 data requirements, and what has actually been sent against them.
 *
 * ── A CDRL IS AN OBLIGATION; A DELIVERABLE IS AN INSTANCE OF IT ──────────────────────────────
 * "A002 — Monthly Status Report, monthly, Distribution Statement B" is written into the contract
 * once. The twelve reports it produces are twelve deliverables under twelve monthly milestones.
 *
 * So the submission history of a CDRL **is** its deliverables in date order. There is no second
 * history table, which is why `listCdrlItems` joins rather than reads a parallel structure.
 *
 * ── THE THREE STATES, AND WHY THE THIRD HAD TO EXIST ─────────────────────────────────────────
 *   ATTACHED   `uploaded_at`  — a file or an authored document is on it. Anyone assigned may.
 *   ACCEPTED   `accepted_at`  — a tenant_admin signed off internally.
 *   SENT       `submitted_at` — the customer has it.
 *
 * Lateness against a contract date is measured against the THIRD, not the day somebody finished
 * writing. And submitting is gated on acceptance, in the database as well as here: sending work
 * nobody signed off is the failure the acceptance gate exists to prevent, one step later.
 *
 * What comes BACK is already modelled — `project_acceptance_evidence` (mig 224) records a claim
 * ABOUT the customer, uploaded by an admin, never the customer's own act.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import { isoDate } from './dates';
import type { Fail, Ok } from './project';

export type CdrlFrequency =
  'one_time' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'as_required' | 'with_each_milestone';

const FREQUENCIES: readonly CdrlFrequency[] =
  ['one_time', 'monthly', 'quarterly', 'semiannual', 'annual', 'as_required', 'with_each_milestone'];

/** Recurring frequencies need a first due date; the others have no next. Mirrors mig 232's CHECK. */
const RECURRING = new Set<CdrlFrequency>(['monthly', 'quarterly', 'semiannual', 'annual']);

export const DISTRIBUTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/**
 * What each distribution statement actually restricts. Rendered beside the letter, because "B"
 * alone tells a person nothing and the whole point of the marking is that the reader knows who may
 * receive the document.
 */
export const DISTRIBUTION_MEANING: Record<string, string> = {
  A: 'Approved for public release; distribution unlimited',
  B: 'U.S. Government agencies only',
  C: 'U.S. Government agencies and their contractors',
  D: 'Department of Defense and DoD contractors only',
  E: 'DoD components only',
  F: 'As directed by the controlling DoD office',
};

export interface CdrlSubmission {
  deliverableId: string;
  title: string;
  requiredBy: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  transmittalRef: string | null;
  milestoneTitle: string | null;
  /** Days late against `required_by`, or null when either date is missing. Negative is early. */
  daysLate: number | null;
}

export interface CdrlItem {
  id: string;
  projectId: string;
  cdrlNumber: string;
  title: string;
  didNumber: string | null;
  subtitle: string | null;
  clinId: string | null;
  clinNumber?: string | null;
  frequency: CdrlFrequency;
  approvalCode: 'A' | 'I';
  distribution: string | null;
  distributionNote: string | null;
  firstDue: string | null;
  recurrenceDays: number | null;
  notes: string | null;
  submissions?: CdrlSubmission[];
  /** How many instances exist, and how many have actually reached the customer. */
  instances?: number;
  sent?: number;
}

function daysBetween(from: string | null, to: string | null): number | null {
  // `isoDate`, never a slice of the string form: both arrive as JavaScript Dates, and
  // `String(d).slice(0,10)` is "Tue Apr 28" — which Date.parse turns into NaN, and NaN survives
  // every comparison to render as a confident number.
  const a = isoDate(from);
  const b = isoDate(to);
  if (!a || !b) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

export async function listCdrlItems(tenantId: string, projectId: string): Promise<CdrlItem[]> {
  try {
    const items = await sql<CdrlItem[]>`
      SELECT c.id, c.project_id, c.cdrl_number, c.title, c.did_number, c.subtitle,
             c.clin_id, k.clin_number, c.frequency, c.approval_code, c.distribution,
             c.distribution_note, c.first_due, c.recurrence_days, c.notes
        FROM project_cdrl_items c
        LEFT JOIN project_clins k ON k.id = c.clin_id
       WHERE c.project_id = ${projectId}::uuid AND c.tenant_id = ${tenantId}::uuid
       ORDER BY c.cdrl_number`;
    if (items.length === 0) return [];

    // THE SUBMISSION HISTORY IS THE DELIVERABLES. One read for all of them; a query per item would
    // be N+1 on a register that renders every item's history.
    const rows = await sql<Array<CdrlSubmission & { cdrlItemId: string }>>`
      SELECT d.id AS deliverable_id, d.cdrl_item_id, d.title, d.required_by, d.submitted_at,
             d.accepted_at, d.transmittal_ref, m.title AS milestone_title
        FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
       WHERE d.cdrl_item_id = ANY(${items.map((i) => i.id)}::uuid[])
         AND d.tenant_id = ${tenantId}::uuid
       ORDER BY d.required_by NULLS LAST, d.sort_index`;

    const by = new Map<string, CdrlSubmission[]>();
    for (const r of rows) {
      const list = by.get(r.cdrlItemId) ?? [];
      list.push({ ...r, daysLate: daysBetween(r.requiredBy, r.submittedAt) });
      by.set(r.cdrlItemId, list);
    }
    return items.map((i) => {
      const subs = by.get(i.id) ?? [];
      return {
        ...i,
        submissions: subs,
        instances: subs.length,
        sent: subs.filter((s) => s.submittedAt !== null).length,
      };
    });
  } catch (err) {
    console.error('[projects/cdrl] listCdrlItems failed:', err);
    return [];
  }
}

export interface CdrlInput {
  cdrlNumber: string;
  title: string;
  didNumber?: string | null;
  subtitle?: string | null;
  clinId?: string | null;
  frequency?: string;
  approvalCode?: string;
  distribution?: string | null;
  distributionNote?: string | null;
  firstDue?: string | null;
  recurrenceDays?: number | null;
  notes?: string | null;
}

function asDate(v: unknown): string | null | false {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? false : v;
}

export async function addCdrlItem(
  actor: ProjectActor,
  projectId: string,
  input: CdrlInput,
): Promise<Ok<CdrlItem> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Only a tenant admin can edit the CDRL register.' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const cdrlNumber = (input.cdrlNumber ?? '').trim();
  const title = (input.title ?? '').trim();
  if (!cdrlNumber || cdrlNumber.length > 40) {
    return { ok: false, status: 400, error: 'A CDRL number of 1–40 characters is required', code: 'VALIDATION_ERROR' };
  }
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }
  const frequency = (input.frequency ?? 'one_time') as CdrlFrequency;
  if (!FREQUENCIES.includes(frequency)) {
    return { ok: false, status: 400, error: `frequency must be one of ${FREQUENCIES.join(', ')}`, code: 'VALIDATION_ERROR' };
  }
  const approvalCode = (input.approvalCode ?? 'I').toUpperCase();
  if (approvalCode !== 'A' && approvalCode !== 'I') {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: "approvalCode must be 'A' (government approval required) or 'I' (information only)",
    };
  }
  const distribution = input.distribution ? String(input.distribution).toUpperCase() : null;
  if (distribution && !(DISTRIBUTION_LETTERS as readonly string[]).includes(distribution)) {
    return { ok: false, status: 400, error: 'distribution must be a letter A–F', code: 'VALIDATION_ERROR' };
  }
  const firstDue = asDate(input.firstDue);
  if (firstDue === false) {
    return { ok: false, status: 400, error: 'firstDue must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  // A recurring item with no first date has no schedule, and every "what is due" query would skip
  // it silently. The database refuses it too; this is here so the message names the field.
  if (RECURRING.has(frequency) && !firstDue) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `A ${frequency.replace('_', ' ')} item needs a first due date — without one it has no `
        + 'schedule, and nothing that asks "what is due" would ever find it.',
    };
  }
  const recurrenceDays = input.recurrenceDays;
  if (recurrenceDays !== null && recurrenceDays !== undefined
      && (!Number.isInteger(recurrenceDays) || recurrenceDays <= 0)) {
    return { ok: false, status: 400, error: 'recurrenceDays must be a positive whole number', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-before-write, scoped to THIS project: a CLIN id from another contract satisfies the FK and
    // would file one customer's data requirement under another's line item.
    if (input.clinId) {
      const [clin] = await sql<{ id: string }[]>`
        SELECT id FROM project_clins
         WHERE id = ${input.clinId}::uuid AND project_id = ${projectId}::uuid
           AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!clin) {
        return { ok: false, status: 400, error: 'That CLIN does not belong to this project', code: 'VALIDATION_ERROR' };
      }
    }

    const [row] = await sql<CdrlItem[]>`
      INSERT INTO project_cdrl_items
        (tenant_id, project_id, cdrl_number, title, did_number, subtitle, clin_id, frequency,
         approval_code, distribution, distribution_note, first_due, recurrence_days, notes, created_by)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${cdrlNumber}, ${title},
         ${(input.didNumber ?? '').trim() || null}, ${(input.subtitle ?? '').trim() || null},
         ${input.clinId ?? null}, ${frequency}, ${approvalCode}, ${distribution},
         ${(input.distributionNote ?? '').trim() || null}, ${firstDue}::date,
         ${recurrenceDays ?? null}, ${(input.notes ?? '').trim() || null}, ${actor.userId}::uuid)
      RETURNING id, project_id, cdrl_number, title, did_number, subtitle, clin_id, frequency,
                approval_code, distribution, distribution_note, first_due, recurrence_days, notes`;

    await emitEventSingle({
      namespace: 'project',
      type: 'cdrl.registered',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, cdrlItemId: row.id, cdrlNumber, title, frequency, distribution },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.cdrl_registered',
      entityType: 'project_cdrl_item', entityId: row.id,
      metadata: { projectId, cdrlNumber, title, frequency },
    });
    return { ok: true, data: row };
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === '23505') {
      return {
        ok: false, status: 409, code: 'DUPLICATE_CDRL_NUMBER',
        error: 'A CDRL with that number is already on this project.',
      };
    }
    console.error('[projects/cdrl] addCdrlItem failed:', err);
    return { ok: false, status: 500, error: 'Failed to add the CDRL item', code: 'DB_ERROR' };
  }
}

/**
 * Record that a deliverable was SENT to the customer.
 *
 * The third state. It is gated on internal acceptance in the database (mig 232's trigger) and here,
 * so the refusal is a sentence rather than a 500 carrying a SQLSTATE.
 */
export async function markSubmitted(
  actor: ProjectActor,
  projectId: string,
  deliverableId: string,
  input: { submittedAt?: string; transmittalRef?: string | null },
): Promise<Ok<{ deliverableId: string; daysLate: number | null }> | Fail> {
  if (!canAssign(actor.role)) {
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      error: 'Only a tenant admin can record a delivery to the customer.',
    };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const submittedAt = asDate(input.submittedAt);
  if (submittedAt === false || submittedAt === null) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'A delivery date (YYYY-MM-DD) is required — lateness against the contract is measured '
        + 'against the day it was SENT, and stamping the moment somebody typed it makes that wrong.',
    };
  }

  try {
    // The deliverable is reached THROUGH its milestone, which carries the project. A deliverable
    // has no `project_id` of its own (mig 216, deliberately), so an id-only lookup would answer for
    // a row belonging to another project of the same tenant.
    const [d] = await sql<{
      id: string; title: string; acceptedAt: string | null; submittedAt: string | null;
      requiredBy: string | null; cdrlNumber: string | null;
    }[]>`
      SELECT d.id, d.title, d.accepted_at, d.submitted_at, d.required_by, c.cdrl_number
        FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
        LEFT JOIN project_cdrl_items c ON c.id = d.cdrl_item_id
       WHERE d.id = ${deliverableId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!d) return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };

    if (d.submittedAt) {
      return {
        ok: false, status: 409, code: 'ALREADY_SUBMITTED',
        error: `"${d.title}" has already been sent to the customer. Send a corrected version `
          + 'instead — the record of what they received has to survive.',
      };
    }
    if (!d.acceptedAt) {
      return {
        ok: false, status: 409, code: 'NOT_ACCEPTED',
        error: `Accept "${d.title}" internally before sending it. Uploading is not accepting, and `
          + 'accepting is not sending.',
      };
    }

    // Compare-and-swap on `submitted_at IS NULL`: two people recording the same delivery cannot
    // both stamp it, and the loser gets the 409 above on its next read rather than a second date
    // silently overwriting the first.
    const [row] = await sql<{ id: string }[]>`
      UPDATE project_deliverables
         SET submitted_at = ${submittedAt}::date, submitted_by = ${actor.userId}::uuid,
             transmittal_ref = ${(input.transmittalRef ?? '').trim() || null}
       WHERE id = ${deliverableId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND submitted_at IS NULL
      RETURNING id`;
    if (!row) {
      return { ok: false, status: 409, code: 'ALREADY_SUBMITTED', error: 'That delivery was recorded by someone else a moment ago.' };
    }

    const daysLate = daysBetween(d.requiredBy, submittedAt);
    await emitEventSingle({
      namespace: 'project',
      type: 'cdrl.submitted',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, deliverableId, title: d.title, cdrlNumber: d.cdrlNumber,
        submittedAt, transmittalRef: (input.transmittalRef ?? '').trim() || null, daysLate,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.cdrl_submitted',
      entityType: 'project_deliverable', entityId: deliverableId,
      metadata: { projectId, cdrlNumber: d.cdrlNumber, submittedAt, daysLate },
    });
    return { ok: true, data: { deliverableId, daysLate } };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === '23001') {
      return { ok: false, status: 409, code: 'NOT_ACCEPTED', error: e.message?.split('\n')[0] ?? 'Accept it first.' };
    }
    console.error('[projects/cdrl] markSubmitted failed:', err);
    return { ok: false, status: 500, error: 'Failed to record the delivery', code: 'DB_ERROR' };
  }
}

/**
 * The distribution marking a deliverable must carry, as a block of text to stamp on the artifact.
 *
 * Returns `null` when the CDRL declares none — an UNMARKED document is the honest rendering of "the
 * contract did not say", and inventing "Distribution Statement A" because it is the permissive one
 * would put a public-release marking on something that may not be publicly releasable.
 */
export function distributionMarking(item: Pick<CdrlItem, 'distribution' | 'distributionNote'>): string | null {
  if (!item.distribution) return null;
  const letter = item.distribution;
  const meaning = DISTRIBUTION_MEANING[letter] ?? '';
  const note = (item.distributionNote ?? '').trim();
  return [`DISTRIBUTION STATEMENT ${letter}: ${meaning}.`, note].filter(Boolean).join(' ');
}
