/**
 * POST /api/admin/space-presence/sweep
 *
 * Close abandoned "somebody from outside is in your workspace" brackets — the case no exit control
 * can catch, because nobody was there to press it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * An rfp_admin shadowing a customer, or a partner-manager descended into a client company, opens a
 * bracket in `space_presence` (mig 246). Four things close it: pressing exit, turning up on the
 * platform console, turning up inside a different company — and this, for the tab that was simply
 * shut. Without it the other three are worthless in exactly the situation that matters most, and
 * the customer's audit trail keeps asserting somebody is in their workspace indefinitely.
 *
 * ── WHY A ROUTE AND NOT A PYTHON JOB ─────────────────────────────────────────────────────────
 * The bracket logic lives in `lib/space-presence.ts` — it emits the paired exit event, honours the
 * per-tenant RLS context on each close, and CASes so a race produces one event. Re-implementing
 * that in the scheduler would be a second writer of the same invariant, which is the shape of
 * defect this whole change is removing. The scheduler calls this instead, exactly as the hourly
 * loop already calls `/api/admin/reconcile-cards`.
 *
 * Auth: an rfp_admin/master_admin session, OR `Authorization: Bearer <CRON_SECRET>` for the
 * headless caller — the same two doors reconcile-cards uses.
 *
 * Body (optional): { idleMinutes?: number } — default 45.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { sweepStalePresence } from '@/lib/space-presence';

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

    // Body is optional — a bare POST from cron must work, so a missing/!JSON body is not an error.
    let idleMinutes = 45;
    try {
      const body = (await request.json()) as { idleMinutes?: unknown };
      if (typeof body?.idleMinutes === 'number' && Number.isFinite(body.idleMinutes)) {
        // Bounded on BOTH sides. Below a few minutes this would evict people who are simply
        // reading, and each eviction writes a departure into a customer's audit trail that did not
        // happen; unbounded above, a typo silently disables the sweep and restores the original bug.
        idleMinutes = Math.min(Math.max(Math.trunc(body.idleMinutes), 5), 1440);
      }
    } catch { /* no body — use the default */ }

    const closed = await sweepStalePresence(idleMinutes);
    return NextResponse.json({ data: { closed, idleMinutes } });
  } catch (err) {
    console.error('[admin/space-presence/sweep] error', err);
    return NextResponse.json({ error: 'Sweep failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
