// TW-11 browser-test fixture — stage a Foundation portal that exercises every NEW Workflow Setup surface:
//   • an accepted workflow (so the live surfaces render)
//   • the CURRENT stage is an AI-manager gate WITH a landed review → the gate panel + "Advance stage" button
//   • a live open gate ToDo → the "Live to-dos" management section
// Prints the portalId + the two URLs to drive. Idempotent-ish: labels the portal 'tw11-browser'.
import { sqlBypass } from '@/lib/db';
import { instantiatePortalWorkflow, getStageReviewState, type GuardrailConfig } from '@/lib/portal-workflow';
import { emitEventSingle, agentActor } from '@/lib/events';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const OPP = 'd53a22e4-792d-4fe7-8253-a42270fd9981';
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';
const actor = { id: KATE, email: 'kate.ulepic@foundation3dp.com', role: 'tenant_admin' as const, tenantId: FND };

// Clear any prior fixture portal so re-runs are clean.
const prior = await sqlBypass<Array<{ id: string }>>`SELECT id FROM proposal_portals WHERE tenant_id=${FND}::uuid AND label='tw11-browser'`;
for (const p of prior) {
  await sqlBypass`DELETE FROM tasks WHERE entity_type='portal' AND entity_id=${p.id}::uuid`;
  await sqlBypass`DELETE FROM system_events WHERE payload->>'portalId'=${p.id}`;
  await sqlBypass`DELETE FROM proposal_portals WHERE id=${p.id}::uuid`;
}

const cfg: GuardrailConfig = {
  nudgeDays: [5, 2, 1],
  stages: [
    { key: 'color_team', label: 'Color team review', dueDate: '2026-07-01T00:00:00.000Z', gateCloser: 'agent_manager', agentManagerKey: 'advisory_manager', autoAdvance: false },
    { key: 'final', label: 'Final assembly', dueDate: '2026-07-20T00:00:00.000Z', todos: [{ type: 'acknowledge', title: 'Confirm final package', assigneeRole: 'tenant_admin' }] },
  ],
  _setup: { status: 'accepted' },
} as GuardrailConfig;

const [pp] = await sqlBypass<Array<{ id: string }>>`
  INSERT INTO proposal_portals (tenant_id, opportunity_id, proposal_id, label, status, current_stage_index, guardrail_config, created_by)
  VALUES (${FND}::uuid, ${OPP}::uuid, NULL, 'tw11-browser', 'executing', 0, ${sqlBypass.json(cfg as never)}, ${KATE}::uuid)
  RETURNING id`;
await instantiatePortalWorkflow(actor, FND, pp.id, cfg);

// Land the AI review so the gate panel shows "complete" + the Advance button.
await emitEventSingle({
  namespace: 'capture', type: 'stage_review.completed', actor: agentActor('advisory_manager', FND), tenantId: FND,
  payload: { portalId: pp.id, stageKey: 'color_team', verdict: 'reviewed', auto: false, agentManagerKey: 'advisory_manager' },
});
const rs = await getStageReviewState(pp.id, 'color_team');

console.log(JSON.stringify({ portalId: pp.id, reviewCompleted: rs.completed,
  setupUrl: `/portal/foundation/portals/${pp.id}`, adminUrl: `/admin/workflows` }, null, 2));
await sqlBypass.end();
process.exit(0);
