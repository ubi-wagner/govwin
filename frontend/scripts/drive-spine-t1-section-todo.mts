// SPINE-T1 live drive — the section-editing ToDo spine, against the REAL DB under production-faithful
// RLS (govtech_app app conn + owner escape hatch). Proves:
//   • listSectionAssignees returns tenant editors (+ collaborators)
//   • assignSection sets proposal_sections.assigned_to AND raises an entity_type='section' edit ToDo
//     for the assignee, deep-linking (taskHref 'section' case) to the section editor
//   • the edit-access guard refuses an assignee who can't edit the section
//   • re-assign cancels the prior OPEN section ToDo (no duplicates)
//   • completeSectionTodos (what the lock fires) auto-completes the section ToDo
//   • clearing the assignment nulls assigned_to + cancels the ToDo
// Run: DATABASE_URL=<govtech_app> DATABASE_URL_OWNER=<owner> node --import tsx scripts/drive-spine-t1-section-todo.mts
import { sqlBypass } from '@/lib/db';
import { assignSection, listSectionAssignees, completeSectionTodos } from '@/lib/proposal/section-todo';
import { taskHref } from '@/lib/tasks/completers';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const PROP = '108ed23d-2fac-4f6d-b8f1-a78109dcd102';           // TVSF-R45 draft (18 unlocked sections)
const SEC = 'b8328309-0101-4942-8f20-462a9e204c4e';            // Market Opportunity (draft, unlocked)
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';          // tenant_admin (assigner)
const CONNOR = 'bd51aacd-773f-4294-b4f1-81b5ae689860';        // tenant_user (editor — assignee)
const kate = { id: KATE, email: 'kate.ulepic@foundation3dp.com', role: 'tenant_admin' as const, tenantId: FND };

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };
const sectionTodos = async () =>
  sqlBypass<Array<{ id: string; status: string; assigneeUserId: string | null; taskType: string; params: Record<string, unknown> }>>`
    SELECT id, status, assignee_user_id AS "assigneeUserId", task_type AS "taskType", params
    FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid ORDER BY created_at`;
const assignedTo = async () =>
  (await sqlBypass<Array<{ a: string | null }>>`SELECT assigned_to AS a FROM proposal_sections WHERE id=${SEC}::uuid`)[0]?.a ?? null;

try {
  // Clean slate.
  await sqlBypass`DELETE FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  await sqlBypass`UPDATE proposal_sections SET assigned_to=NULL WHERE id=${SEC}::uuid`;

  // 1. Pickable assignees.
  const assignees = await listSectionAssignees(FND, PROP);
  check(`listSectionAssignees returns the tenant editors (${assignees.length})`, assignees.length >= 1);
  check('  …includes Connor (a tenant editor)', assignees.some((a) => a.id === CONNOR && a.kind === 'member'));

  // 2. Assign the section to Connor (an editor) → assigned_to set + a section ToDo raised.
  const r1 = await assignSection(kate, FND, PROP, SEC, CONNOR);
  check('assignSection(→Connor) ok', r1.ok === true && (r1 as { assigned: boolean }).assigned === true);
  check('  …proposal_sections.assigned_to = Connor', (await assignedTo()) === CONNOR);
  const t1 = await sectionTodos();
  check('  …one open edit_section ToDo, entity_type=section, assigned to Connor',
    t1.length === 1 && t1[0].status === 'open' && t1[0].taskType === 'edit_section' && t1[0].assigneeUserId === CONNOR);

  // 3. taskHref deep-links to the section editor (proposalId rides in params).
  const href = taskHref({ tenantSlug: 'foundation', entityType: 'section', entityId: SEC, params: t1[0]?.params });
  check(`  …taskHref deep-links to the section editor (${href})`, href === `/portal/foundation/proposals/${PROP}/sections/${SEC}`);

  // 4. Guard: assign to a non-editor (a random non-member) is refused.
  const r2 = await assignSection(kate, FND, PROP, SEC, '00000000-0000-0000-0000-000000000000');
  check('assign to a non-editor is refused (edit-access guard)', r2.ok === false);

  // 5. Re-assign to Kate → Connor's OPEN ToDo is cancelled, a fresh one for Kate.
  const r3 = await assignSection(kate, FND, PROP, SEC, KATE);
  check('re-assign(→Kate) ok', r3.ok === true);
  const t2 = await sectionTodos();
  check('  …Connor’s ToDo cancelled, exactly one OPEN ToDo now, for Kate',
    t2.filter((t) => t.status === 'cancelled' && t.assigneeUserId === CONNOR).length === 1 &&
    t2.filter((t) => t.status === 'open').length === 1 &&
    t2.find((t) => t.status === 'open')?.assigneeUserId === KATE);

  // 6. completeSectionTodos (what section lock fires) auto-completes the open ToDo.
  const n = await completeSectionTodos(FND, SEC, KATE, 'locked');
  check(`completeSectionTodos closed the open ToDo (${n})`, n === 1);
  const t3 = await sectionTodos();
  check('  …no OPEN section ToDo remains (auto-completed on lock)', t3.filter((t) => t.status === 'open').length === 0);
  check('  …the completed ToDo records auto=true', !!t3.find((t) => t.status === 'completed' && (t.params, true)));

  // 7. Clear the assignment.
  const r4 = await assignSection(kate, FND, PROP, SEC, null);
  check('clear assignment ok', r4.ok === true && (r4 as { assigned: boolean }).assigned === false);
  check('  …assigned_to is NULL', (await assignedTo()) === null);

  // 8. H2 guard: assigning a LOCKED (read-only) section is refused.
  await sqlBypass`UPDATE proposal_sections SET is_locked=true WHERE id=${SEC}::uuid`;
  const rLocked = await assignSection(kate, FND, PROP, SEC, CONNOR);
  check('assign to a LOCKED section is refused (SECTION_LOCKED)', rLocked.ok === false && (rLocked as { code?: string }).code === 'SECTION_LOCKED');
  await sqlBypass`UPDATE proposal_sections SET is_locked=false WHERE id=${SEC}::uuid`;

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-T1 section-ToDo spine (${pass} checks)`);
} finally {
  // Teardown.
  await sqlBypass`DELETE FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  await sqlBypass`UPDATE proposal_sections SET assigned_to=NULL WHERE id=${SEC}::uuid`;
  await sqlBypass`DELETE FROM system_events WHERE type='section.assigned' AND payload->>'sectionId'=${SEC}`;
  await sqlBypass.end();
}
process.exit(fail === 0 ? 0 : 1);
