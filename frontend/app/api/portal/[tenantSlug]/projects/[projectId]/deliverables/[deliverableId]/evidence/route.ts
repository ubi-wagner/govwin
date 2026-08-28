/**
 * The backing for an acceptance — the customer's act, filed by a tenant_admin.
 *
 *   GET   — evidence on this project, newest first.
 *   POST  — file a signed DD-250, a COR email, a receipt. `tenant_admin`+.
 *
 * It NEVER accepts. Evidencing is not accepting, the same way uploading, authoring and approving
 * are not — and what is recorded is a CLAIM ABOUT the customer, never rendered as the customer's
 * own act. This is what stands in for a COR read-only portal, which would have reopened the
 * partner_user boundary that `lib/projects/access.ts` closes.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { fileAcceptanceEvidence, listAcceptanceEvidence } from '@/lib/projects/evidence';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string; deliverableId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      const evidence = await listAcceptanceEvidence(gate.actor.tenantId, projectId);
      return NextResponse.json({ data: { evidence } });
    });
  } catch (err) {
    console.error('[api/portal/projects/deliverables/evidence GET]', err);
    return NextResponse.json({ error: 'Failed to load the evidence', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId, deliverableId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let form: FormData;
      try { form = await request.formData(); }
      catch { return NextResponse.json({ error: 'A multipart upload is required', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'A file is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const str = (k: string) => {
        const v = form.get(k);
        return typeof v === 'string' && v.trim() ? v.trim() : null;
      };

      const result = await fileAcceptanceEvidence(gate.actor, projectId, deliverableId, {
        kind: str('kind') ?? undefined,
        customerName: str('customerName'),
        customerRole: str('customerRole'),
        occurredOn: str('occurredOn'),
        note: str('note'),
        filename: file.name,
        body: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { evidence: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/deliverables/evidence POST]', err);
    return NextResponse.json({ error: 'Failed to file the evidence', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
