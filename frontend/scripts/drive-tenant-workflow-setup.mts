// Live proof of the Tenant Workflow Setup write paths (TW-2+) against the REAL DB under
// production-faithful RLS (govtech_app app conn + owner escape hatch). Proves:
//   • editPortalWorkflow(accept) — required Accept & Start: stamps _setup=accepted + creates the
//     current stage's ToDos from the accepted config (absolute stage date + owner honored).
//   • editPortalWorkflow(save)  — re-projects the current stage's OPEN task onto new date/assignee/
//     nudges, resetting nudges_sent so the sweep re-fires; and cancels a removed todo.
// Grows across TW-4/5/7 (per-task PATCH, rebaseline, browser). Run:
//   DATABASE_URL=<govtech_app> DATABASE_URL_OWNER=<owner> node --import tsx scripts/drive-tenant-workflow-setup.mts
import { sqlBypass } from '@/lib/db';
import { editPortalWorkflow, rebaselineConfig, type GuardrailConfig } from '@/lib/portal-workflow';
import { updateTask } from '@/lib/tasks/update-task';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';                 // Foundation
const OPP = 'd53a22e4-792d-4fe7-8253-a42270fd9981';                 // TVSF Round 45
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';               // kate.ulepic (tenant_admin)
const actor = { id: KATE, email: 'kate.ulepic@foundation3dp.com', role: 'tenant_admin' as const, tenantId: FND };
const D1 = '2026-06-01T00:00:00.000Z';
const D2 = '2026-07-15T00:00:00.000Z';

let pass = 0, fail = 0;
const ok = (b: boolean) => (b ? '✅' : '❌');
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${ok(b)} ${label}`); };
const stageTask = async (portalId: string) => {
  const [t] = await sqlBypass<Array<{ id: string; status: string; dueAt: Date | null; assigneeRole: string | null; assigneeUserId: string | null; nudgeSchedule: unknown; nudgesSent: unknown }>>`
    SELECT id, status, due_at AS "dueAt", assignee_role AS "assigneeRole", assignee_user_id AS "assigneeUserId",
           nudge_schedule AS "nudgeSchedule", nudges_sent AS "nudgesSent"
    FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='portal' AND entity_id=${portalId}::uuid AND params->>'stage'='kickoff'
    ORDER BY created_at DESC LIMIT 1`;
  return t;
};

let portalId = '';
try {
  const cfg = (extra: Partial<GuardrailConfig> = {}): GuardrailConfig => ({
    nudgeDays: [5, 2, 1],
    stages: [{ key: 'kickoff', label: 'Kickoff', dueDate: D1, todos: [{ type: 'acknowledge', title: 'Ack the kickoff', assigneeRole: 'tenant_admin' }] }],
    _setup: { status: 'pending' },
    ...extra,
  });
  const [pp] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposal_portals (tenant_id, opportunity_id, proposal_id, label, status, current_stage_index, guardrail_config, created_by)
    VALUES (${FND}::uuid, ${OPP}::uuid, NULL, 'tw-proof', 'launched', 0, ${sqlBypass.json(cfg() as never)}, ${KATE}::uuid)
    RETURNING id`;
  portalId = pp.id;
  console.log(`setup: launched portal ${portalId} (_setup pending, 1 kickoff todo)\n`);

  // ── Accept & Start ──
  const acc = await editPortalWorkflow(actor, FND, portalId, cfg(), { accept: true });
  check('accept ok', acc.ok === true && acc.accepted === true);
  check(`accept created the stage todo (created=${acc.created})`, (acc.created ?? 0) === 1);
  const [afterAccept] = await sqlBypass<Array<{ guardrailConfig: GuardrailConfig }>>`SELECT guardrail_config AS "guardrailConfig" FROM proposal_portals WHERE id=${portalId}::uuid`;
  check('_setup flipped to accepted', afterAccept?.guardrailConfig?._setup?.status === 'accepted');
  const t1 = await stageTask(portalId);
  check('task due_at = the absolute stage date (D1)', !!t1?.dueAt && new Date(t1.dueAt).toISOString() === D1);
  check('task assignee = the role (tenant_admin)', t1?.assigneeRole === 'tenant_admin' && !t1?.assigneeUserId);

  // ── Save (re-project): move the date to D2 + assign a named person + new nudge ──
  const edited = cfg({
    stages: [{ key: 'kickoff', label: 'Kickoff', dueDate: D2, todos: [{ type: 'acknowledge', title: 'Ack the kickoff', assigneeUserId: KATE, nudgeDays: [3] }] }],
    _setup: { status: 'accepted' },
  });
  // pre-set a nudges_sent watermark to prove the reschedule resets it
  if (t1) await sqlBypass`UPDATE tasks SET nudges_sent='[5]'::jsonb WHERE id=${t1.id}::uuid`;
  const sav = await editPortalWorkflow(actor, FND, portalId, edited, {});
  check('save ok', sav.ok === true);
  check(`save re-projected the existing task in place (reprojected=${sav.reprojected}, created=${sav.created})`, (sav.reprojected ?? 0) === 1 && (sav.created ?? 0) === 0);
  const t2 = await stageTask(portalId);
  check('same task id (identity preserved, not recreated)', !!t2 && t2.id === t1?.id);
  check('task due_at re-projected to D2', !!t2?.dueAt && new Date(t2.dueAt).toISOString() === D2);
  check('task reassigned to the named person (role cleared)', t2?.assigneeUserId === KATE && !t2?.assigneeRole);
  check('nudge_schedule re-projected to [3]', JSON.stringify(t2?.nudgeSchedule) === JSON.stringify([3]));
  check('nudges_sent RESET to [] (so the rescheduled nudge re-fires)', JSON.stringify(t2?.nudgesSent) === JSON.stringify([]));

  // ── Save (remove the todo) → cancel ──
  const emptied = cfg({ stages: [{ key: 'kickoff', label: 'Kickoff', dueDate: D2, todos: [] }], _setup: { status: 'accepted' } });
  const del = await editPortalWorkflow(actor, FND, portalId, emptied, {});
  check(`save cancelled the removed todo (cancelled=${del.cancelled})`, (del.cancelled ?? 0) === 1);
  const t3 = await stageTask(portalId);
  check('the task is now cancelled', t3?.status === 'cancelled');

  // ── Guard: a below-bar accept is rejected ──
  const bad = await editPortalWorkflow(actor, FND, portalId, cfg({ stages: [{ key: 'k2', todos: [{ type: 'acknowledge' }] }] }), { accept: true });
  check('accept rejects an incomplete config (no date/owner)', bad.ok === false && bad.code === 'INCOMPLETE');

  // ── TW-4: per-task reassign / reschedule / re-nudge (a fresh open task) ──
  const D3 = '2026-08-20T00:00:00.000Z';
  await editPortalWorkflow(actor, FND, portalId, cfg({
    stages: [{ key: 'kickoff', label: 'Kickoff', dueDate: D2, todos: [{ type: 'acknowledge', title: 'Fresh ack', assigneeRole: 'tenant_admin' }] }],
    _setup: { status: 'accepted' },
  }), {});
  const tf = await stageTask(portalId);
  check('re-added a fresh open task for the PATCH test', !!tf && tf.status === 'open');
  if (tf) {
    check('updateTask reassign to a named person ok', (await updateTask({ actor, tenantId: FND, taskId: tf.id, assigneeUserId: KATE })).ok === true);
    await sqlBypass`UPDATE tasks SET nudges_sent='[2]'::jsonb WHERE id=${tf.id}::uuid`;
    check('updateTask reschedule ok', (await updateTask({ actor, tenantId: FND, taskId: tf.id, dueAt: D3, nudgeSchedule: [2] })).ok === true);
    const tg = await stageTask(portalId);
    check('task reassigned to the named person (role cleared)', tg?.assigneeUserId === KATE && !tg?.assigneeRole);
    check('task rescheduled to D3 + nudge [2] + nudges_sent reset',
      !!tg?.dueAt && new Date(tg.dueAt).toISOString() === D3 && JSON.stringify(tg?.nudgeSchedule) === JSON.stringify([2]) && JSON.stringify(tg?.nudgesSent) === JSON.stringify([]));
    check('updateTask rejects a non-member assignee', (await updateTask({ actor, tenantId: FND, taskId: tf.id, assigneeUserId: '00000000-0000-0000-0000-000000000000' })).code === 'VALIDATION_ERROR');
    await sqlBypass`UPDATE tasks SET status='completed' WHERE id=${tf.id}::uuid`;
    check('updateTask rejects editing a completed to-do', (await updateTask({ actor, tenantId: FND, taskId: tf.id, dueAt: D3 })).code === 'CONFLICT');
  }

  // ── TW-5: rebaseline shifts the whole timeline + re-projects the current stage ──
  const rebStage = { key: 'kickoff', label: 'Kickoff', dueDate: D2, todos: [{ type: 'acknowledge' as const, title: 'Rebaseline ack', assigneeRole: 'tenant_admin' }] };
  await editPortalWorkflow(actor, FND, portalId, cfg({ stages: [rebStage], _setup: { status: 'accepted' } }), {});
  const rebased = rebaselineConfig(cfg({ stages: [rebStage], _setup: { status: 'accepted' } }), { shiftDays: 7 });
  const reb = await editPortalWorkflow(actor, FND, portalId, rebased, {});
  check('rebaseline (+7d) re-projected the task', (reb.reprojected ?? 0) === 1);
  const tr = await stageTask(portalId);
  check('rebaseline shifted the task due_at by 7 days',
    !!tr?.dueAt && new Date(tr.dueAt).getTime() === new Date(D2).getTime() + 7 * 86_400_000);

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.error('DRIVE ERROR', e);
  fail++;
} finally {
  try {
    if (portalId) {
      await sqlBypass`DELETE FROM tasks WHERE entity_type='portal' AND entity_id=${portalId}::uuid`;
      await sqlBypass`DELETE FROM proposal_portals WHERE id=${portalId}::uuid`;
    }
    console.log('cleanup: throwaway portal + tasks removed');
  } catch (ce) { console.error('cleanup warning', ce); }
  await sqlBypass.end({ timeout: 5 });
  process.exit(fail === 0 ? 0 : 1);
}
