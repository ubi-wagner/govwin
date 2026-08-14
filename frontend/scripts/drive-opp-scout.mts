/** Live proof (AGENTS-LIVE-3): waking opportunity_scout via the new stageIntake producer.
 *  Calls the REAL stageIntake (emits finder:opportunities.detected) → the Python worker runs
 *  OnOpportunitiesDetected → opportunity_scout AI_INVOKE on the emulator + a triage ToDo.
 *  cd frontend && DATABASE_URL=… node --import tsx scripts/drive-opp-scout.mts */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { stageIntake } from '@/lib/intake';

const EMU_LOG = '/tmp/govwin-sandbox/emulated-claude.log.jsonl';
const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 4 });
const ADMIN = '3667ead2-3b5e-4cc8-97f7-b2ab1cfa907d';
let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const emuLines = () => { try { return readFileSync(EMU_LOG, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  console.log('\n── AGENTS-LIVE-3 · opportunity_scout woken via stageIntake ──\n');

  // Baselines
  const emu0 = emuLines();
  const [{ n: scout0 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE type='agent.invoked' AND payload::text LIKE '%opportunity_scout%'`;
  const [{ n: det0 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE namespace='finder' AND type='opportunities.detected'`;
  const [{ n: triage0 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE task_type='triage_new_opportunities'`;

  // Fire the producer: stage a distinctive new intake notice.
  const staged = await stageIntake({
    title: 'AGENTS-LIVE probe — Directed Energy Counter-UAS (live opportunity_scout drive)',
    agency: 'Department of the Air Force',
    programType: 'sbir_phase_1',
    description: 'Probe notice to wake the detection→triage chain end-to-end.',
    intakeMeta: { foundBy: 'admin' },
  }, ADMIN);
  A('stageIntake succeeded', !('error' in staged), 'error' in staged ? staged.error : `opp=${staged.opportunityId}`);

  // Confirm the producer emitted the detection event.
  await sleep(500);
  const [{ n: det1 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE namespace='finder' AND type='opportunities.detected'`;
  A('stageIntake emitted finder:opportunities.detected', det1 > det0, `${det0} → ${det1}`);

  // Poll for the worker to run opportunity_scout + create the triage ToDo (worker polls ~10s).
  let scout1 = scout0, triage1 = triage0, emu1 = emu0;
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    [{ n: scout1 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events WHERE type='agent.invoked' AND payload::text LIKE '%opportunity_scout%'`;
    [{ n: triage1 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE task_type='triage_new_opportunities'`;
    emu1 = emuLines();
    if (scout1 > scout0 && triage1 > triage0) break;
    console.log(`  …poll ${i + 1}: agent.invoked(scout)=${scout1} triage=${triage1} emuCalls=${emu1 - emu0}`);
  }

  A('worker ran opportunity_scout on the emulator (agent.invoked)', scout1 > scout0, `${scout0} → ${scout1}`);
  A('emulator served the opportunity_scout tool-loop (LLM calls)', emu1 > emu0, `+${emu1 - emu0} calls`);
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
