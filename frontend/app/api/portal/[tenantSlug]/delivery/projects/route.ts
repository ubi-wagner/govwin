/**
 * Delivery projects for a tenant.
 *
 *   GET  — the projects this actor may see. A tenant_admin sees the company's; an employee sees
 *          exactly what they are assigned. The scoping is in `listProjectsForActor`, which has its
 *          own boundary test, because RLS cannot express the assignment half.
 *   POST — open a workspace. tenant_admin+ only.
 */
import { NextResponse } from 'next/server';
import { withDelivery } from '@/lib/delivery/gate';
import { listProjectsForActor } from '@/lib/delivery/access';
import { createProject } from '@/lib/delivery/projects';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      const projects = await listProjectsForActor(gate.actor);
      return NextResponse.json({ data: { projects } });
    });
  } catch (err) {
    console.error('[api/portal/delivery/projects GET]', err);
    return NextResponse.json({ error: 'Failed to list delivery projects', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      let body: { name?: string; contractId?: string | null };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await createProject(gate.actor, { name: body?.name ?? '', contractId: body?.contractId ?? null });
      if (!result.ok) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      }
      return NextResponse.json({ data: { project: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/delivery/projects POST]', err);
    return NextResponse.json({ error: 'Failed to create the delivery workspace', code: 'DB_ERROR' }, { status: 500 });
  }
}
