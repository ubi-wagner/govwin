/**
 * The architecture map's LIVE layer — which tables the system actually touches.
 *
 * ── WHY THIS SITS ON THE MAP ─────────────────────────────────────────────────────────────────
 * The explorer has had three layers: the mechanical schema (139 tables, 309 FKs, extracted), the
 * curated meaning (subsystems, traces, UI map), and the deep links between them. All three describe
 * what the system IS. None of them says whether any of it is doing anything.
 *
 * That is the gap the whole producer/consumer sweep was about: a table can be migrated, indexed,
 * RLS-forced, wired into a UI and covered by a test, and still have nothing on either end of it. On
 * a static map that table looks exactly like a load-bearing one. Here it does not.
 *
 * ── THE FOUR CLASSES, AND WHY THEY ARE SOUND ─────────────────────────────────────────────────
 * Every number comes from `pg_stat_user_tables`, the database's own statistics collector — not a
 * source scan, not an inference about what code *might* run.
 *
 *   writes = n_tup_ins + n_tup_upd + n_tup_del      reads = seq_scan + idx_scan
 *
 *   live            writes > 0, reads > 0   both ends connected
 *   read_only       writes = 0, reads > 0   read but not written in this epoch — reference data,
 *                                           or the writer is gone
 *   written_unread  writes > 0, reads = 0   ROWS GO IN AND NOTHING EVER SELECTS THEM. This is the
 *                                           producer-with-no-consumer shape, stated by the database
 *   untouched       writes = 0, reads = 0   nothing on either end since the epoch
 *
 * ⚠️ `n_live_tup` is NOT used, and that is deliberate: it reads 0 until autovacuum analyses, so on
 * a freshly restored database it calls populated tables empty. The first version of this classified
 * `library_atoms` as inert while it was carrying 29,000 index scans. Row COUNTS come from
 * `pg_class.reltuples` via the sibling `stats` endpoint; ACTIVITY comes from the counters here. Two
 * different questions, two different sources.
 *
 * ── THE EPOCH IS THE WHOLE INSTRUMENT ────────────────────────────────────────────────────────
 * These counters are cumulative since an epoch, and the epoch is `pg_stat_database.stats_reset` —
 * **which is frequently NULL**, meaning nothing has ever reset them and Postgres is not telling us
 * how far back they go. Statistics also do not survive a crash, and are not carried by pg_dump.
 *
 * So "untouched" means *untouched since an unknown moment*, which is not the same claim as "nothing
 * writes this" — and stating the strong claim from the weak evidence is exactly the failure mode
 * this codebase keeps re-learning. When the epoch is unknown, `anchored` is false and the caller
 * MUST present the reading as coverage ("not touched in this reading") rather than as a finding
 * ("nothing writes this"). An instrument that cannot see reports silence, not a finding.
 *
 * Anchor it deliberately and the same numbers become a coverage map for a live drive:
 *
 *     psql "$DATABASE_URL_OWNER" -c 'SELECT pg_stat_reset()'   # mark the start
 *     …drive lanes A–G…                                        # exercise the product
 *     open /admin/architecture → Live                          # what the drive never touched
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────────────────────
 * rfp_admin+, cross-tenant by design — it is a picture of the platform, and it contains no row
 * data at all, only counters — so the read goes through `sqlBypass` (docs/RLS_CUTOVER.md).
 */
import { sqlBypass } from '@/lib/db';

export type ActivityClass = 'live' | 'read_only' | 'written_unread' | 'untouched';

export interface TableActivity {
  writes: number;
  reads: number;
  ins: number;
  upd: number;
  del: number;
  klass: ActivityClass;
}

export interface ArchitectureLive {
  /** When the counters started, or null when Postgres does not know. */
  statsSince: string | null;
  /** Postmaster start — a floor on how long the CURRENT accumulation could have run. */
  serverStart: string | null;
  /**
   * True only when `statsSince` is known. False means the counters are real but their span is
   * not, so every "never" below is really "not in this reading".
   */
  anchored: boolean;
  tables: Record<string, TableActivity>;
  counts: Record<ActivityClass, number>;
  /** Tables with writes and no reads — the one class that is a defect shape in every case. */
  writtenUnread: string[];
  /** Tables with nothing on either end. A finding when anchored; coverage when not. */
  untouched: string[];
  /** Busiest by write volume, for visual weight on the map. */
  hottest: Array<{ table: string; writes: number }>;
}

/**
 * The classification, separated from the query so it can be tested against known inputs.
 *
 * Pure, total, and it never guesses: a row with every counter at zero is `untouched`, which is a
 * statement about the counters and not about the code.
 */
export function classifyActivity(
  rows: Array<{ table: string; ins: number; upd: number; del: number; reads: number }>,
): Pick<ArchitectureLive, 'tables' | 'counts' | 'writtenUnread' | 'untouched' | 'hottest'> {
  const tables: Record<string, TableActivity> = {};
  const counts: Record<ActivityClass, number> = { live: 0, read_only: 0, written_unread: 0, untouched: 0 };
  const writtenUnread: string[] = [];
  const untouched: string[] = [];

  for (const r of rows) {
    const writes = r.ins + r.upd + r.del;
    const reads = r.reads;
    const klass: ActivityClass =
      writes > 0 && reads > 0 ? 'live'
        : writes > 0 ? 'written_unread'
          : reads > 0 ? 'read_only'
            : 'untouched';
    tables[r.table] = { writes, reads, ins: r.ins, upd: r.upd, del: r.del, klass };
    counts[klass] += 1;
    if (klass === 'written_unread') writtenUnread.push(r.table);
    if (klass === 'untouched') untouched.push(r.table);
  }

  const hottest = Object.entries(tables)
    .filter(([, a]) => a.writes > 0)
    .sort((a, b) => b[1].writes - a[1].writes)
    .slice(0, 12)
    .map(([table, a]) => ({ table, writes: a.writes }));

  writtenUnread.sort();
  untouched.sort();
  return { tables, counts, writtenUnread, untouched, hottest };
}

export async function architectureLive(): Promise<ArchitectureLive> {
  // Declared camelCase because `lib/db.ts` camelCases EVERY column at runtime — a snake_case row
  // type compiles (tsc trusts the assertion) and reads `undefined` on every field. That has shipped
  // twice. The SQL text keeps snake_case; the TypeScript matches what actually arrives.
  const [activity, epoch] = await Promise.all([
    sqlBypass<Array<{ relname: string; ins: string; upd: string; del: string; reads: string }>>`
      SELECT relname,
             n_tup_ins::bigint                                  AS ins,
             n_tup_upd::bigint                                  AS upd,
             n_tup_del::bigint                                  AS del,
             (COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0))::bigint AS reads
        FROM pg_stat_user_tables
       ORDER BY relname`,
    sqlBypass<Array<{ statsReset: Date | null; serverStart: Date }>>`
      SELECT s.stats_reset AS stats_reset, pg_postmaster_start_time() AS server_start
        FROM pg_stat_database s WHERE s.datname = current_database()`,
  ]);

  // int8 arrives as a STRING from postgres.js — Number() every counter or the arithmetic below
  // silently concatenates instead of adding.
  const derived = classifyActivity(activity.map((r) => ({
    table: r.relname,
    ins: Number(r.ins), upd: Number(r.upd), del: Number(r.del), reads: Number(r.reads),
  })));

  const statsReset = epoch[0]?.statsReset ?? null;
  return {
    statsSince: statsReset ? new Date(statsReset).toISOString() : null,
    serverStart: epoch[0]?.serverStart ? new Date(epoch[0].serverStart).toISOString() : null,
    anchored: statsReset != null,
    ...derived,
  };
}
