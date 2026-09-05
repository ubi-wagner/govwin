/**
 * POST /api/presence/heartbeat — "the tab is still open".
 *
 * Refreshes `last_seen_at` on every bracket this actor holds open. It CANNOT open one and cannot
 * reopen a closed one: the update only ever matches `closed_at IS NULL`, so a ping from a stale tab
 * is inert rather than a way back into a customer's workspace.
 *
 * ── WHY A CLIENT PING AT ALL ─────────────────────────────────────────────────────────────────
 * `last_seen_at` was advanced only by a portal LAYOUT render, and in the App Router a shared layout
 * is not re-executed on a soft navigation between sibling pages. So an actor could work inside a
 * customer's workspace for the whole idle window without the layout running once, and the sweep
 * would close their bracket as `timeout` while they were still sitting in it — a false departure in
 * that customer's audit trail, followed by a fresh arrival on their next hard load.
 *
 * "The tab is still open" is not knowable on the server. This is not the client-owned emission that
 * was removed from the shadow banner — that was a state TRANSITION, and the server still owns every
 * one of those. The client reports only liveness.
 *
 * Deliberately NOT tenant-scoped in the path: an actor is in one place at a time, the bracket rows
 * already know which tenants they belong to, and a tenant in the URL would be a claim the client
 * could get wrong. Nothing here trusts the request body — there is no body.
 *
 * Answers 200 with how many brackets were touched (`0` is the normal case for everyone who is not
 * an outside actor, and for a ping that arrived inside the throttle window).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { touchPresence } from '@/lib/space-presence';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string };
    if (!u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const touched = await touchPresence({ id: u.id, email: u.email ?? null });
    return NextResponse.json({ data: { touched } });
  } catch (err) {
    console.error('[presence/heartbeat] error', err);
    return NextResponse.json({ error: 'Heartbeat failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
