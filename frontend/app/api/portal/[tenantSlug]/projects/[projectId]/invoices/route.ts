/**
 * Invoicing.
 *
 *   GET    — the billing history, the per-CLIN position (authorised · claimed · paid · remaining)
 *            and the approved-but-unbilled hours an invoice can be assembled from.
 *   POST   — draft one. Nothing is claimed until it is submitted.
 *   PATCH  — `action: 'submit' | 'pay' | 'void'`.
 *
 * There is no DELETE. A draft is voided like anything else, because an invoice number that was
 * issued and then vanished is a gap somebody has to explain to an auditor.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import {
  listInvoices, clinBilling, billableHours,
  draftInvoice, submitInvoice, recordPayment, voidInvoice,
  type LineInput,
} from '@/lib/projects/invoices';
import { isValidUUID } from '@/lib/validation';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      const [invoices, billing, unbilled] = await Promise.all([
        listInvoices(gate.actor.tenantId, projectId),
        clinBilling(gate.actor.tenantId, projectId),
        billableHours(gate.actor.tenantId, projectId),
      ]);
      return NextResponse.json({ data: { invoices, billing, unbilled } });
    });
  } catch (err) {
    console.error('[api/portal/projects/invoices GET]', err);
    return NextResponse.json({ error: 'Failed to load the invoices', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await draftInvoice(gate.actor, projectId, {
        invoiceNumber: body.invoiceNumber as string,
        periodStart: (body.periodStart as string) ?? null,
        periodEnd: (body.periodEnd as string) ?? null,
        notes: (body.notes as string) ?? null,
        lines: Array.isArray(body.lines) ? (body.lines as LineInput[]) : [],
      });
      return result.ok
        ? NextResponse.json({ data: { invoice: result.data } }, { status: 201 })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/invoices POST]', err);
    return NextResponse.json({ error: 'Failed to raise the invoice', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const invoiceId = String(body.invoiceId ?? '');
      if (!isValidUUID(invoiceId)) {
        return NextResponse.json({ error: 'invoiceId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }

      const action = body.action;
      const result =
          action === 'submit' ? await submitInvoice(gate.actor, projectId, invoiceId, { submittedOn: body.submittedOn as string })
        : action === 'pay'    ? await recordPayment(gate.actor, projectId, invoiceId, { amount: body.amount as number, paidOn: body.paidOn as string })
        : action === 'void'   ? await voidInvoice(gate.actor, projectId, invoiceId, (body.reason as string) ?? '')
        : null;

      if (!result) {
        return NextResponse.json(
          { error: "action must be 'submit', 'pay' or 'void'", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      return result.ok
        ? NextResponse.json({ data: result.data })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/invoices PATCH]', err);
    return NextResponse.json({ error: 'Failed to update the invoice', code: 'DB_ERROR' }, { status: 500 });
  }
}
