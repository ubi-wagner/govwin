/**
 * The CDRL register.
 *
 *   GET   — every data requirement, with its submission history (which IS its deliverables).
 *   POST  — register one.
 *   PATCH — `action: 'submitted'`, recording that a deliverable reached the customer.
 *
 * There is no DELETE. A data requirement written into a contract is removed by a modification, not
 * by a person deciding it no longer applies.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { listCdrlItems, addCdrlItem, markSubmitted } from '@/lib/projects/cdrl';
import { isValidUUID } from '@/lib/validation';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: { items: await listCdrlItems(gate.actor.tenantId, projectId) } });
    });
  } catch (err) {
    console.error('[api/portal/projects/cdrl GET]', err);
    return NextResponse.json({ error: 'Failed to load the CDRL register', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await addCdrlItem(gate.actor, projectId, {
        cdrlNumber: body.cdrlNumber as string,
        title: body.title as string,
        didNumber: (body.didNumber as string) ?? null,
        subtitle: (body.subtitle as string) ?? null,
        clinId: (body.clinId as string) ?? null,
        frequency: body.frequency as string,
        approvalCode: body.approvalCode as string,
        distribution: (body.distribution as string) ?? null,
        distributionNote: (body.distributionNote as string) ?? null,
        firstDue: (body.firstDue as string) ?? null,
        recurrenceDays: (body.recurrenceDays as number) ?? null,
        notes: (body.notes as string) ?? null,
      });
      return result.ok
        ? NextResponse.json({ data: { item: result.data } }, { status: 201 })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/cdrl POST]', err);
    return NextResponse.json({ error: 'Failed to add the CDRL item', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action !== 'submitted') {
        return NextResponse.json(
          { error: "action must be 'submitted', with a deliverableId and a submittedAt date", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const deliverableId = String(body.deliverableId ?? '');
      if (!isValidUUID(deliverableId)) {
        return NextResponse.json({ error: 'deliverableId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await markSubmitted(gate.actor, projectId, deliverableId, {
        submittedAt: body.submittedAt as string,
        transmittalRef: (body.transmittalRef as string) ?? null,
      });
      return result.ok
        ? NextResponse.json({ data: result.data })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/cdrl PATCH]', err);
    return NextResponse.json({ error: 'Failed to record the delivery', code: 'DB_ERROR' }, { status: 500 });
  }
}
