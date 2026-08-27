/**
 * CLINs on a delivery project.
 *
 *   GET  — the line items, ordered by `sort_index` (never by clin_number as a string), with the
 *          provenance of every field so the page can badge each one.
 *   POST — add a CLIN, with optional per-field citations. A citing method with nothing to cite is
 *          refused inside `recordProvenance`: "Read from source" must never appear against a source
 *          nobody can open.
 */
import { NextResponse } from 'next/server';
import { withDelivery } from '@/lib/delivery/gate';
import { getProject } from '@/lib/delivery/projects';
import { createClin, listClins, type ClinInput } from '@/lib/delivery/clins';
import { provenanceFor } from '@/lib/delivery/provenance';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      const clins = await listClins(gate.actor.tenantId, projectId);
      const provenance: Record<string, Awaited<ReturnType<typeof provenanceFor>>> = {};
      for (const clin of clins) {
        provenance[clin.id] = await provenanceFor(gate.actor.tenantId, 'delivery_clins', clin.id);
      }
      return NextResponse.json({ data: { clins, provenance } });
    });
  } catch (err) {
    console.error('[api/portal/delivery/clins GET]', err);
    return NextResponse.json({ error: 'Failed to list CLINs', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      let body: ClinInput;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await createClin(gate.actor, projectId, body ?? ({} as ClinInput));
      if (!result.ok) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      }
      return NextResponse.json({ data: { clin: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/delivery/clins POST]', err);
    return NextResponse.json({ error: 'Failed to create the CLIN', code: 'DB_ERROR' }, { status: 500 });
  }
}
