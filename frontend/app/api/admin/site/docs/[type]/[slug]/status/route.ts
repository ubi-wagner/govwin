/** POST /api/admin/site/docs/[type]/[slug]/status — archive (retire) or restore a posting. */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { setDocumentStatus } from '@/lib/content-admin';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

// content_type → the public list path that shows it.
const LIST_PATH: Record<string, string> = {
  blog_post: '/resources',
  resource: '/resources',
  guide: '/resources',
  testimonial: '/customers',
  team_member: '/team',
};

// setDocumentStatus reason → HTTP status + client code.
const REASON: Record<string, { status: number; code: string }> = {
  invalid_type: { status: 400, code: 'INVALID_TYPE' },
  no_active: { status: 409, code: 'NO_ACTIVE' },
  no_archived: { status: 409, code: 'NO_ARCHIVED' },
};

export async function POST(req: Request, { params }: { params: Promise<{ type: string; slug: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { type, slug } = await params;

  let action: 'archive' | 'restore';
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: unknown };
    if (body.action !== 'archive' && body.action !== 'restore') {
      return NextResponse.json({ error: 'action must be "archive" or "restore"', code: 'BAD_ACTION' }, { status: 400 });
    }
    action = body.action;
  } catch {
    return NextResponse.json({ error: 'Invalid request body', code: 'BAD_ACTION' }, { status: 400 });
  }

  const startId = await emitEventStart({
    namespace: 'system',
    type: action === 'archive' ? 'content.document_archived' : 'content.document_restored',
    actor: userActor(a.userId, a.email),
    payload: { slug, contentType: type },
  });
  try {
    const result = await setDocumentStatus(slug, type, action);
    if (result.ok) {
      try {
        const list = LIST_PATH[type];
        if (list) revalidatePath(list);
        if (type === 'blog_post' || type === 'resource' || type === 'guide') {
          revalidatePath(`/resources/${slug}`);
        }
      } catch {
        // best-effort; ISR refreshes within its window regardless
      }
    }
    await emitEventEnd(startId, { result: { slug, contentType: type, action, ...result } });
    if (!result.ok) {
      const r = REASON[result.reason ?? ''] ?? { status: 409, code: 'CONFLICT' };
      return NextResponse.json({ error: result.reason ?? 'Cannot change status', code: r.code }, { status: r.status });
    }
    return NextResponse.json({ data: result });
  } catch (e) {
    await emitEventEnd(startId, { error: { message: String(e) } });
    console.error('[api/admin/site/docs/[type]/[slug]/status POST] error:', e);
    return NextResponse.json({ error: 'Failed to change status', code: 'DB_ERROR' }, { status: 500 });
  }
}
