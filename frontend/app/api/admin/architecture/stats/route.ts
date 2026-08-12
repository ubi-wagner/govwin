import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant read of catalog stats — owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/architecture/stats
 *
 * Per-table row counts for the Architecture Explorer's live overlay. Uses pg_class.reltuples
 * — the planner's row ESTIMATE, updated by ANALYZE/autovacuum — so it's instant and never scans
 * (a real count(*) across 108 tables would hammer the DB). Estimates are ideal for an
 * architecture overview; the explorer labels them "~est".
 *
 * rfp_admin+ (middleware already gates /api/admin; this is the belt-and-suspenders page gate).
 * Returns { data: { counts: { table: rows }, total, estimated: true } } | { error, code }.
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
    const rows = await sql<{ table: string; rows: string }[]>`
      SELECT c.relname AS "table", GREATEST(c.reltuples, 0)::bigint AS rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const n = Number(r.rows);
      counts[r.table] = n;
      total += n;
    }
    return NextResponse.json({ data: { counts, total, estimated: true } });
  } catch (e) {
    console.error('[admin/architecture/stats]', e);
    return NextResponse.json({ error: 'Failed to read table stats', code: 'DB_ERROR' }, { status: 500 });
  }
}
