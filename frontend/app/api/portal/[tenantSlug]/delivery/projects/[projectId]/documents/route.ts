/**
 * The anchor documents — the executed contract and the as-submitted proposal.
 *
 * POST is multipart, because these are real files. The upload goes through `lib/storage`'s driver
 * seam like every other file in the platform, so `STORAGE_DRIVER=local` works here too.
 *
 * ── WHY AN UPLOAD AND NOT A POINTER ──────────────────────────────────────────────────────────
 * Even when we authored the proposal. What lives in `proposals`/`proposal_sections` is a working
 * copy that stayed editable after submission — a deliverable tracing to it traces to something that
 * can still change, while one tracing to the uploaded PDF traces to what was actually signed.
 */
import { NextResponse } from 'next/server';
import { deliveryGate } from '@/lib/delivery/gate';
import { addSourceDocument, listSourceDocuments, getProject, type SourceKind } from '@/lib/delivery/projects';

/** 40 MB. An executed contract with attachments is large; a 40 MB PDF is not a contract. */
const MAX_BYTES = 40 * 1024 * 1024;

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    const gate = await deliveryGate(tenantSlug);
    if ('error' in gate) return gate.error;

    if (!(await getProject(gate.actor, projectId))) {
      return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const documents = await listSourceDocuments(gate.actor.tenantId, projectId);
    return NextResponse.json({ data: { documents } });
  } catch (err) {
    console.error('[api/portal/delivery/documents GET]', err);
    return NextResponse.json({ error: 'Failed to list documents', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    const gate = await deliveryGate(tenantSlug);
    if ('error' in gate) return gate.error;

    let form: FormData;
    try { form = await request.formData(); }
    catch { return NextResponse.json({ error: 'A multipart upload is required', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    const kind = String(form.get('kind') ?? '') as SourceKind;
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A file is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `That file is ${Math.round(file.size / 1e6)} MB; the limit is 40 MB`, code: 'PAYLOAD_TOO_LARGE' },
        { status: 413 },
      );
    }

    const body = Buffer.from(await file.arrayBuffer());
    const result = await addSourceDocument(gate.actor, projectId, {
      kind, filename: file.name, body, contentType: file.type || null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ data: { document: result.data } }, { status: 201 });
  } catch (err) {
    console.error('[api/portal/delivery/documents POST]', err);
    return NextResponse.json({ error: 'Failed to upload the document', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
