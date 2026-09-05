import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { architectureLive } from '@/lib/architecture-live';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/architecture/live
 *
 * The architecture map's fourth layer: which tables the system is actually touching, from
 * `pg_stat_user_tables`. The static map says what exists; this says what is doing anything.
 *
 * Sibling of `…/architecture/stats`, and deliberately separate from it — that one answers "how many
 * rows are in here" (pg_class.reltuples, a planner estimate), this one answers "does anything write
 * it and does anything read it" (the statistics collector's counters). Two different questions with
 * two different right sources; conflating them is what made the first version call a table with
 * 29,000 index scans dead. See lib/architecture-live.ts.
 *
 * ⚠️ The response carries `anchored`. When it is FALSE the counters are real but their span is
 * unknown, and the consumer must render "not touched in this reading" rather than "nothing writes
 * this". The endpoint does not soften the numbers — it hands over the epoch and expects the caller
 * to be honest with it.
 *
 * rfp_admin+ (middleware gates /api/admin; this is the belt-and-suspenders route gate).
 * Returns { data: ArchitectureLive } | { error, code }.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') {
    return NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    return NextResponse.json({ data: await architectureLive() });
  } catch (e) {
    console.error('[admin/architecture/live]', e);
    return NextResponse.json({ error: 'Failed to read table activity', code: 'DB_ERROR' }, { status: 500 });
  }
}
