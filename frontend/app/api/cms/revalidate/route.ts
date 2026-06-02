/**
 * CMS content revalidation webhook.
 *
 * Called by the CRM-CMS publish bridge (service-to-service) to clear the ISR
 * cache for a marketing page the instant content is published, and optionally
 * by an authenticated admin session. Service callers authenticate with a shared
 * secret (REVALIDATE_SECRET); browser callers fall back to an admin session.
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'crypto';
import { auth } from '@/auth';
import { emitEventSingle, userActor, systemActor } from '@/lib/events';

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

/** Constant-time comparison of the provided secret against REVALIDATE_SECRET. */
function secretMatches(provided: string): boolean {
  const expected = process.env.REVALIDATE_SECRET ?? '';
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  try {
    // Service-to-service auth (CMS publish bridge) via shared secret, else admin session.
    const provided = request.headers.get('x-revalidate-secret') ?? '';
    const viaSecret = secretMatches(provided);

    let actorId: string | undefined;
    let actorEmail: string | undefined;
    if (!viaSecret) {
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
      }
      const role = (session.user as { role?: string }).role;
      if (role !== 'rfp_admin' && role !== 'master_admin') {
        return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
      }
      actorId = (session.user as { id?: string }).id;
      actorEmail = (session.user as { email?: string }).email;
      if (!actorId) {
        return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
      }
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
      actor: viaSecret ? systemActor('cms-bridge') : userActor(actorId!, actorEmail),
      payload: { path, via: viaSecret ? 'bridge' : 'admin' },
    });

    return NextResponse.json({ data: { revalidated: true, path } });
  } catch (e) {
    console.error('[api/cms/revalidate POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
