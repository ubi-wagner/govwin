/**
 * Revalidation endpoint for CMS content pages.
 * POST — Revalidate a marketing page path to clear ISR cache (admin only).
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { emitEventSingle, userActor } from '@/lib/events';

const VALID_PATHS = new Set([
  '/',
  '/about',
  '/features',
  '/value',
  '/pricing',
  '/how-it-works',
  '/engine',
  '/the-expert',
  '/security',
  '/infosec',
  '/apply',
  '/get-started',
  '/resources',
  '/team',
  '/customers',
  '/blog',
]);

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!path) {
      return NextResponse.json({ error: 'Missing required field: path', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    if (!VALID_PATHS.has(path)) {
      return NextResponse.json(
        { error: `Invalid path. Must be one of: ${[...VALID_PATHS].join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    revalidatePath(path);

    await emitEventSingle({
      namespace: 'system',
      type: 'content.page_revalidated',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: { path },
    });

    return NextResponse.json({ data: { revalidated: true, path } });
  } catch (e) {
    console.error('[api/admin/content/revalidate POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
