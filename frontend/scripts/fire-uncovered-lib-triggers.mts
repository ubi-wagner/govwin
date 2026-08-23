/**
 * The lib half of the UNCOVERED sweep — domain emitters that are functions, not routes.
 *
 * Companion to `fire-uncovered-triggers.mjs`, which drives the route-backed emitters through a real
 * signed-in session. Several triggers have no route in front of them: their emitter IS a domain lib
 * (`stageIntake`, `provisionProposalForPortal`, …). Those get called directly, exactly as
 * `verify-studio-voice.mts` calls `requestReviewPhase`.
 *
 * WHY A DIRECT LIB CALL IS EVIDENCE AND `POST /api/admin/workflows` IS NOT. The distinction is what
 * chooses the PAYLOAD KEYS. The workflow launcher takes an operator overlay and emits it verbatim as
 * the payload, so checking it against an `input_map` compares my typing to itself — a tautology.
 * Calling `stageIntake({title, agency, …})` supplies DOMAIN arguments; the lib then decides which
 * keys the event carries. Those keys are the thing under test, and they come from the product.
 *
 * WHAT IT LEAVES BEHIND. Real rows, because it performs real operations — a staged intake really
 * creates an opportunity + a curated solicitation. Every one is tagged so it can be found and is
 * torn down at the end. The emitted `system_events` rows are kept deliberately: they are the
 * evidence the lens reads.
 *
 * Run:  DATABASE_URL=… node --import tsx scripts/fire-uncovered-lib-triggers.mts
 * Then: PYTHONPATH=src DATABASE_URL=… python3 pipeline/scripts/check_ai_invoke_contract.py
 */
import postgres from 'postgres';
import { stageIntake } from '@/lib/intake';

const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }
const sql = postgres(DB, { max: 2 });

const TAG = 'contract-lens coverage probe';
let failures = 0;

async function countSince(namespace: string, type: string, since: Date): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM system_events
    WHERE namespace = ${namespace} AND type = ${type} AND created_at >= ${since}
  `;
  return r.n;
}

async function main() {
  const [admin] = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE role IN ('master_admin','rfp_admin') AND is_active ORDER BY created_at LIMIT 1
  `;
  if (!admin) { console.error('no admin user to act as'); process.exit(2); }

  // ── finder:opportunities.detected — the woken opportunity_scout's trigger ──────────────────
  //
  // stageIntake is the single funnel: admin intake AND the #176 scout release both go through it,
  // so this is the real production path, not a side door.
  const t0 = new Date();
  const staged = await stageIntake(
    {
      title: `${TAG} — synthetic notice`,
      agency: 'Department of Verification',
      solicitationNumber: 'LENS-COVERAGE-001',
      description: 'Fired to bring OnOpportunitiesDetected under the AI_INVOKE input-contract lens.',
      intakeMeta: { foundBy: 'admin', noticeType: 'coverage-probe' },
    },
    admin.id,
  );

  if ('error' in staged) {
    console.error(`  FAIL  stageIntake refused: ${staged.error}`);
    failures++;
  } else {
    const n = await countSince('finder', 'opportunities.detected', t0);
    if (n > 0) {
      console.log(`  ok    finder:opportunities.detected — ${n} event(s), opp ${staged.opportunityId}`);
    } else {
      // Not a pass and not a product verdict on its own: report it and let the lens say what it sees.
      console.error('  FAIL  stageIntake succeeded but emitted no finder:opportunities.detected');
      failures++;
    }

    // Tear down the rows this created. The EVENTS stay — they are the evidence.
    try {
      await sql`DELETE FROM curated_solicitations WHERE id = ${staged.solicitationId}`;
      await sql`DELETE FROM opportunities WHERE id = ${staged.opportunityId}`;
      console.log('  ..    removed the probe opportunity + solicitation (events kept as evidence)');
    } catch (e) {
      console.error(`  WARN  teardown failed, leaving rows behind: ${String(e).slice(0, 140)}`);
      failures++;
    }
  }
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => { await sql.end(); process.exit(failures === 0 ? 0 : 1); });
