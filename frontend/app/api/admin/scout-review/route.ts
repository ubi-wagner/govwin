/**
 * GET /api/admin/scout-review — the "potential NEW or UPDATED OPP" candidate queue (#176).
 *
 * Lists scout findings (crawler leads + the HITL source-scout's extracted opportunities) with
 * their deterministic NEW-vs-UPDATE classification, for an rfp_admin to release or dismiss.
 * Query: ?includeResolved=1 to also show pursued/dismissed rows. rfp_admin | master_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { listCandidates } from '@/lib/scout/candidates';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: Role }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const includeResolved = new URL(request.url).searchParams.get('includeResolved') === '1';
    let candidates;
    try {
      candidates = await listCandidates({ includeResolved });
    } catch (e) {
      console.error('[admin/scout-review] list failed', e);
      return NextResponse.json({ error: 'Failed to load candidates', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { candidates } });
  } catch (err) {
    console.error('[admin/scout-review] GET error', err);
    return NextResponse.json({ error: 'Failed to load candidates', code: 'DB_ERROR' }, { status: 500 });
  }
}
