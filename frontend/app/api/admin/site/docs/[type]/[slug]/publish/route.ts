/** POST /api/admin/site/docs/[type]/[slug]/publish — promote latest draft + revalidate. */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { publishDocument } from '@/lib/content-admin';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

// content_type → the public list path that shows it.
const LIST_PATH: Record<string, string> = {
  blog_post: '/resources',
  resource: '/resources',
  guide: '/resources',
  testimonial: '/customers',
  team_member: '/team',
};

export async function POST(_req: Request, { params }: { params: Promise<{ type: string; slug: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { type, slug } = await params;

  const startId = await emitEventStart({
    namespace: 'system',
    type: 'content.document_published',
    actor: userActor(a.userId, a.email),
    payload: { slug, contentType: type },
  });
  try {
    const result = await publishDocument(slug, type);
    if (result.published) {
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
    await emitEventEnd(startId, { result: { slug, contentType: type, ...result } });
    if (!result.published) {
      return NextResponse.json({ error: 'Nothing to publish', code: 'NO_DRAFT' }, { status: 409 });
    }
    return NextResponse.json({ data: result });
  } catch (e) {
    await emitEventEnd(startId, { error: { message: String(e) } });
    console.error('[api/admin/site/docs/[type]/[slug]/publish POST] error:', e);
    return NextResponse.json({ error: 'Failed to publish', code: 'DB_ERROR' }, { status: 500 });
  }
}
