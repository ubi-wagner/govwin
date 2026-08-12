import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant catalog read — owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Normalize types the same way scripts/architecture/extract.mjs does, so the live model
// matches the committed snapshot's shape.
const TYPE = `CASE
  WHEN data_type='USER-DEFINED' THEN udt_name
  WHEN data_type='character varying' THEN 'varchar'
  WHEN data_type='timestamp with time zone' THEN 'timestamptz'
  WHEN data_type='timestamp without time zone' THEN 'timestamp'
  WHEN data_type='double precision' THEN 'float8'
  ELSE data_type END`;

/**
 * GET /api/admin/architecture/schema
 *
 * The LIVE schema model for the Architecture Explorer — tables, columns (name/type/nullable),
 * primary keys, and FK edges — introspected from information_schema at request time (exactly what
 * scripts/architecture/extract.mjs does offline). The embedded explorer fetches this on load and
 * re-enriches it with the committed overlay (subsystems/traces), so the in-app schema view is
 * ALWAYS current with the running database — no regeneration, no cron. Opened as a file/artifact
 * the fetch 404s and the committed snapshot is used instead.
 *
 * Introspection-only; queries are static (no user input) so sql.unsafe is safe here.
 * rfp_admin+. Returns { data: { tables, fks } } | { error, code }.
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
    const cols = (await sql.unsafe(
      `SELECT table_name AS t, column_name AS c, ${TYPE} AS ty, (is_nullable='YES') AS nn
       FROM information_schema.columns WHERE table_schema='public'
       ORDER BY table_name, ordinal_position`,
    )) as unknown as { t: string; c: string; ty: string; nn: boolean }[];

    const pks = (await sql.unsafe(
      `SELECT tc.table_name AS t, kcu.column_name AS c
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
       WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'`,
    )) as unknown as { t: string; c: string }[];

    const fkRows = (await sql.unsafe(
      `SELECT DISTINCT tc.table_name AS "table", kcu.column_name AS col,
              ccu.table_name AS "refTable", ccu.column_name AS "refCol"
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
       WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`,
    )) as unknown as { table: string; col: string; refTable: string; refCol: string }[];

    const tables: Record<string, { columns: { name: string; type: string; nullable: boolean }[]; pk: string[] }> = {};
    for (const r of cols) {
      (tables[r.t] ??= { columns: [], pk: [] }).columns.push({ name: r.c, type: r.ty, nullable: r.nn });
    }
    for (const p of pks) tables[p.t]?.pk.push(p.c);
    const fks = fkRows.map((f) => ({ table: f.table, col: f.col, refTable: f.refTable, refCol: f.refCol }));

    return NextResponse.json({ data: { tables, fks } });
  } catch (e) {
    console.error('[admin/architecture/schema]', e);
    return NextResponse.json({ error: 'Failed to read schema', code: 'DB_ERROR' }, { status: 500 });
  }
}
