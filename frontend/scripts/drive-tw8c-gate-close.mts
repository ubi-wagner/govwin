// TW-8c live drive — the FRONTEND gate-close half of the AI-manager stage gate, against the REAL DB
// under production-faithful RLS (govtech_app app conn + owner escape hatch). Proves closeAgentGate:
//   • review-pending guard  — refuses to advance until the pipeline's stage_review.completed lands
//   • auto opt-in guard      — auto:true is refused unless the stage set autoAdvance
//   • ASSISTED close         — auto:false advances once the review landed; gate ToDo → completed;
//                              emits capture:stage_review.advanced (auto=false)
//   • AUTO close             — auto:true advances a stage that opted in; advanced event (auto=true)
//   • the NEXT stage's gate  — a human stage 1 does NOT re-fire an AI review (reviewState=null)
// Run:
//   DATABASE_URL=<govtech_app> DATABASE_URL_OWNER=<owner> node --import tsx scripts/drive-tw8c-gate-close.mts
import { sqlBypass } from '@/lib/db';
import {
  instantiatePortalWorkflow, closeAgentGate, getStageReviewState, type GuardrailConfig,
} from '@/lib/portal-workflow';
import { emitEventSingle, agentActor } from '@/lib/events';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';                 // Foundation
const OPP = 'd53a22e4-792d-4fe7-8253-a42270fd9981';                 // TVSF Round 45
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';               // kate.ulepic (tenant_admin)
const actor = { id: KATE, email: 'kate.ulepic@foundation3dp.com', role: 'tenant_admin' as const, tenantId: FND };
const D1 = '2026-06-01T00:00:00.000Z';
const D2 = '2026-07-15T00:00:00.000Z';

let pass = 0, fail = 0;
const ok = (b: boolean) => (b ? '✅' : '❌');
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${ok(b)} ${label}`); };

// Simulate the pipeline landing its review — exactly what OnPortalStageReviewRequested.record_stage_review emits.
async function landReview(portalId: string, stageKey: string) {
  await emitEventSingle({
    namespace: 'capture', type: 'stage_review.completed', actor: agentActor('advisory_manager', FND), tenantId: FND,
    payload: { portalId, stageKey, verdict: 'reviewed', auto: false, agentManagerKey: 'advisory_manager' },
  });
}

async function makePortal(autoAdvance: boolean, label: string): Promise<string> {
  const cfg: GuardrailConfig = {
    nudgeDays: [3, 1],
    stages: [
      { key: 'color_team', label: 'Color team', dueDate: D1, gateCloser: 'agent_manager', agentManagerKey: 'advisory_manager', autoAdvance },
      { key: 'final', label: 'Final', dueDate: D2, todos: [{ type: 'acknowledge', title: 'Final ack', assigneeRole: 'tenant_admin' }] },
    ],
    _setup: { status: 'accepted' },
  } as GuardrailConfig;
  const [pp] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposal_portals (tenant_id, opportunity_id, proposal_id, label, status, current_stage_index, guardrail_config, created_by)
    VALUES (${FND}::uuid, ${OPP}::uuid, NULL, ${label}, 'executing', 0, ${sqlBypass.json(cfg as never)}, ${KATE}::uuid)
    RETURNING id`;
  await instantiatePortalWorkflow(actor, FND, pp.id, cfg);
  return pp.id;
}

const stageIndex = async (portalId: string) =>
  (await sqlBypass<Array<{ i: number }>>`SELECT current_stage_index AS i FROM proposal_portals WHERE id=${portalId}::uuid`)[0]?.i;
const gateTaskStatus = async (portalId: string) =>
  (await sqlBypass<Array<{ status: string }>>`SELECT status FROM tasks WHERE entity_type='portal' AND entity_id=${portalId}::uuid AND params->>'agentGate'='true' ORDER BY created_at DESC LIMIT 1`)[0]?.status;
const advancedEvents = async (portalId: string) =>
  (await sqlBypass<Array<{ auto: boolean }>>`SELECT (payload->>'auto')::boolean AS auto FROM system_events WHERE type='stage_review.advanced' AND payload->>'portalId'=${portalId} ORDER BY created_at DESC`);

const created: string[] = [];
try {
  // ════ Portal A — ASSISTED (autoAdvance=false) ════
  const A = await makePortal(false, 'tw8c-assisted'); created.push(A);
  console.log(`\n── Portal A (assisted) ${A} ──`);
  const r0 = await getStageReviewState(A, 'color_team');
  check('on entry: review requested, NOT yet completed', r0.requested === true && r0.completed === false);
  check('gate ToDo created (open)', (await gateTaskStatus(A)) === 'open');

  const g1 = await closeAgentGate(actor, FND, A, { auto: false });
  check('assisted advance BEFORE the review lands → refused (review_pending)', g1.advanced === false && g1.reason === 'review_pending');
  check('  …portal did NOT move', (await stageIndex(A)) === 0);

  await landReview(A, 'color_team');
  const r1 = await getStageReviewState(A, 'color_team');
  check('after the pipeline lands: completed=true, verdict=reviewed', r1.completed === true && r1.verdict === 'reviewed');

  const gAuto = await closeAgentGate(actor, FND, A, { auto: true });
  check('AUTO advance on a NON-opted-in stage → refused (auto_not_enabled)', gAuto.advanced === false && gAuto.reason === 'auto_not_enabled');
  check('  …portal STILL did not move', (await stageIndex(A)) === 0);

  const g2 = await closeAgentGate(actor, FND, A, { auto: false });
  check('assisted advance AFTER the review lands → advanced to stage 1', g2.advanced === true && g2.stageIndex === 1);
  check('  …portal current_stage_index = 1', (await stageIndex(A)) === 1);
  check('  …gate ToDo closed (completed)', (await gateTaskStatus(A)) === 'completed');
  const aEv = await advancedEvents(A);
  check('  …emitted stage_review.advanced (auto=false)', aEv.length === 1 && aEv[0].auto === false);
  // The next stage's ToDos MUST be created on advance — under production RLS this fails unless
  // advancePortalStage scopes createStageTodos to the tenant (the runInTenant fix this drive surfaced).
  const nextTodo = (await sqlBypass<Array<{ status: string }>>`SELECT status FROM tasks WHERE entity_type='portal' AND entity_id=${A}::uuid AND params->>'stage'='final' ORDER BY created_at DESC LIMIT 1`)[0];
  check('  …the NEXT stage’s ToDo was created (RLS-scoped on advance)', nextTodo?.status === 'open');
  // Stage 1 is a HUMAN stage → no AI review re-fires for it.
  const r2 = await getStageReviewState(A, 'final');
  check('the next (human) stage has NO AI review state', r2.requested === false && r2.completed === false);

  // ════ Portal B — AUTO (autoAdvance=true) ════
  const B = await makePortal(true, 'tw8c-auto'); created.push(B);
  console.log(`\n── Portal B (auto) ${B} ──`);
  await landReview(B, 'color_team');
  const gb = await closeAgentGate(actor, FND, B, { auto: true });
  check('opted-in AUTO advance after the review lands → advanced', gb.advanced === true && gb.stageIndex === 1);
  check('  …portal current_stage_index = 1', (await stageIndex(B)) === 1);
  check('  …gate ToDo closed (completed)', (await gateTaskStatus(B)) === 'completed');
  const bEv = await advancedEvents(B);
  check('  …emitted stage_review.advanced (auto=true)', bEv.length === 1 && bEv[0].auto === true);

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — TW-8c gate-close (${pass} checks)`);
} finally {
  // Clean up the synthetic portals + their tasks/events.
  for (const id of created) {
    await sqlBypass`DELETE FROM tasks WHERE entity_type='portal' AND entity_id=${id}::uuid`;
    await sqlBypass`DELETE FROM system_events WHERE payload->>'portalId'=${id}`;
    await sqlBypass`DELETE FROM proposal_portals WHERE id=${id}::uuid`;
  }
  await sqlBypass.end();
}
process.exit(fail === 0 ? 0 : 1);
