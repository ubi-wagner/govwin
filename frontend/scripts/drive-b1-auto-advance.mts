// SPINE-B1 live drive — the AI-manager AUTONOMOUS auto-advance (TW-8 fast-follow). Proves
// sweepAutoAdvanceGates() closes an agent_manager+autoAdvance gate the moment its stage_review lands,
// with NO human click, and does NOT advance when the review is still pending (idempotent + safe).
//   DATABASE_URL_OWNER=<owner> node --import tsx scripts/drive-b1-auto-advance.mts
import { sqlBypass } from '@/lib/db';
import { sweepAutoAdvanceGates } from '@/lib/portal-workflow';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const OPP = 'd53a22e4-792d-4fe7-8253-a42270fd9981';
const STAGE = 'draft';

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };

// A minimal 2-stage config: stage[0] an AI-manager gate set to auto-advance; stage[1] a plain human stage.
const config = {
  stages: [
    { key: STAGE, label: 'Draft', gateCloser: 'agent_manager', agentManagerKey: 'proposal_manager', autoAdvance: true, todos: [] },
    { key: 'review', label: 'Review', gateCloser: 'human', todos: [] },
  ],
};

let portalId: string | null = null;
try {
  // Temp portal parked AT the auto-advance gate (index 0, executing).
  const [pp] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposal_portals (tenant_id, opportunity_id, label, status, current_stage_index, guardrail_config)
    VALUES (${FND}::uuid, ${OPP}::uuid, 'b1-auto-advance-drive', 'executing', 0, ${sqlBypass.json(config)})
    RETURNING id`;
  portalId = pp.id;
  // The gate ToDo whose completion IS the gate close.
  await sqlBypass`
    INSERT INTO tasks (tenant_id, entity_type, entity_id, task_type, title, status, assignee_role, params)
    VALUES (${FND}::uuid, 'portal', ${portalId}::uuid, 'stage_review', 'AI review — Draft', 'open', 'tenant_admin',
            ${sqlBypass.json({ kind: 'review', stage: STAGE, agentGate: true, agentManagerKey: 'proposal_manager', autoAdvance: true })})`;
  // The cohort was REQUESTED but has not completed yet.
  const evt = (type: string) => sqlBypass`
    INSERT INTO system_events (namespace, type, phase, actor_type, actor_id, tenant_id, payload, created_at)
    VALUES ('capture', ${type}, 'single', 'system', 'system', ${FND}::uuid,
            ${sqlBypass.json({ portalId, stageKey: STAGE, verdict: 'pass', summary: 'All checks pass.', noteCount: 0 })}, now())`;
  await evt('stage_review.requested');

  // 1. NEGATIVE — review still pending → the sweep must NOT advance this gate.
  const r0 = await sweepAutoAdvanceGates();
  const seen0 = r0.results.find((x) => x.portalId === portalId);
  check('review pending → sweep does NOT advance (reason review_pending)', seen0?.advanced === false && seen0?.reason === 'review_pending');
  const idx0 = (await sqlBypass<Array<{ i: number }>>`SELECT current_stage_index AS i FROM proposal_portals WHERE id=${portalId}::uuid`)[0].i;
  check('  …portal still parked at stage 0', idx0 === 0);

  // 2. The AI-manager cohort LANDS its review.
  await evt('stage_review.completed');

  // 3. POSITIVE — the sweep now closes the gate + advances autonomously (no human click).
  const r1 = await sweepAutoAdvanceGates();
  const seen1 = r1.results.find((x) => x.portalId === portalId);
  check('review complete → sweep AUTO-ADVANCES the gate', seen1?.advanced === true);
  const [after] = await sqlBypass<Array<{ i: number; status: string }>>`SELECT current_stage_index AS i, status FROM proposal_portals WHERE id=${portalId}::uuid`;
  check('  …portal advanced to stage 1', after.i === 1);
  const gate = await sqlBypass<Array<{ status: string; result: Record<string, unknown> | null }>>`
    SELECT status, result FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='portal' AND entity_id=${portalId}::uuid AND params->>'agentGate'='true'`;
  check('  …the gate ToDo is completed, closedBy=ai_manager_auto',
    gate.some((g) => g.status === 'completed' && (g.result as { closedBy?: string })?.closedBy === 'ai_manager_auto'));
  const adv = await sqlBypass<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM system_events WHERE type='stage_review.advanced' AND payload->>'portalId'=${portalId} AND payload->>'auto'='true'`;
  check('  …a capture:stage_review.advanced {auto:true} was audited', adv[0].n >= 1);

  // 4. Idempotent — a second sweep does not re-advance (gate already closed / stage changed).
  const r2 = await sweepAutoAdvanceGates();
  const seen2 = r2.results.find((x) => x.portalId === portalId);
  check('second sweep is idempotent (no double-advance)', !seen2 || seen2.advanced === false);

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-B1 AI-manager auto-advance (${pass} checks)`);
} finally {
  if (portalId) {
    await sqlBypass`DELETE FROM tasks WHERE entity_type='portal' AND entity_id=${portalId}::uuid`.catch(() => {});
    await sqlBypass`DELETE FROM system_events WHERE payload->>'portalId'=${portalId}`.catch(() => {});
    await sqlBypass`DELETE FROM proposal_portals WHERE id=${portalId}::uuid`.catch(() => {});
  }
  await sqlBypass.end();
}
process.exit(fail === 0 ? 0 : 1);
