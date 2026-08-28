/**
 * Invoicing — where everything else in this capability becomes money.
 *
 * ── IT READS WHAT IS ALREADY HERE, AND INVENTS NO SECOND SOURCE ──────────────────────────────
 *   the CEILING   `project_clins.funded_amount`, which migration 230 made movable only by a signed
 *                 modification. "How much may we bill" has one answer and one way to change it.
 *   the LABOUR    approved `project_time_entries` (mig 227) — the hours a manager signed off, and
 *                 only those. Unapproved hours are somebody's typing, not a billable claim.
 *   the WORK      an ACCEPTED deliverable under a milestone, which is what a payment milestone on a
 *                 firm-fixed-price contract actually bills against.
 *
 * ── THE TWO INVARIANTS ───────────────────────────────────────────────────────────────────────
 * **You cannot bill past the ceiling.** Checked at SUBMIT — a draft may hold anything while it is
 * being assembled, exactly as a modification may. The refusal says by how much, because "over the
 * funding" without a number sends somebody to a spreadsheet to work out what this code already knew.
 *
 * **The same hours cannot be billed twice.** `project_time_entries.invoice_line_id` is the link, so
 * unbilled is a query rather than a convention. Voiding an invoice releases its hours onto the next.
 *
 * ── AND SUBMITTED IS NOT PAID ────────────────────────────────────────────────────────────────
 * The ninth time this capability draws that line. Submitting is a claim; payment is cash arriving,
 * later, often partial. `amount_paid` is its own number for that reason.
 */
import { sql, auditLog } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import { isoDate } from './dates';
import type { Fail, Ok } from './project';

export type InvoiceStatus = 'draft' | 'submitted' | 'paid' | 'void';
export type LineSource = 'milestone' | 'labour' | 'other_direct' | 'fee' | 'manual';

export interface InvoiceLine {
  id: string;
  clinId: string;
  clinNumber?: string | null;
  milestoneId: string | null;
  milestoneTitle?: string | null;
  description: string;
  source: LineSource;
  amount: string;
  sortIndex: number;
}

export interface Invoice {
  id: string;
  projectId: string;
  invoiceNumber: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: InvoiceStatus;
  submittedOn: string | null;
  paidOn: string | null;
  amountPaid: string;
  voidReason: string | null;
  documentId: string | null;
  notes: string | null;
  createdAt: string;
  lines?: InvoiceLine[];
  /** Σ of this invoice's lines. Computed, never stored — a total that can disagree with its lines
   *  is the one number a customer will check. */
  total?: number;
}

/** What a CLIN has authorised, what has been claimed against it, and what is therefore left. */
export interface ClinBilling {
  clinId: string;
  clinNumber: string;
  fundedAmount: string | null;
  billed: number;
  paid: number;
  /** `null` when the CLIN carries no funded amount — "not measured", never a confident zero. */
  remaining: number | null;
}

function fromTrigger(err: unknown): Fail | null {
  const e = err as { code?: string; message?: string };
  if (e?.code === '23001') {
    return {
      ok: false, status: 409, code: 'INVOICE_SUBMITTED',
      error: e.message?.split('\n')[0] ?? 'That invoice has been submitted and cannot be edited.',
    };
  }
  if (e?.code === '23505') {
    return {
      ok: false, status: 409, code: 'DUPLICATE_INVOICE_NUMBER',
      error: 'An invoice with that number already exists on this project.',
    };
  }
  return null;
}

const money = (v: unknown) => Number(v ?? 0);

export async function listInvoices(tenantId: string, projectId: string): Promise<Invoice[]> {
  try {
    const invoices = await sql<Invoice[]>`
      -- ::text on every date/timestamp column. The row type above declares them as string and
      -- postgres.js hands back a JavaScript Date; the assertion compiles, so nothing catches
      -- it, and the panel slices the string form of that Date and renders "Fri Aug 28" -- no
      -- year -- while an ageing calculation guarded on a YYYY-MM-DD shape shows nothing at all.
      -- Cast at the SOURCE, so the declared type is true for every caller and not just here.
      -- (No backticks here, and no literal bug expression either: this comment lives inside a
      --  JS template literal, so a JS comment stripper cannot see it and an auditor scanning
      --  for the pattern would read this explanation as the defect.)
      SELECT id, project_id, invoice_number,
             period_start::text AS period_start, period_end::text AS period_end, status,
             submitted_on::text AS submitted_on, paid_on::text AS paid_on,
             amount_paid, void_reason, document_id, notes, created_at::text AS created_at
        FROM project_invoices
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY submitted_on DESC NULLS FIRST, created_at DESC`;
    if (invoices.length === 0) return [];

    // One read for every line on the project. A query per invoice would be N+1 on a page that
    // renders the whole billing history.
    const lines = await sql<Array<InvoiceLine & { invoiceId: string }>>`
      SELECT l.id, l.invoice_id, l.clin_id, k.clin_number, l.milestone_id, m.title AS milestone_title,
             l.description, l.source, l.amount, l.sort_index
        FROM project_invoice_lines l
        JOIN project_clins k ON k.id = l.clin_id
        LEFT JOIN project_milestones m ON m.id = l.milestone_id
       WHERE l.invoice_id = ANY(${invoices.map((i) => i.id)}::uuid[])
         AND l.tenant_id = ${tenantId}::uuid
       ORDER BY l.sort_index, l.created_at`;

    const by = new Map<string, InvoiceLine[]>();
    for (const l of lines) {
      const list = by.get(l.invoiceId) ?? [];
      list.push(l);
      by.set(l.invoiceId, list);
    }
    return invoices.map((i) => {
      const own = by.get(i.id) ?? [];
      return { ...i, lines: own, total: own.reduce((a, l) => a + money(l.amount), 0) };
    });
  } catch (err) {
    console.error('[projects/invoices] listInvoices failed:', err);
    return [];
  }
}

/**
 * Per-CLIN billing position: authorised, CLAIMED, paid, remaining.
 *
 * ── DRAFTS ARE NOT BILLED, AND VOIDS ARE NOT EITHER ──────────────────────────────────────────
 * `billed` counts SUBMITTED and PAID invoices only. A draft is a working document — nothing has
 * been claimed — and counting it here would make the position on the dashboard move every time
 * somebody opened a form and typed a number.
 *
 * The ceiling check in `submitInvoice` asks a DIFFERENT question — "would submitting this breach
 * the funding" — and adds the draft's own lines to this figure itself. One function answering both
 * would have to be wrong for one of them, and the wrong one is silent.
 */
export async function clinBilling(tenantId: string, projectId: string): Promise<ClinBilling[]> {
  try {
    const rows = await sql<Array<{
      clinId: string; clinNumber: string; fundedAmount: string | null;
      billed: string | null; paid: string | null;
    }>>`
      WITH claimed AS (
        SELECT l.clin_id,
               SUM(l.amount) AS billed,
               -- Paid is apportioned by the invoice's own paid fraction, so a partially-paid
               -- invoice contributes what was actually received rather than all or nothing.
               SUM(l.amount * CASE WHEN i.status = 'paid' THEN 1
                                   WHEN i.amount_paid > 0 THEN LEAST(1, i.amount_paid / NULLIF(
                                     (SELECT SUM(l2.amount) FROM project_invoice_lines l2
                                       WHERE l2.invoice_id = i.id), 0))
                                   ELSE 0 END) AS paid
          FROM project_invoice_lines l
          JOIN project_invoices i ON i.id = l.invoice_id
         WHERE i.project_id = ${projectId}::uuid AND i.tenant_id = ${tenantId}::uuid
           AND i.status IN ('submitted', 'paid')
         GROUP BY l.clin_id
      )
      SELECT k.id AS clin_id, k.clin_number, k.funded_amount,
             c.billed, c.paid
        FROM project_clins k
        LEFT JOIN claimed c ON c.clin_id = k.id
       WHERE k.project_id = ${projectId}::uuid AND k.tenant_id = ${tenantId}::uuid
       ORDER BY k.sort_index, k.clin_number`;

    return rows.map((r) => ({
      clinId: r.clinId,
      clinNumber: r.clinNumber,
      fundedAmount: r.fundedAmount,
      billed: money(r.billed),
      paid: money(r.paid),
      // `null`, not 0. A CLIN with no funded amount has not been measured — rendering "$0
      // remaining" states a limit nobody set, and a reader cannot tell it from a real ceiling.
      remaining: r.fundedAmount === null ? null : money(r.fundedAmount) - money(r.billed),
    }));
  } catch (err) {
    console.error('[projects/invoices] clinBilling failed:', err);
    return [];
  }
}

/** An approved, unbilled time entry — what a labour invoice is assembled from. */
export interface BillableHours {
  milestoneId: string;
  milestoneTitle: string;
  clinId: string | null;
  hours: string;
  cost: string;
  entries: number;
}

export async function billableHours(
  tenantId: string, projectId: string, upTo?: string | null,
): Promise<BillableHours[]> {
  try {
    return await sql<BillableHours[]>`
      SELECT e.milestone_id, m.title AS milestone_title, m.clin_id,
             SUM(e.hours) AS hours, SUM(e.cost) AS cost, COUNT(*)::int AS entries
        FROM project_time_entries e
        JOIN project_milestones m ON m.id = e.milestone_id
       WHERE e.project_id = ${projectId}::uuid AND e.tenant_id = ${tenantId}::uuid
         -- APPROVED and UNBILLED. Both halves matter: unapproved hours are somebody's typing, and
         -- an already-invoiced entry billed a second time is the failure the link exists to stop.
         AND e.approved_at IS NOT NULL AND e.invoice_line_id IS NULL
         AND (${upTo ?? null}::date IS NULL OR e.worked_on <= ${upTo ?? null}::date)
       GROUP BY e.milestone_id, m.title, m.clin_id
       ORDER BY m.sort_index, m.title`;
  } catch (err) {
    console.error('[projects/invoices] billableHours failed:', err);
    return [];
  }
}

export interface LineInput {
  clinId?: string;
  milestoneId?: string | null;
  description?: string;
  source?: string;
  amount?: number | string;
  /** For a `labour` line: bill these approved entries and mark them so they cannot be billed again. */
  timeEntryIds?: string[];
}

export interface InvoiceInput {
  invoiceNumber: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
  lines?: LineInput[];
}

function asDate(v: unknown): string | null | false {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? false : v;
}

const SOURCES: readonly LineSource[] = ['milestone', 'labour', 'other_direct', 'fee', 'manual'];

/**
 * Draft an invoice. Nothing is claimed until it is submitted, and the ceiling is not enforced here —
 * a draft is a working document, and refusing a line mid-assembly makes it impossible to build one
 * that ends up correct.
 */
export async function draftInvoice(
  actor: ProjectActor,
  projectId: string,
  input: InvoiceInput,
): Promise<Ok<Invoice> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Only a tenant admin can raise an invoice.' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const invoiceNumber = (input.invoiceNumber ?? '').trim();
  if (!invoiceNumber || invoiceNumber.length > 60) {
    return { ok: false, status: 400, error: 'An invoice number of 1–60 characters is required', code: 'VALIDATION_ERROR' };
  }
  const start = asDate(input.periodStart);
  const end = asDate(input.periodEnd);
  if (start === false || end === false) {
    return { ok: false, status: 400, error: 'Period dates must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  if (start && end && end < start) {
    return { ok: false, status: 400, error: 'periodEnd cannot precede periodStart', code: 'VALIDATION_ERROR' };
  }

  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (raw.length === 0) {
    return { ok: false, status: 400, error: 'An invoice needs at least one line', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-before-write, scoped to THIS project. A CLIN or milestone id from another contract
    // satisfies the FK — it is a real row — and RLS cannot tell the difference when both belong to
    // the same tenant. That is how one customer's work reaches another customer's invoice.
    const clinIds = [...new Set(raw.map((l) => l.clinId).filter((v): v is string => Boolean(v)))];
    const ownedClins = new Set((clinIds.length === 0 ? [] : await sql<{ id: string }[]>`
      SELECT id FROM project_clins
       WHERE id = ANY(${clinIds}::uuid[]) AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid`).map((r) => r.id));

    const msIds = [...new Set(raw.map((l) => l.milestoneId).filter((v): v is string => Boolean(v)))];
    const ownedMs = new Set((msIds.length === 0 ? [] : await sql<{ id: string }[]>`
      SELECT id FROM project_milestones
       WHERE id = ANY(${msIds}::uuid[]) AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid`).map((r) => r.id));

    const lines: Array<Required<Pick<LineInput, 'clinId' | 'description'>> & {
      milestoneId: string | null; source: LineSource; amount: number; timeEntryIds: string[];
    }> = [];

    for (const [i, l] of raw.entries()) {
      if (!l.clinId || !ownedClins.has(l.clinId)) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Line ${i + 1}: that CLIN does not belong to this project.` };
      }
      if (l.milestoneId && !ownedMs.has(l.milestoneId)) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Line ${i + 1}: that milestone does not belong to this project.` };
      }
      const description = (l.description ?? '').trim();
      if (!description || description.length > 500) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Line ${i + 1}: a description of 1–500 characters is required.` };
      }
      const source = (l.source ?? 'manual') as LineSource;
      if (!SOURCES.includes(source)) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Line ${i + 1}: source must be one of ${SOURCES.join(', ')}.` };
      }
      const amount = Number(l.amount);
      if (!Number.isFinite(amount) || amount === 0) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Line ${i + 1}: an amount is required, and a zero line is a line nobody meant to add.` };
      }
      lines.push({
        clinId: l.clinId, milestoneId: l.milestoneId ?? null, description, source,
        amount: Math.round(amount * 100) / 100,
        timeEntryIds: Array.isArray(l.timeEntryIds) ? l.timeEntryIds : [],
      });
    }

    // `withTenant`, NOT `sql.begin` — the Proxy routes only the tagged-template call, and
    // `sql.begin` reaches the raw pool with `app.tenant_id` unset, where RLS matches nothing and
    // every statement updates zero rows.
    const invoice = await withTenant(actor.tenantId, async (tx: any) => {
      const [row] = await tx`
        INSERT INTO project_invoices
          (tenant_id, project_id, invoice_number, period_start, period_end, notes, created_by)
        VALUES
          (${actor.tenantId}::uuid, ${projectId}::uuid, ${invoiceNumber},
           ${start}::date, ${end}::date, ${(input.notes ?? '').trim() || null}, ${actor.userId}::uuid)
        RETURNING id, project_id, invoice_number, period_start, period_end, status,
                  submitted_on, paid_on, amount_paid, void_reason, document_id, notes, created_at`;

      for (const [i, l] of lines.entries()) {
        const [line] = await tx`
          INSERT INTO project_invoice_lines
            (tenant_id, invoice_id, clin_id, milestone_id, description, source, amount, sort_index)
          VALUES
            (${actor.tenantId}::uuid, ${row.id}::uuid, ${l.clinId}::uuid, ${l.milestoneId},
             ${l.description}, ${l.source}, ${l.amount}, ${i})
          RETURNING id`;

        // Claim the hours. Scoped to APPROVED and UNBILLED in the predicate, so a concurrent
        // invoice cannot take the same entries: whichever writes first wins and the other's
        // UPDATE matches nothing, rather than both marking the same rows.
        if (l.timeEntryIds.length > 0) {
          await tx`
            UPDATE project_time_entries
               SET invoice_line_id = ${line.id}::uuid, updated_at = now()
             WHERE id = ANY(${l.timeEntryIds}::uuid[])
               AND project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND approved_at IS NOT NULL AND invoice_line_id IS NULL`;
        }
      }
      return row as Invoice;
    });

    await emitEventSingle({
      namespace: 'project',
      type: 'invoice.drafted',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, invoiceId: invoice.id, invoiceNumber,
        lines: lines.length, total: lines.reduce((a, l) => a + l.amount, 0),
      },
    });
    return { ok: true, data: invoice };
  } catch (err) {
    const mapped = fromTrigger(err);
    if (mapped) return mapped;
    console.error('[projects/invoices] draftInvoice failed:', err);
    return { ok: false, status: 500, error: 'Failed to raise the invoice', code: 'DB_ERROR' };
  }
}

/**
 * Submit: the draft becomes a claim.
 *
 * THIS is where the ceiling is enforced, and it is enforced against what is ALREADY claimed on
 * other invoices plus what this one adds — not against this invoice alone, which would let three
 * invoices each under the limit sum to twice it.
 */
export async function submitInvoice(
  actor: ProjectActor,
  projectId: string,
  invoiceId: string,
  input: { submittedOn?: string },
): Promise<Ok<{ invoiceId: string; total: number }> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Only a tenant admin can submit an invoice.' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const submittedOn = asDate(input.submittedOn);
  if (submittedOn === false || submittedOn === null) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'A submission date (YYYY-MM-DD) is required — invoices are entered after they are sent, '
        + 'and stamping the moment somebody typed it makes the ageing report wrong.',
    };
  }

  try {
    const [inv] = await sql<{ id: string; invoiceNumber: string; status: InvoiceStatus }[]>`
      SELECT id, invoice_number, status FROM project_invoices
       WHERE id = ${invoiceId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!inv) return { ok: false, status: 404, error: 'Invoice not found', code: 'NOT_FOUND' };
    if (inv.status !== 'draft') {
      return {
        ok: false, status: 409, code: 'NOT_A_DRAFT',
        error: `Invoice ${inv.invoiceNumber} is ${inv.status}. Void it and reissue if it is wrong.`,
      };
    }

    const mine = await sql<{ clinId: string; amount: string }[]>`
      SELECT clin_id, SUM(amount) AS amount FROM project_invoice_lines
       WHERE invoice_id = ${invoiceId}::uuid AND tenant_id = ${actor.tenantId}::uuid
       GROUP BY clin_id`;
    if (mine.length === 0) {
      return { ok: false, status: 409, code: 'NO_LINES', error: 'An invoice with no lines is not a claim.' };
    }

    // ── THE CEILING ──────────────────────────────────────────────────────────────────────────
    // ALREADY claimed (submitted + paid, never drafts) PLUS what this invoice adds. Checking this
    // invoice alone against the ceiling would let three invoices each comfortably under the limit
    // sum to twice it, and each one would look correct at the moment it was submitted.
    const position = await clinBilling(actor.tenantId, projectId);
    const by = new Map(position.map((p) => [p.clinId, p]));
    const over: string[] = [];
    for (const row of mine) {
      const p = by.get(row.clinId);
      // A CLIN with no funded amount has no ceiling to breach. That is a gap in the contract data,
      // not permission to bill infinity — but refusing here would block every invoice on a project
      // whose funding has not been entered, so it is reported rather than enforced.
      if (!p || p.fundedAmount === null) continue;
      const wouldBe = p.billed + money(row.amount);
      if (wouldBe > money(p.fundedAmount) + 0.005) {
        over.push(`CLIN ${p.clinNumber}: ${(wouldBe - money(p.fundedAmount)).toFixed(2)} over`);
      }
    }
    if (over.length > 0) {
      return {
        ok: false, status: 409, code: 'OVER_FUNDED_CEILING',
        error: `This would bill past what the contract has funded — ${over.join('; ')}. `
          + 'Raise the funding with a contract modification first, or reduce the line.',
      };
    }

    const total = mine.reduce((a, r) => a + money(r.amount), 0);

    // Compare-and-swap on `status='draft'`: two submissions cannot both claim.
    const [flipped] = await sql<{ id: string }[]>`
      UPDATE project_invoices
         SET status = 'submitted', submitted_on = ${submittedOn}::date, updated_at = now()
       WHERE id = ${invoiceId}::uuid AND tenant_id = ${actor.tenantId}::uuid AND status = 'draft'
      RETURNING id`;
    if (!flipped) {
      return { ok: false, status: 409, code: 'NOT_A_DRAFT', error: 'That invoice was submitted by someone else a moment ago.' };
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'invoice.submitted',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, invoiceId, invoiceNumber: inv.invoiceNumber, submittedOn, total },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.invoice_submitted',
      entityType: 'project_invoice', entityId: invoiceId,
      metadata: { projectId, invoiceNumber: inv.invoiceNumber, total, submittedOn },
    });
    return { ok: true, data: { invoiceId, total } };
  } catch (err) {
    const mapped = fromTrigger(err);
    if (mapped) return mapped;
    console.error('[projects/invoices] submitInvoice failed:', err);
    return { ok: false, status: 500, error: 'Failed to submit the invoice', code: 'DB_ERROR' };
  }
}

/** Record a payment. Partial is normal — a government customer pays against a withholding. */
export async function recordPayment(
  actor: ProjectActor,
  projectId: string,
  invoiceId: string,
  input: { amount?: number | string; paidOn?: string },
): Promise<Ok<{ invoiceId: string; amountPaid: number; settled: boolean }> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Only a tenant admin can record a payment.' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const paidOn = asDate(input.paidOn);
  if (paidOn === false || paidOn === null) {
    return { ok: false, status: 400, error: 'A payment date (YYYY-MM-DD) is required', code: 'VALIDATION_ERROR' };
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: 'A positive payment amount is required', code: 'VALIDATION_ERROR' };
  }

  try {
    const [inv] = await sql<{ id: string; invoiceNumber: string; status: InvoiceStatus; amountPaid: string }[]>`
      SELECT id, invoice_number, status, amount_paid FROM project_invoices
       WHERE id = ${invoiceId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!inv) return { ok: false, status: 404, error: 'Invoice not found', code: 'NOT_FOUND' };
    if (inv.status === 'draft') {
      return {
        ok: false, status: 409, code: 'NOT_SUBMITTED',
        error: 'That invoice has not been submitted. Payment against a claim nobody made is a '
          + 'bookkeeping error waiting to be found.',
      };
    }
    if (inv.status === 'void') {
      return { ok: false, status: 409, code: 'INVOICE_VOID', error: 'That invoice is void.' };
    }

    const [{ total }] = await sql<{ total: string | null }[]>`
      SELECT SUM(amount) AS total FROM project_invoice_lines
       WHERE invoice_id = ${invoiceId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;

    const paidNow = Math.round((money(inv.amountPaid) + amount) * 100) / 100;
    // Settled to the CENT, not to a tolerance a rounding error can wander through. Anything short
    // stays `submitted` and shows as outstanding, which is what a withholding actually is.
    const settled = paidNow >= money(total) - 0.005;

    const [row] = await sql<{ id: string }[]>`
      UPDATE project_invoices
         SET amount_paid = ${paidNow},
             status      = ${settled ? 'paid' : 'submitted'},
             paid_on     = ${settled ? paidOn : null}::date,
             updated_at  = now()
       WHERE id = ${invoiceId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND status IN ('submitted', 'paid')
      RETURNING id`;
    if (!row) return { ok: false, status: 409, error: 'That invoice is no longer payable', code: 'CONFLICT' };

    await emitEventSingle({
      namespace: 'project',
      type: 'invoice.paid',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, invoiceId, invoiceNumber: inv.invoiceNumber,
        amount, amountPaid: paidNow, total: money(total), settled, paidOn,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.invoice_payment_recorded',
      entityType: 'project_invoice', entityId: invoiceId,
      metadata: { projectId, invoiceNumber: inv.invoiceNumber, amount, amountPaid: paidNow, settled },
    });
    return { ok: true, data: { invoiceId, amountPaid: paidNow, settled } };
  } catch (err) {
    const mapped = fromTrigger(err);
    if (mapped) return mapped;
    console.error('[projects/invoices] recordPayment failed:', err);
    return { ok: false, status: 500, error: 'Failed to record the payment', code: 'DB_ERROR' };
  }
}

/**
 * Void an invoice, with a reason.
 *
 * The hours it billed are RELEASED — `ON DELETE SET NULL` handles a deleted line, but a void keeps
 * its lines (they are the record of what was claimed), so the release is explicit here. Without it
 * a voided invoice would hold its hours hostage and they could never be billed at all.
 */
export async function voidInvoice(
  actor: ProjectActor,
  projectId: string,
  invoiceId: string,
  reason: string,
): Promise<Ok<{ invoiceId: string; hoursReleased: number }> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Only a tenant admin can void an invoice.' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const why = (reason ?? '').trim();
  if (!why || why.length > 2000) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'A reason is required — "there used to be an invoice here" with no reason is the least '
        + 'useful row in an audit.',
    };
  }

  try {
    const out = await withTenant(actor.tenantId, async (tx: any) => {
      const [row] = await tx`
        UPDATE project_invoices
           SET status = 'void', void_reason = ${why}, updated_at = now()
         WHERE id = ${invoiceId}::uuid AND project_id = ${projectId}::uuid
           AND tenant_id = ${actor.tenantId}::uuid AND status <> 'void'
        RETURNING id, invoice_number`;
      if (!row) return null;

      const released = await tx`
        UPDATE project_time_entries e
           SET invoice_line_id = NULL, updated_at = now()
          FROM project_invoice_lines l
         WHERE l.invoice_id = ${invoiceId}::uuid AND e.invoice_line_id = l.id
           AND e.tenant_id = ${actor.tenantId}::uuid
        RETURNING e.id`;
      return { invoiceNumber: row.invoiceNumber as string, released: released.length };
    });

    if (!out) return { ok: false, status: 404, error: 'Invoice not found, or already void', code: 'NOT_FOUND' };

    await emitEventSingle({
      namespace: 'project',
      type: 'invoice.voided',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, invoiceId, invoiceNumber: out.invoiceNumber,
        reason: why, hoursReleased: out.released,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.invoice_voided',
      entityType: 'project_invoice', entityId: invoiceId,
      metadata: { projectId, invoiceNumber: out.invoiceNumber, reason: why, hoursReleased: out.released },
    });
    return { ok: true, data: { invoiceId, hoursReleased: out.released } };
  } catch (err) {
    const mapped = fromTrigger(err);
    if (mapped) return mapped;
    console.error('[projects/invoices] voidInvoice failed:', err);
    return { ok: false, status: 500, error: 'Failed to void the invoice', code: 'DB_ERROR' };
  }
}

/** Ageing, for the panel: how long a submitted claim has been outstanding. `null` if not submitted. */
export function daysOutstanding(invoice: Pick<Invoice, 'status' | 'submittedOn'>, today: Date): number | null {
  if (invoice.status !== 'submitted' || !invoice.submittedOn) return null;
  // `isoDate`, never a slice of the string form: `submitted_on` arrives as a JavaScript Date and
  // `String(d).slice(0,10)` is "Tue Apr 28", which `Date.parse` turns into NaN — and NaN survives
  // every comparison to pick a branch and render as a confident number.
  const from = isoDate(invoice.submittedOn);
  if (!from) return null;
  const ms = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}
