/**
 * One deliverable: attach a file, or accept it.
 *
 * TWO VERBS, DELIBERATELY. POST uploads — any assigned employee, because that is the everyday act
 * of delivery work. PATCH accepts — tenant_admin+, because acceptance is what closes a CLIN, and a
 * file being present is not a deliverable met.
 */
import { NextResponse } from 'next/server';
import { withDelivery } from '@/lib/delivery/gate';
import { acceptDeliverable, uploadDeliverable } from '@/lib/delivery/milestones';

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string; deliverableId: string }> }) {
  try {
    const { tenantSlug, projectId, deliverableId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      let form: FormData;
      try { form = await request.formData(); }
      catch { return NextResponse.json({ error: 'A multipart upload is required', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'A file is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }

      const result = await uploadDeliverable(gate.actor, projectId, deliverableId, {
        filename: file.name, body: Buffer.from(await file.arrayBuffer()), contentType: file.type || null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { deliverable: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/delivery/deliverables/[id] POST]', err);
    return NextResponse.json({ error: 'Failed to upload the deliverable', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string; deliverableId: string }> }) {
  try {
    const { tenantSlug, projectId, deliverableId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      let body: { action?: string };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action !== 'accept') {
        return NextResponse.json({ error: "action must be 'accept'", code: 'VALIDATION_ERROR' }, { status: 400 });
      }

      const result = await acceptDeliverable(gate.actor, projectId, deliverableId);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { deliverable: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/delivery/deliverables/[id] PATCH]', err);
    return NextResponse.json({ error: 'Failed to accept the deliverable', code: 'DB_ERROR' }, { status: 500 });
  }
}
