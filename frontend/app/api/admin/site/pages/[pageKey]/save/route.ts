/** POST /api/admin/site/pages/[pageKey]/save — save a whole-page draft snapshot. */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { saveDraft, type PageBlock } from '@/lib/content-admin';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

export async function POST(req: Request, { params }: { params: Promise<{ pageKey: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { pageKey } = await params;

  let body: { blocks?: unknown; note?: unknown; title?: unknown; contentType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  if (!Array.isArray(body.blocks)) {
    return NextResponse.json({ error: 'blocks must be an array', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  const note = typeof body.note === 'string' ? body.note : '';
  const title = typeof body.title === 'string' ? body.title : null;
  const contentType = typeof body.contentType === 'string' ? body.contentType : 'page';

  const startId = await emitEventStart({
    namespace: 'system',
    type: 'content.page_saved',
    actor: userActor(a.userId, a.email),
    payload: { pageKey, note },
  });
  try {
    const version = await saveDraft(
      pageKey,
      body.blocks as PageBlock[],
      note,
      { id: a.userId, email: a.email },
      { title, contentType },
    );
    await emitEventEnd(startId, { result: { pageKey, versionNo: version.versionNo } });
    return NextResponse.json({ data: version });
  } catch (e) {
    await emitEventEnd(startId, { error: { message: String(e) } });
    console.error('[api/admin/site/pages/[pageKey]/save POST] error:', e);
    return NextResponse.json({ error: 'Failed to save draft', code: 'DB_ERROR' }, { status: 500 });
  }
}
