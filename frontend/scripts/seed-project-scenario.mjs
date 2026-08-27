/**
 * A project workspace with real content, for the lenses and the visual sweep.
 *
 * The five lenses and the UI atlas photograph what is THERE. A page rendering its empty state is a
 * valid render and proves almost nothing about the page — `verify-ui-vs-db` in particular cannot
 * compare a stated number to a held one when there are no rows. And the atlas exists because
 * "a page can answer 200, return a textbook envelope, and be visibly broken" (B131), which only a
 * populated page can show.
 *
 * So this seeds one coherent scenario rather than scattered rows: a real award, both anchor
 * documents, two CLINs with mixed provenance, a WBS whose child inherits its CLIN, milestones with
 * genuine variance, and deliverables in all three states — nothing uploaded, uploaded but not
 * accepted, accepted.
 *
 * ── THE MIXED PROVENANCE IS THE POINT ────────────────────────────────────────────────────────
 * One field is cited from the contract, one is a deferral (a citation with NO value — "set out in
 * the Task Order"), and one has no provenance at all. Those render as three different badges, and a
 * screenshot in which they all look the same is the failure the provenance model exists to prevent.
 *
 * Idempotent: re-running replaces the scenario rather than stacking a second copy.
 *
 *   source scripts/sandbox-env.sh && node frontend/scripts/seed-project-scenario.mjs
 */
import postgres from 'postgres';

const OWNER = process.env.DATABASE_URL_OWNER;
if (!OWNER) {
  console.error('DATABASE_URL_OWNER required — source scripts/sandbox-env.sh');
  process.exit(2);
}
const sql = postgres(OWNER, { max: 2, onnotice: () => {} });

const NAME = 'USAF SBIR Phase II — autonomous inspection';

async function main() {
  const [tenant] = await sql`SELECT id, slug FROM tenants WHERE slug = 'foundation' LIMIT 1`;
  if (!tenant) {
    console.error('no `foundation` tenant on this box — the lenses use it, so seed it first');
    process.exit(1);
  }
  const [user] = await sql`
    SELECT u.id FROM users u
      JOIN user_memberships m ON m.user_id = u.id AND m.tenant_id = ${tenant.id} AND m.status = 'active'
     WHERE u.is_active = true ORDER BY u.created_at LIMIT 1`;
  if (!user) { console.error('no active member at `foundation`'); process.exit(1); }

  // Replace rather than stack. Everything cascades from the project.
  await sql`DELETE FROM projects WHERE tenant_id = ${tenant.id} AND name = ${NAME}`;

  const [project] = await sql`
    INSERT INTO projects (tenant_id, name, status, created_by)
    VALUES (${tenant.id}, ${NAME}, 'active', ${user.id}) RETURNING id`;

  await sql`
    INSERT INTO project_assignments (tenant_id, project_id, user_id, assigned_by)
    VALUES (${tenant.id}, ${project.id}, ${user.id}, ${user.id})
    ON CONFLICT (project_id, user_id) DO NOTHING`;

  // Both anchor documents, so the workspace is baseline-ready and the amber banner does NOT show.
  // (A screenshot of the not-ready state is worth having too, which is why the CLIN below still
  // carries a deferral — the two states are independent.)
  const docs = [];
  for (const [kind, filename] of [
    ['executed_contract', 'FA8649-26-P-1234 executed.pdf'],
    ['submitted_proposal', 'Phase II proposal as submitted.pdf'],
  ]) {
    const [d] = await sql`
      INSERT INTO project_source_documents
        (tenant_id, project_id, kind, storage_key, filename, content_type, byte_size, uploaded_by)
      VALUES (${tenant.id}, ${project.id}, ${kind},
              ${`customers/${tenant.slug}/projects/${project.id}/source/${kind}.pdf`},
              ${filename}, 'application/pdf', 1048576, ${user.id})
      RETURNING id`;
    docs.push(d.id);
  }

  const [clin1] = await sql`
    INSERT INTO project_clins
      (tenant_id, project_id, clin_number, title, contract_type, pop_start, pop_end, funded_amount, sort_index)
    VALUES (${tenant.id}, ${project.id}, '0001', 'Base period — prototype development', 'FFP',
            CURRENT_DATE - 120, CURRENT_DATE + 245, 1100000.00, 1)
    RETURNING id`;
  // CLIN 0002's PoP end is genuinely NOT in the contract — it defers to the Task Order. That is a
  // DEFERRAL, not a missing value, and it must render as "Set elsewhere" with the citation rather
  // than as a blank or an invented date.
  const [clin2] = await sql`
    INSERT INTO project_clins
      (tenant_id, project_id, clin_number, title, contract_type, pop_start, pop_end, funded_amount, sort_index)
    VALUES (${tenant.id}, ${project.id}, '0002', 'Option — flight test support', 'CPFF',
            CURRENT_DATE + 246, NULL, NULL, 2)
    RETURNING id`;

  // Three provenance states, side by side.
  await sql`
    INSERT INTO project_provenance
      (tenant_id, project_id, target_table, target_id, field, method, source_doc_id, page, excerpt, created_by)
    VALUES
      (${tenant.id}, ${project.id}, 'project_clins', ${clin1.id}, 'pop_end', 'verified',
       ${docs[0]}, 14, 'The period of performance shall end 365 days after award.', ${user.id}),
      (${tenant.id}, ${project.id}, 'project_clins', ${clin1.id}, 'funded_amount', 'verified',
       ${docs[0]}, 9, 'Total firm-fixed price: $1,100,000.', ${user.id}),
      -- A citation with NO value: the contract says where the answer lives and does not give it.
      (${tenant.id}, ${project.id}, 'project_clins', ${clin2.id}, 'pop_end', 'verified',
       ${docs[0]}, 16, 'Option period dates are set out in the applicable Task Order.', ${user.id})
    ON CONFLICT (target_table, target_id, field) DO NOTHING`;
  // …and CLIN 0002's funded_amount deliberately has NO provenance row, so it renders Unverified.

  // A WBS whose CHILD inherits its CLIN — the case the rollup's recursive CTE exists for.
  const [wbsParent] = await sql`
    INSERT INTO project_wbs_nodes
      (tenant_id, project_id, clin_id, code, title, baseline_start, baseline_end, baseline_cost,
       planned_start, planned_end, planned_cost, actual_cost, sort_index)
    VALUES (${tenant.id}, ${project.id}, ${clin1.id}, '1', 'Prototype development',
            CURRENT_DATE - 120, CURRENT_DATE + 60, 700000, CURRENT_DATE - 120, CURRENT_DATE + 74,
            700000, 402500, 1)
    RETURNING id`;
  await sql`
    INSERT INTO project_wbs_nodes
      (tenant_id, project_id, clin_id, parent_id, code, title, baseline_start, baseline_end,
       baseline_cost, planned_start, planned_end, planned_cost, actual_cost, sort_index)
    VALUES
      (${tenant.id}, ${project.id}, NULL, ${wbsParent.id}, '1.1', 'Sensor integration',
       CURRENT_DATE - 120, CURRENT_DATE - 30, 250000, CURRENT_DATE - 120, CURRENT_DATE - 16,
       250000, 262000, 2),
      (${tenant.id}, ${project.id}, NULL, ${wbsParent.id}, '1.2', 'Autonomy stack',
       CURRENT_DATE - 30, CURRENT_DATE + 60, 400000, CURRENT_DATE - 16, CURRENT_DATE + 74,
       400000, 140500, 3)`;
  await sql`
    INSERT INTO project_wbs_nodes
      (tenant_id, project_id, clin_id, code, title, planned_start, planned_end, planned_cost,
       actual_cost, sort_index)
    VALUES (${tenant.id}, ${project.id}, ${clin2.id}, '2', 'Flight test support',
            CURRENT_DATE + 246, CURRENT_DATE + 425, 400000, 0, 4)`;

  // Milestones with REAL variance — one met early, one running late, one still pending.
  const [msKickoff] = await sql`
    INSERT INTO project_milestones
      (tenant_id, project_id, clin_id, title, baseline_date, forecast_date, status, met_at, sort_index)
    VALUES (${tenant.id}, ${project.id}, ${clin1.id}, 'Kickoff and SOW agreed',
            CURRENT_DATE - 113, CURRENT_DATE - 116, 'met', now() - interval '116 days', 1)
    RETURNING id`;
  const [msCdr] = await sql`
    INSERT INTO project_milestones
      (tenant_id, project_id, clin_id, title, baseline_date, forecast_date, status, sort_index)
    VALUES (${tenant.id}, ${project.id}, ${clin1.id}, 'Critical design review',
            CURRENT_DATE - 30, CURRENT_DATE - 16, 'pending', 2)
    RETURNING id`;
  await sql`
    INSERT INTO project_milestones
      (tenant_id, project_id, clin_id, title, baseline_date, forecast_date, status, sort_index)
    VALUES (${tenant.id}, ${project.id}, ${clin1.id}, 'Prototype demonstration',
            CURRENT_DATE + 60, CURRENT_DATE + 74, 'pending', 3)`;

  // Deliverables in ALL THREE states, so "uploaded" and "accepted" are visibly different things.
  await sql`
    INSERT INTO project_deliverables
      (tenant_id, milestone_id, title, required_by, storage_key, filename, uploaded_by, uploaded_at,
       accepted_at, accepted_by, sort_index)
    VALUES
      (${tenant.id}, ${msKickoff.id}, 'Kickoff briefing', CURRENT_DATE - 113,
       'k1', 'kickoff-brief.pdf', ${user.id}, now() - interval '117 days',
       now() - interval '116 days', ${user.id}, 1),
      (${tenant.id}, ${msCdr.id}, 'CDR package', CURRENT_DATE - 30,
       'k2', 'cdr-package-v2.pdf', ${user.id}, now() - interval '20 days', NULL, NULL, 2),
      (${tenant.id}, ${msCdr.id}, 'Updated test plan', CURRENT_DATE - 30,
       NULL, NULL, NULL, NULL, NULL, NULL, 3)`;

  // ── THE MILESTONE CONSTRUCT (mig 218) ───────────────────────────────────────────────────────
  // Serial starts, a checklist per milestone, and a completion record on the one that is met. This
  // is what makes the smallest useful case visible in a screenshot: a milestone with a task list is
  // a dated ToDo list for the team, and the plan is that shape repeated in series.
  await sql`
    UPDATE project_milestones SET starts_on = CURRENT_DATE - 120 WHERE id = ${msKickoff.id}`;
  await sql`
    UPDATE project_milestones
       SET starts_on = CURRENT_DATE - 112,
           completion_note = NULL
     WHERE id = ${msCdr.id}`;
  // The met milestone carries what it measured — the reason `completion_metrics` is an open jsonb.
  await sql`
    UPDATE project_milestones
       SET completion_note = 'Kickoff held on site; SOW agreed with the CO with two wording changes.',
           completion_metrics = ${sql.json({ attendees: 9, sowRevisions: 2, daysToAgree: 4 })}
     WHERE id = ${msKickoff.id}`;

  // sort_index is the ORDER A PERSON READS, which is the order the work happens — not a function
  // of the due date. The first version derived it from the offset and the list came out backwards.
  const CHECKLIST = [
    [msKickoff.id, 'Confirm CO attendance', -118, 'done'],
    [msKickoff.id, 'Circulate draft SOW', -116, 'done'],
    [msCdr.id, 'Thermal margin analysis', -22, 'done'],
    [msCdr.id, 'CDR slide package', -18, 'open'],
    [msCdr.id, 'Vendor lead times confirmed', -12, 'blocked'],
  ];
  for (const [i, [milestoneId, title, offset, status]] of CHECKLIST.entries()) {
    await sql`
      INSERT INTO project_milestone_tasks
        (tenant_id, project_id, milestone_id, title, assignee_user_id, due_date, status,
         blocked_reason, completed_at, completed_by, sort_index)
      VALUES (${tenant.id}, ${project.id}, ${milestoneId}, ${title}, ${user.id},
              CURRENT_DATE + ${offset}::int, ${status},
              ${status === 'blocked' ? 'Supplier has not confirmed the actuator lead time.' : null},
              ${status === 'done' ? sql`now() - interval '10 days'` : null},
              ${status === 'done' ? user.id : null},
              ${i})`;
  }

  // Serial fill, the same rule `resequence` applies: a milestone with no pinned start begins the
  // day after the previous one ends. Seeded here so the screenshot shows a CHAIN — the unsequenced
  // state is covered by drive-milestone-construct.mts, not by leaving the fixture half-built.
  await sql`
    UPDATE project_milestones m
       SET starts_on = prev.forecast_date + 1
      FROM (SELECT id, forecast_date, sort_index FROM project_milestones
             WHERE project_id = ${project.id}) prev
     WHERE m.project_id = ${project.id} AND m.starts_on IS NULL
       AND prev.sort_index = m.sort_index - 1 AND prev.forecast_date IS NOT NULL`;

  await sql`UPDATE projects SET baselined_at = now() - interval '110 days' WHERE id = ${project.id}`;

  console.log(`✓ seeded "${NAME}" for tenant '${tenant.slug}'`);
  console.log('  2 CLINs (one with a deferral, one unverified) · 4 WBS nodes (one inheriting its CLIN)');
  console.log('  3 milestones (met early · running late · pending) · 3 deliverables (accepted · uploaded · nothing)');
  console.log(`  /portal/${tenant.slug}/projects/${project.id}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error('seed failed:', e?.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
