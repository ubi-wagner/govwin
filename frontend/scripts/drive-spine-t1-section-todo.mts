/**
 * SPINE-T1 — the section-editing ToDo spine, against the real database.
 *
 *   • `listSectionAssignees` returns the company's editors (+ this build's collaborators)
 *   • `assignSection` sets `proposal_sections.assigned_to` AND raises an `entity_type='section'`
 *     edit ToDo for the assignee, deep-linking (taskHref's 'section' case) to the section editor
 *   • the edit-access guard refuses an assignee who cannot edit the section
 *   • re-assigning CANCELS the prior open section ToDo — no duplicates
 *   • `completeSectionTodos` (what the lock fires) auto-completes the section ToDo
 *   • clearing the assignment nulls `assigned_to` and cancels the ToDo
 *   • a LOCKED section refuses assignment (SECTION_LOCKED)
 *
 * BUILDS ITS OWN SITUATION. It used to pin four uuids — a tenant, a proposal commented
 * "TVSF-R45 draft (18 unlocked sections)", one section, and two named people. Everything after
 * `listSectionAssignees` then failed: `assignSection` returned `ok:false` because the actor no
 * longer had manage-team access on a proposal that had moved on, and ten assertions reported the
 * ToDo spine as broken when what was broken was the fixture.
 *
 * It now builds a company, a real editor (added through the team route, so the membership is one
 * the PRODUCT made — `listSectionAssignees` reads `user_memberships`, and a hand-inserted row
 * would be testing the harness's idea of a member rather than the product's), a build, and an
 * outsider for the guard. Note the guard case is now stronger than it was: it used to assign to
 * the all-zeros uuid, which tests "no such user"; it now assigns to a REAL, ACTIVE person who
 * simply is not a member here, which is the case the guard actually exists for.
 *
 *   cd frontend && DATABASE_URL=<owner> node --import tsx scripts/drive-spine-t1-section-todo.mts
 */
import { sqlBypass as sql } from '@/lib/db';
import { assignSection, listSectionAssignees, completeSectionTodos } from '@/lib/proposal/section-todo';
import { taskHref } from '@/lib/tasks/completers';
import { runScenario, CannotRun } from './lib/scenario.mts';
import { BASE, launch, signIn } from './lib/cross-company.mts';

await runScenario('spine-section-todo', async (s) => {
  let pass = 0, fail = 0;
  const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };

  const co = await s.tenant({ label: 'co' });
  const build = await s.build({ tenant: co, label: 't1' });

  // The EDITOR, added through the product's own team route so the membership is real.
  const editor = await s.user({ label: 'editor', role: 'tenant_user', homeTenant: co });
  // The OUTSIDER for the guard: a real, active person with no membership here.
  const outsider = await s.user({ label: 'outsider', role: 'tenant_user', homeTenant: null });

  const browser = await launch();
  try {
    const admin = await signIn(browser, co.adminEmail, co.password);
    const teamRes = await admin.request.post(`${BASE}/api/portal/${co.slug}/team`, {
      data: { email: editor.email, name: `editor ${s.tag}`, role: 'tenant_user' },
    });
    if (teamRes.status() >= 300) {
      throw new CannotRun(`the team route refused to add an editor (${teamRes.status()}): `
        + `${(await teamRes.text()).slice(0, 140)}`);
    }
    await admin.close();
  } finally {
    await browser.close();
  }

  const [sec] = await sql<{ id: string }[]>`
    SELECT id FROM proposal_sections
    WHERE proposal_id = ${build.proposalId}::uuid AND is_locked = false
    ORDER BY sort_index ASC NULLS LAST LIMIT 1`;
  if (!sec) throw new CannotRun(`the provisioned build has no unlocked section (${build.sectionCount} total)`);

  const SEC = sec.id;
  const actor = { id: co.adminUserId, email: co.adminEmail, role: 'tenant_admin' as const, tenantId: co.tenantId };

  const sectionTodos = () => sql<Array<{
    id: string; status: string; assigneeUserId: string | null; taskType: string; params: Record<string, unknown>;
  }>>`
    SELECT id, status, assignee_user_id AS "assigneeUserId", task_type AS "taskType", params
    FROM tasks WHERE tenant_id = ${co.tenantId}::uuid AND entity_type = 'section' AND entity_id = ${SEC}::uuid
    ORDER BY created_at`;
  const assignedTo = async () =>
    (await sql<Array<{ a: string | null }>>`
      SELECT assigned_to AS a FROM proposal_sections WHERE id = ${SEC}::uuid`)[0]?.a ?? null;

  // 1 · pickable assignees
  const assignees = await listSectionAssignees(co.tenantId, build.proposalId);
  check(`listSectionAssignees returns the company's editors (${assignees.length})`, assignees.length >= 1);
  check('  …includes the editor added through the team route',
    assignees.some((a) => a.id === editor.userId && a.kind === 'member'));

  // 2 · assign to the editor → assigned_to set + a section ToDo raised
  const r1 = await assignSection(actor, co.tenantId, build.proposalId, SEC, editor.userId);
  check(`assignSection(→editor) ok${r1.ok ? '' : ` — ${(r1 as { code?: string }).code}`}`,
    r1.ok === true && (r1 as { assigned: boolean }).assigned === true);
  check('  …proposal_sections.assigned_to = the editor', (await assignedTo()) === editor.userId);
  const t1 = await sectionTodos();
  check('  …one open edit_section ToDo, entity_type=section, assigned to the editor',
    t1.length === 1 && t1[0].status === 'open' && t1[0].taskType === 'edit_section'
    && t1[0].assigneeUserId === editor.userId);

  // 3 · the ToDo deep-links to the section editor (proposalId rides in params)
  const href = taskHref({ tenantSlug: co.slug, entityType: 'section', entityId: SEC, params: t1[0]?.params });
  check(`  …taskHref deep-links to the section editor (${href})`,
    href === `/portal/${co.slug}/proposals/${build.proposalId}/sections/${SEC}`);

  // 4 · guard: a real person who is not a member here cannot be assigned
  const r2 = await assignSection(actor, co.tenantId, build.proposalId, SEC, outsider.userId);
  check('assign to a non-editor is refused (edit-access guard)', r2.ok === false);

  // 5 · re-assign to the admin → the editor's OPEN ToDo is cancelled, a fresh one raised
  const r3 = await assignSection(actor, co.tenantId, build.proposalId, SEC, co.adminUserId);
  check('re-assign(→admin) ok', r3.ok === true);
  const t2 = await sectionTodos();
  check('  …the editor’s ToDo cancelled, exactly one OPEN ToDo now, for the admin',
    t2.filter((t) => t.status === 'cancelled' && t.assigneeUserId === editor.userId).length === 1
    && t2.filter((t) => t.status === 'open').length === 1
    && t2.find((t) => t.status === 'open')?.assigneeUserId === co.adminUserId);

  // 6 · completeSectionTodos (what a section lock fires) auto-completes the open ToDo
  const n = await completeSectionTodos(co.tenantId, SEC, co.adminUserId, 'locked');
  check(`completeSectionTodos closed the open ToDo (${n})`, n === 1);
  const t3 = await sectionTodos();
  check('  …no OPEN section ToDo remains (auto-completed on lock)',
    t3.filter((t) => t.status === 'open').length === 0);
  check('  …and the closed one is recorded as COMPLETED, not cancelled',
    t3.some((t) => t.status === 'completed' && t.assigneeUserId === co.adminUserId));

  // 7 · clear the assignment
  const r4 = await assignSection(actor, co.tenantId, build.proposalId, SEC, null);
  check('clear assignment ok', r4.ok === true && (r4 as { assigned: boolean }).assigned === false);
  check('  …assigned_to is NULL', (await assignedTo()) === null);

  // 8 · a LOCKED (read-only) section refuses assignment
  await sql`UPDATE proposal_sections SET is_locked = true WHERE id = ${SEC}::uuid`;
  const rLocked = await assignSection(actor, co.tenantId, build.proposalId, SEC, editor.userId);
  check('assign to a LOCKED section is refused (SECTION_LOCKED)',
    rLocked.ok === false && (rLocked as { code?: string }).code === 'SECTION_LOCKED');

  // No restore step — the whole company goes away on dispose, so there is nothing to put back.
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-T1 section-ToDo spine (${pass} checks)`);
  return fail === 0;
});
