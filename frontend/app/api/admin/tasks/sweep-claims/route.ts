/**
 * POST /api/admin/tasks/sweep-claims — return abandoned ToDo claims to the queue.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * A claim (mig 249) records that somebody started a ToDo. This is the half that makes taking one
 * safe: without it, a person signed out mid-task leaves the queue asserting indefinitely that work
 * is under way, and nobody else picks it up. That is not hypothetical — the session bounds shipped
 * in P1/P2 GUARANTEE people are signed out mid-task, which is exactly the point of them. A claim
 * without an expiry would turn a security improvement into a stalled queue.
 *
 * Auth mirrors `space-presence/sweep`: an rfp_admin/master_admin session, OR
 * `Authorization: Bearer <CRON_SECRET>` for the headless caller. Same two doors, same reason — the
 * sweep logic lives in the domain layer (it emits a per-row event and honours the tenant context),
 * and re-implementing it in the scheduler would make a second writer of one invariant.
 *
 * Body (optional): { staleMinutes?: number } — default 90.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { sweepStaleClaims, CLAIM_STALE_MINUTES } from '@/lib/tasks/tasks';

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authz = request.headers.get('authorization') ?? '';
    const viaCron = !!cronSecret && authz === `Bearer ${cronSecret}`;

    if (!viaCron) {
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
      }
      const user = session.user as { role?: Role };
      if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
        return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
      }
    }

    // A bare POST from cron must work, so a missing or unparseable body is not an error.
    let staleMinutes = CLAIM_STALE_MINUTES;
    try {
      const body = (await request.json()) as { staleMinutes?: unknown };
      if (typeof body?.staleMinutes === 'number' && Number.isFinite(body.staleMinutes)) {
        // Bounded both ways, like the presence sweep. Too low and it snatches work back from
        // somebody still doing it; unbounded above, a typo silently disables the sweep and the
        // queue quietly fills with claims nobody holds.
        staleMinutes = Math.min(Math.max(Math.trunc(body.staleMinutes), 5), 1440);
      }
    } catch { /* no body — use the default */ }

    const released = await sweepStaleClaims(staleMinutes);
    return NextResponse.json({ data: { released, staleMinutes } });
  } catch (err) {
    console.error('[admin/tasks/sweep-claims] error', err);
    return NextResponse.json({ error: 'Sweep failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
