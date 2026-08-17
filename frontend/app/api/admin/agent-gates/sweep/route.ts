/**
 * POST /api/admin/agent-gates/sweep
 *
 * TW-8 AI-manager auto-advance — the AUTONOMOUS invoker of the assisted gate-close. Scans active portals
 * for a current stage that is an `agent_manager` gate with `autoAdvance=true` and closes each whose
 * AI-manager cohort review has landed (no human click). Idempotent + safe: a portal whose review is still
 * pending is skipped, and advancePortalStage stays the sole stage-mutation path. Meant to be poked on a
 * schedule (the pipeline lifecycle scheduler) so an auto-advance stage clears itself the moment its review
 * completes; also runnable by an admin on demand.
 *
 * Auth: an rfp_admin/master_admin session, OR (for the headless scheduler) `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is configured. Returns { data: { scanned, eligible, advanced, results } }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { sweepAutoAdvanceGates } from '@/lib/portal-workflow';

export async function POST(request: Request) {
  try {
    // Headless-scheduler path: a bearer secret (only when configured) authorizes without a session.
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

    const result = await sweepAutoAdvanceGates();
    return NextResponse.json({ data: result });
  } catch (e) {
    console.error('[api/admin/agent-gates/sweep] POST error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'SWEEP_ERROR' }, { status: 500 });
  }
}
