/** Seed Scout worker-pool activity (#103) so /admin/scouts populates. */
import { sql } from '@/lib/db';

const DSIP = '9eef3caa-1f08-4246-8c12-eb193e38cc9b';
const AFWERX = '2e556dd5-2819-43d1-b207-1988d634c0b1';
const mins = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

try {
  // ── Worker health per source type ──
  await sql`DELETE FROM source_health`;
  const health: Array<[string, string, number, number | null, number | null, number]> = [
    // source, status, consecutive_failures, lastSuccessMin, lastFailureMin, avgMs
    ['dsip', 'healthy', 0, 12, null, 41000],
    ['afwerx', 'healthy', 0, 4, null, 38000],
    ['xtech', 'healthy', 0, 55, null, 52000],
    ['sam_gov', 'degraded', 1, 190, 35, 74000],
    ['nsf', 'error', 3, 1440, 22, 61000],
  ];
  for (const [source, status, fails, okMin, failMin, avg] of health) {
    await sql`
      INSERT INTO source_health (source, status, consecutive_failures, last_success_at, last_failure_at, avg_duration_ms)
      VALUES (${source}, ${status}, ${fails}, ${mins(okMin)}::timestamptz,
              ${failMin != null ? mins(failMin) : null}::timestamptz, ${avg})`;
  }

  // ── Last-visited stamps on the two most-active profiles ──
  await sql`UPDATE source_profiles SET last_visited_at = ${mins(12)}::timestamptz WHERE id = ${DSIP}::uuid`;
  await sql`UPDATE source_profiles SET last_visited_at = ${mins(4)}::timestamptz WHERE id = ${AFWERX}::uuid`;

  // ── Recent scout visits ──
  await sql`DELETE FROM source_visits WHERE (metadata->>'demo') = 'true'`;
  const visits: Array<[string, number, number, number]> = [
    [DSIP, 12, 0, 3], [AFWERX, 4, 1, 1], [DSIP, 190, 0, 0],
  ];
  for (const [pid, ago, files, topics] of visits) {
    await sql`
      INSERT INTO source_visits (profile_id, action, files_count, topics_count, notes, metadata, created_at)
      VALUES (${pid}::uuid, 'visit', ${files}, ${topics}, 'Automated scout visit', ${sql.json({ demo: true })}, ${mins(ago)}::timestamptz)`;
  }

  // ── Meaningful changes detected ──
  await sql`DELETE FROM source_diffs WHERE (extracted_opportunities::text LIKE '%demo%')`;
  await sql`
    INSERT INTO source_diffs (profile_id, is_meaningful, summary, severity, extracted_opportunities, claude_model, created_at)
    VALUES (${DSIP}::uuid, true, '3 new SBIR topics detected in the DoD 25.4 release (Rydberg sensing, air-independent power, ML/LLM).',
            'high', ${sql.json([{ demo: true, code: 'DPA26BZ03-DV011' }])}, 'claude-sonnet-4', ${mins(12)}::timestamptz)`;
  await sql`
    INSERT INTO source_diffs (profile_id, is_meaningful, summary, severity, extracted_opportunities, claude_model, created_at)
    VALUES (${AFWERX}::uuid, true, 'New AFWERX open topic posted; submission window opens next week.',
            'low', ${sql.json([{ demo: true }])}, 'claude-sonnet-4', ${mins(4)}::timestamptz)`;

  // ── Recent scout runs (pipeline_jobs kind=scout_source) ──
  await sql`DELETE FROM pipeline_jobs WHERE kind = 'scout_source' AND (metadata->>'demo') = 'true'`;
  const runs: Array<[string, string, string | null, number | null, number | null]> = [
    // source, status, worker, startedMin, completedMin
    ['dsip', 'completed', 'scout-worker-1', 13, 12],
    ['xtech', 'completed', 'scout-worker-1', 56, 55],
    ['afwerx', 'running', 'scout-worker-2', 4, null],
    ['nsf', 'pending', null, null, null],
  ];
  for (const [source, status, worker, startMin, doneMin] of runs) {
    await sql`
      INSERT INTO pipeline_jobs (source, kind, run_type, status, worker_id, started_at, completed_at, metadata)
      VALUES (${source}, 'scout_source', 'full', ${status}, ${worker},
              ${startMin != null ? mins(startMin) : null}::timestamptz,
              ${doneMin != null ? mins(doneMin) : null}::timestamptz, ${sql.json({ demo: true })})`;
  }

  const [{ h }] = await sql<{ h: number }[]>`SELECT count(*)::int h FROM source_health`;
  const [{ r }] = await sql<{ r: number }[]>`SELECT count(*)::int r FROM pipeline_jobs WHERE kind='scout_source'`;
  const [{ d }] = await sql<{ d: number }[]>`SELECT count(*)::int d FROM source_diffs`;
  console.log(`seeded: ${h} health rows · ${r} scout runs · ${d} diffs`);
} finally {
  await sql.end();
}
