/** Live proof (AGENTS-LIVE-3): waking opportunity_scout via the new stageIntake producer.
 *  Calls the REAL stageIntake (emits finder:opportunities.detected) → the Python worker runs
 *  OnOpportunitiesDetected → opportunity_scout AI_INVOKE on the emulator + a triage ToDo.
 *  cd frontend && DATABASE_URL=… node --import tsx scripts/drive-opp-scout.mts */
import postgres from 'postgres';
import { readFileSync, statSync } from 'fs';
import { stageIntake } from '@/lib/intake';

// The emulator's transcript, IF this box writes one. Overridable, because the path moves with the
// rig and a hardcoded one silently stops existing — see `emuLines`.
const EMU_LOG = process.env.EMULATOR_LOG || '/tmp/govwin-sandbox/emulated-claude.log.jsonl';
const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 4 });
/**
 * Resolved, not pinned — the same fixture rot that killed drive-provisioning-cockpit.
 *
 * This was a literal UUID. The box was rehydrated, the admin was recreated under a new id, and
 * every run since died inside `stageIntake` on
 *     insert or update on "opportunities" violates "opportunities_built_by_fkey"
 *     Key (built_by)=(3667ead2…) is not present in table "users"
 * which looks like the intake producer is broken. It is not: the drive was asserting an id that
 * nothing needs. What it actually needs is SOME active rfp_admin to attribute the intake to.
 */
const [adminRow] = await sql<Array<{ id: string; email: string }>>`
  SELECT id, email FROM users
  WHERE role IN ('rfp_admin', 'master_admin') AND is_active
  ORDER BY (email = 'eric@rfppipeline.com') DESC, created_at
  LIMIT 1`;
if (!adminRow) {
  console.error('CANT-RUN no active rfp_admin exists to stage an intake as — a missing fixture, '
    + 'not a failure of the producer under test.');
  process.exit(1);
}
const ADMIN = adminRow.id;
console.log(`cast: admin=${adminRow.email}`);
let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
/**
 * Lines in the emulator transcript, or NULL when there is no transcript to read.
 *
 * The `catch { return 0 }` this replaces is a small lie with a large consequence: the log path is
 * fixed at `/tmp/govwin-sandbox/…`, this rig writes its emulator log somewhere else, so every read
 * threw ENOENT and every read answered "zero". The drive then reported
 * "emulator served the opportunity_scout tool-loop — +0 calls" as a FAILURE, on a run whose own
 * evidence, printed four lines below it, said `rounds: 2, tool_calls: 2, tokensUsed: 365`.
 *
 * A missing instrument is not a zero reading. Null says so, and the caller reports NOT MEASURED.
 */
const emuLines = (): number | null => {
  try { return readFileSync(EMU_LOG, 'utf8').split('\n').filter(Boolean).length; }
  catch { return null; }
};
/**
 * Is anything actually WRITING that transcript during this run?
 *
 * Absent was not the only way this instrument lied. On this box the file EXISTS — and was last
 * written eleven days ago, by a rig that is gone. So the reads succeeded, both answered the same
 * number, and "+0 calls" was a true statement about a dead file offered as a verdict about a live
 * agent. A stale log and a silent emulator are indistinguishable by line count alone; the mtime
 * tells them apart.
 */
const emuLive = (since: number): boolean => {
  try { return statSync(EMU_LOG).mtimeMs >= since; } catch { return false; }
};
const emuAge = (): string => {
  try { return `${Math.round((Date.now() - statSync(EMU_LOG).mtimeMs) / 86_400_000)}d old`; }
  catch { return 'absent'; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  console.log('\n── AGENTS-LIVE-3 · opportunity_scout woken via stageIntake ──\n');

  // Baselines
  const startedAt = Date.now();
  const emu0 = emuLines();
  const [{ n: scout0 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE type='agent.invoked' AND payload::text LIKE '%opportunity_scout%'`;
  const [{ n: det0 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE namespace='finder' AND type='opportunities.detected'`;
  const [{ n: triage0 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE task_type='triage_new_opportunities'`;

  // Fire the producer: stage a distinctive new intake notice.
  //
  // DISTINCT PER RUN. `opportunities` has a unique key on content_hash, and this notice was
  // byte-identical every time — so the first run staged it and every run after died on a duplicate
  // key, reporting "stageIntake succeeded — Failed to stage intake" as though the intake path were
  // broken. The drive worked exactly once, then indicted the product for its own leftovers.
  const RUN = crypto.randomUUID().slice(0, 8);
  const staged = await stageIntake({
    title: `AGENTS-LIVE probe ${RUN} — Directed Energy Counter-UAS (live opportunity_scout drive)`,
    agency: 'Department of the Air Force',
    programType: 'sbir_phase_1',
    description: `Probe notice ${RUN} to wake the detection→triage chain end-to-end.`,
    intakeMeta: { foundBy: 'admin' },
  }, ADMIN);
  A('stageIntake succeeded', !('error' in staged), 'error' in staged ? staged.error : `opp=${staged.opportunityId}`);

  // Confirm the producer emitted the detection event.
  await sleep(500);
  const [{ n: det1 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE namespace='finder' AND type='opportunities.detected'`;
  A('stageIntake emitted finder:opportunities.detected', det1 > det0, `${det0} → ${det1}`);

  // Poll for the worker to run opportunity_scout + create the triage ToDo (worker polls ~10s).
  let scout1 = scout0, triage1 = triage0, emu1: number | null = emu0;
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    [{ n: scout1 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE type='agent.invoked' AND payload::text LIKE '%opportunity_scout%'`;
    [{ n: triage1 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE task_type='triage_new_opportunities'`;
    emu1 = emuLines();
    if (scout1 > scout0 && triage1 > triage0) break;
    const emuDelta = emu0 !== null && emu1 !== null ? `${emu1 - emu0}` : 'n/a';
    console.log(`  …poll ${i + 1}: agent.invoked(scout)=${scout1} triage=${triage1} emuCalls=${emuDelta}`);
  }

  A('worker ran opportunity_scout on the emulator (agent.invoked)', scout1 > scout0, `${scout0} → ${scout1}`);
  // The tool-loop, measured from the PRODUCT'S OWN RECORD rather than a sandbox file. The
  // `agent.invoked` payload carries rounds / tool_calls / tokensUsed — the same numbers this drive
  // already prints as evidence — so this asks the system what it did instead of asking the rig
  // whether it happened to be writing a transcript.
  const [lastInvocation] = await sql<Array<{ payload: Record<string, unknown> }>>`
    SELECT payload FROM system_events
    WHERE type = 'agent.invoked' AND payload::text LIKE '%opportunity_scout%'
    ORDER BY created_at DESC LIMIT 1`;
  const toolCalls = Number(lastInvocation?.payload?.tool_calls ?? 0);
  const tokens = Number(lastInvocation?.payload?.tokensUsed ?? 0);
  A('the scout actually ran a tool-loop (rounds + tool calls recorded)',
    toolCalls > 0 && tokens > 0, `tool_calls=${toolCalls} tokens=${tokens}`);

  // The emulator transcript is a SUPPLEMENTARY signal — the authoritative measurement is the
  // invocation record above. It is asserted ONLY when something is demonstrably writing it during
  // this run; otherwise there is nothing to read from, which is uncovered rather than zero.
  if (emu0 === null || emu1 === null || !emuLive(startedAt)) {
    console.log(`· emulator transcript NOT MEASURED — ${EMU_LOG} is ${emuAge()} and was not written `
      + 'during this run (set EMULATOR_LOG to this rig\'s log). Uncovered, not a finding.');
  } else {
    A('emulator served the opportunity_scout tool-loop (LLM calls)', emu1 > emu0, `+${emu1 - emu0} calls`);
  }
  A('a triage_new_opportunities ToDo was parked for the admin', triage1 > triage0, `${triage0} → ${triage1}`);

  // Show the newest scout invocation summary + the triage ToDo.
  const inv = await sql<{ createdAt: Date; payload: unknown }[]>`
    SELECT created_at, payload FROM system_events WHERE type='agent.invoked' AND payload::text LIKE '%opportunity_scout%' ORDER BY created_at DESC LIMIT 1`;
  if (inv[0]) console.log('  latest opportunity_scout invocation:', JSON.stringify(inv[0].payload).slice(0, 240));
  const todo = await sql<{ title: string; assigneeRole: string; status: string }[]>`
    SELECT title, assignee_role AS "assigneeRole", status FROM tasks WHERE task_type='triage_new_opportunities' ORDER BY created_at DESC LIMIT 1`;
  if (todo[0]) console.log('  latest triage ToDo:', todo[0].title, '·', todo[0].assigneeRole, '·', todo[0].status);

  console.log(`\n${ok ? '✅ ALL PASS — opportunity_scout is live (detection → AI prioritization → triage ToDo)' : '❌ see failures above'}\n`);
} catch (e) {
  console.error('DRIVE ERROR', e);
  ok = false;
} finally {
  await sql.end();
  process.exit(ok ? 0 : 1);
}
