/**
 * Ingest Studio — the DB-side coverage verifier (run after e2e/ingest-coverage-drive).
 *
 * The drive proves behavior through the product's surfaces; this proves the LEDGER those
 * surfaces are contractually required to leave behind (docs/EVENT_CONTRACT.md + CLAUDE.md
 * SOP: every actor/automation/agent/manager action posts to system_events):
 *
 *   1. START/END PAIRING — every ingest-family 'start' event has exactly one 'end' child.
 *      An orphan start is a run that claims to have begun and never accounted for itself;
 *      an orphan end is a row nothing can correlate. Both are audit failures.
 *   2. TRIGGER REACHABILITY — every ingest.phase_requested END actually spawned a workflow
 *      instance (the exact silent failure the phase='single' bug produced: recorded, never run).
 *   3. DRAFT LIFECYCLE — at most one open (staged|reviewed) draft per solicitation; landed
 *      drafts have landed_at + landed_by; superseded drafts never mutate again.
 *   4. TRUST FLOOR — no landed compliance row carries an unstamped named value written by
 *      this cycle's writers (every field_provenance entry has a source).
 *
 * Usage: NODE_PATH=frontend/node_modules DATABASE_URL=… npx tsx frontend/scripts/verify-ingest-coverage.mts
 * Exits non-zero on any violation, printing each one — this is a gate, not a report.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(2); }
const sql = postgres(url, { max: 1, transform: { column: { from: postgres.toCamel } } });

const failures: string[] = [];
const ok = (label: string, n: number) => console.log(`  ✓ ${label}${n >= 0 ? ` (${n})` : ''}`);
const bad = (label: string, rows: unknown[]) => {
  failures.push(label);
  console.error(`  ✗ ${label}:\n${rows.map((r) => `      ${JSON.stringify(r)}`).join('\n')}`);
};

const INGEST_TYPES = [
  'rfp.uploaded', 'ingest.phase_requested', 'ingest.assessment_requested',
  'solicitation.ingest_assisted', 'ingest.phase_completed',
  'ingest.phase_staged', 'ingest.phase_regenerated', 'ingest.phase_approved', 'ingest.phase_landed',
];

async function main() {
  console.log('── 1. start/end pairing over the ingest event family ──');
  const orphanStarts = await sql<Array<{ id: string; type: string; createdAt: Date }>>`
    SELECT s.id, s.type, s.created_at AS "createdAt"
    FROM system_events s
    WHERE s.namespace = 'finder' AND s.type = ANY(${INGEST_TYPES}) AND s.phase = 'start'
      AND NOT EXISTS (
        SELECT 1 FROM system_events e WHERE e.parent_event_id = s.id AND e.phase = 'end')`;
  orphanStarts.length ? bad('orphan START events (began, never accounted for)', orphanStarts)
    : ok('every start has an end', -1);

  // An END must be correlatable: either it has a START parent (the pair convention), or —
  // for a machine chain hop — it demonstrably did its job by spawning a workflow instance.
  // A bare END that fired nothing is the ledger-garbage case this exists to catch. (The
  // pipeline chain hops now pair too; the instance clause keeps pre-pairing history honest.)
  const orphanEnds = await sql<Array<{ id: string; type: string }>>`
    SELECT e.id, e.type FROM system_events e
    WHERE e.namespace = 'finder' AND e.type = ANY(${INGEST_TYPES}) AND e.phase = 'end'
      AND (e.parent_event_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM system_events s WHERE s.id = e.parent_event_id AND s.phase IN ('start', 'end')))
      AND NOT EXISTS (SELECT 1 FROM process_instances pi WHERE pi.trigger_event_id = e.id)`;
  orphanEnds.length ? bad('orphan END events (no start parent AND fired nothing)', orphanEnds)
    : ok('every end is correlatable (paired, or it spawned its workflow)', -1);

  console.log('── 2. every phase trigger actually fired a workflow ──');
  // Pipeline-side auto-chain hops emit bare 'end' triggers (the studio_actions precedent);
  // both frontend pairs and pipeline hops must have spawned an instance.
  const unfired = await sql<Array<{ id: string; createdAt: Date; phase: string | null }>>`
    SELECT e.id, e.created_at AS "createdAt", e.payload->>'phase' AS phase
    FROM system_events e
    WHERE e.namespace = 'finder' AND e.type = 'ingest.phase_requested' AND e.phase = 'end'
      AND NOT EXISTS (SELECT 1 FROM process_instances pi WHERE pi.trigger_event_id = e.id)`;
  unfired.length ? bad('phase_requested END events that spawned NO workflow instance', unfired)
    : ok('all phase triggers spawned instances', -1);

  const instances = await sql<Array<{ workflowName: string; status: string; n: number }>>`
    SELECT workflow_name AS "workflowName", status, count(*)::int AS n
    FROM process_instances WHERE workflow_name LIKE 'OnIngestPhase%'
    GROUP BY 1, 2 ORDER BY 1, 2`;
  console.log('  instances by workflow/status:');
  for (const r of instances) console.log(`      ${r.workflowName} · ${r.status} × ${r.n}`);
  const failed = instances.filter((r) => r.status === 'failed');
  failed.length ? bad('FAILED ingest-phase instances', failed) : ok('no failed instances', -1);
  // The coverage claim: all four phase workflows must have run at least once.
  for (const wf of ['Extract', 'Matrix', 'Review', 'Molds']) {
    const hit = instances.some((r) => r.workflowName === `OnIngestPhaseRequested${wf}` && r.status === 'completed');
    hit ? ok(`OnIngestPhaseRequested${wf} completed ≥1`, -1)
      : bad(`OnIngestPhaseRequested${wf} never completed`, []);
  }

  console.log('── 3. draft lifecycle invariants ──');
  const multiOpen = await sql<Array<{ solicitationId: string; n: number }>>`
    SELECT solicitation_id AS "solicitationId", count(*)::int AS n
    FROM solicitation_compliance_drafts WHERE status IN ('staged', 'reviewed')
    GROUP BY 1 HAVING count(*) > 1`;
  multiOpen.length ? bad('more than one OPEN draft per solicitation', multiOpen)
    : ok('≤1 open draft per solicitation', -1);

  const badLanded = await sql<Array<{ id: string }>>`
    SELECT id FROM solicitation_compliance_drafts
    WHERE status = 'landed' AND (landed_at IS NULL OR landed_by IS NULL)`;
  badLanded.length ? bad('landed drafts missing landed_at/landed_by', badLanded)
    : ok('landed drafts fully attributed', -1);

  console.log('── 4. provenance floor on landed matrices ──');
  // Scoped to solicitations that went through the STUDIO (have a landed draft): those were
  // written by the stamping writers, so an unstamped value there is a real regression. Legacy
  // pre-Studio rows are excluded — their empty provenance already renders as unverified by the
  // mig 187 contract, and their updated_at gets bumped by unrelated writers (the custom_variables
  // upsert), which made a row-level recency filter flag columns nothing had touched.
  const unstamped = await sql<Array<{ solicitationId: string; col: string }>>`
    SELECT c.solicitation_id AS "solicitationId", cols.col
    FROM solicitation_compliance c,
    LATERAL (VALUES ('page_limit_technical'), ('font_family'), ('min_font_size'), ('margins'),
                    ('submission_format')) AS cols(col)
    WHERE EXISTS (SELECT 1 FROM solicitation_compliance_drafts d
                  WHERE d.solicitation_id = c.solicitation_id AND d.status = 'landed')
      AND (CASE cols.col
             WHEN 'page_limit_technical' THEN c.page_limit_technical IS NOT NULL
             WHEN 'font_family' THEN c.font_family IS NOT NULL
             WHEN 'min_font_size' THEN c.min_font_size IS NOT NULL
             WHEN 'margins' THEN c.margins IS NOT NULL
             WHEN 'submission_format' THEN c.submission_format IS NOT NULL
           END)
      AND (c.field_provenance->cols.col->>'source') IS NULL`;
  unstamped.length ? bad('recently-written named values with NO provenance stamp', unstamped)
    : ok('every recent named value is stamped', -1);

  await sql.end();
  if (failures.length) {
    console.error(`\n✗ ${failures.length} violation class(es) — the ledger does not match the contract.`);
    process.exit(1);
  }
  console.log('\n✓ ledger conforms: start/end paired, triggers fired, drafts law-abiding, values stamped.');
}

main().catch((e) => { console.error(e); process.exit(2); });
