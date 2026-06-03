/** POST /api/admin/site/pages/[pageKey]/publish — promote latest draft to active + revalidate. */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { publishPage } from '@/lib/content-admin';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

// page_key → public path for ISR revalidation.
const PAGE_PATHS: Record<string, string> = {
  homepage: '/',
  about: '/about',
  features: '/features',
  value: '/value',
  pricing: '/pricing',
  'how-it-works': '/how-it-works',
  engine: '/engine',
  'the-expert': '/the-expert',
  security: '/infosec',
  infosec: '/infosec',
  apply: '/apply',
  'get-started': '/pricing',
  resources: '/resources',
  team: '/team',
  customers: '/customers',
};

export async function POST(req: Request, { params }: { params: Promise<{ pageKey: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { pageKey } = await params;

  let note = '';
  try {
    const b = await req.json();
    note = typeof b?.note === 'string' ? b.note : '';
  } catch {
    // note is optional
  }

  const startId = await emitEventStart({
    namespace: 'system',
    type: 'content.page_published',
    actor: userActor(a.userId, a.email),
    payload: { pageKey, note },
  });
  try {
    const result = await publishPage(pageKey);
    if (result.published) {
      const path = PAGE_PATHS[pageKey];
      if (path) {
        try {
          revalidatePath(path);
        } catch {
          // best-effort revalidation; ISR will refresh within its window regardless
        }
      }
    }
    await emitEventEnd(startId, { result: { pageKey, ...result } });
    if (!result.published) {
      return NextResponse.json({ error: 'Nothing to publish', code: 'NO_DRAFT' }, { status: 409 });
    }
    return NextResponse.json({ data: result });
  } catch (e) {
    await emitEventEnd(startId, { error: { message: String(e) } });
    console.error('[api/admin/site/pages/[pageKey]/publish POST] error:', e);
    return NextResponse.json({ error: 'Failed to publish', code: 'DB_ERROR' }, { status: 500 });
  }
}
