/** POST /api/admin/site/docs/[type]/[slug]/save — save a document draft. */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { saveDocumentDraft, DOC_TYPES, type DocFields } from '@/lib/content-admin';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

export async function POST(req: Request, { params }: { params: Promise<{ type: string; slug: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { type, slug } = await params;
  if (!(DOC_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: 'Invalid content type', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title : '';
  if (!title.trim()) {
    return NextResponse.json({ error: 'title is required', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  const fields: DocFields = {
    title,
    body: typeof body.body === 'string' ? body.body : '',
    excerpt: typeof body.excerpt === 'string' ? body.excerpt : null,
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
    featuredImage: typeof body.featuredImage === 'string' ? body.featuredImage : null,
    externalUrl: typeof body.externalUrl === 'string' ? body.externalUrl : null,
    author: typeof body.author === 'string' ? body.author : null,
  };
  const note = typeof body.note === 'string' ? body.note : 'Saved';

  const startId = await emitEventStart({
    namespace: 'system',
    type: 'content.document_saved',
    actor: userActor(a.userId, a.email),
    payload: { slug, contentType: type, note },
  });
  try {
    const version = await saveDocumentDraft(slug, type, fields, note, { id: a.userId, email: a.email });
    await emitEventEnd(startId, { result: { slug, contentType: type, versionNo: version.versionNo } });
    return NextResponse.json({ data: version });
  } catch (e) {
    await emitEventEnd(startId, { error: { message: String(e) } });
    console.error('[api/admin/site/docs/[type]/[slug]/save POST] error:', e);
    return NextResponse.json({ error: 'Failed to save document', code: 'DB_ERROR' }, { status: 500 });
  }
}
