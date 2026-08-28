/**
 * Close the event brackets a crashed process left open.
 *
 * POST — sweeps `system_events` for `phase='start'` rows older than `olderThanMinutes` with no
 * matching `end`, and writes a terminal `end` marked ABANDONED for each.
 *
 * Auth: an rfp_admin/master_admin session, OR (for the headless scheduler)
 * `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is configured — the same shape as
 * `/api/admin/agent-gates/sweep`, because a second auth idiom for a second sweep is how one of
 * them ends up wrong.
 *
 * ── WHY THIS ENDPOINT EXISTS ─────────────────────────────────────────────────────────────────
 * `withEventBracket` guarantees an `end` on every code path. It cannot guarantee one when the
 * PROCESS dies — a SIGKILL, an OOM, a reclaimed container. The start row is already committed and
 * nothing is left running to close it.
 *
 * That is not cosmetic. The workflow engine's `EventTrigger` relies on a failed operation still
 * emitting a terminal `end` carrying `error`; a start with no end gives it no terminal event at
 * all, so anything waiting on that operation waits forever with no signal that it never will
 * arrive. Measured on this sandbox: 1,384 starts, 1,377 ends, and the seven missing were
 * `proposal:proposal.created` timestamped to the minutes a server was killed mid-request.
 *
 * ⚠️ `olderThanMinutes` MUST exceed the longest legitimate operation. Below that it closes
 * brackets that are still running, which turns an instrument into a source of false terminal
 * events. The default (60) is the workflow engine's own instance deadline.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { type Role } from '@/lib/rbac';
import { closeAbandonedBrackets } from '@/lib/events';

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

    let olderThanMinutes = 60;
    try {
      const body = await request.json().catch(() => ({}));
      const v = Number((body as { olderThanMinutes?: unknown })?.olderThanMinutes);
      // A floor of 15, deliberately. A caller passing 0 or 1 would close every bracket currently
      // in flight and record a terminal ABANDONED for operations that are running normally —
      // corrupting the audit trail with the very uncertainty this sweep exists to resolve.
      if (Number.isFinite(v) && v >= 15) olderThanMinutes = Math.floor(v);
    } catch { /* no body is fine — the default stands */ }

    const result = await closeAbandonedBrackets({ olderThanMinutes });
    return NextResponse.json({ data: { ...result, olderThanMinutes } });
  } catch (e) {
    console.error('[api/admin/event-brackets/sweep] POST error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'SWEEP_ERROR' }, { status: 500 });
  }
}
