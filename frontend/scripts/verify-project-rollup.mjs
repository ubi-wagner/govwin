/**
 * Do the three measures compute what a person would compute by hand?
 *
 * The rollup is SQL — a recursive CTE resolving each WBS node's effective CLIN, a duration-weighted
 * schedule sum, and a second query for deliverables. A mock cannot test any of that, and every one
 * of its failure modes produces a plausible number rather than an error:
 *
 *   · aggregating on the raw `clin_id` instead of the resolved one silently DROPS every child node
 *     from its CLIN's cost — and the total still looks reasonable
 *   · joining deliverables into the same statement as the WBS multiplies each cost row by the
 *     number of deliverables beneath it — the total is wrong by an integer factor
 *   · an unweighted schedule average calls a two-day task and a two-hundred-day task equal
 *
 * So this seeds a fixture with numbers chosen to make each of those visible, and asserts against
 * values computed by hand in the comments — never against what the code happens to return.
 *
 * ⚠️ NOT READ-ONLY. Writes a fixture project and removes it; the footprint is printed. Sandbox only.
 *
 *   source scripts/sandbox-env.sh && npx tsx frontend/scripts/verify-project-rollup.mjs
 *
 * Exit 0 the arithmetic holds · 1 a measure is wrong · 2 could not run.
 */
import postgres from 'postgres';

const OWNER = process.env.DATABASE_URL_OWNER;
if (!OWNER) {
  console.error('DATABASE_URL_OWNER required — source scripts/sandbox-env.sh');
  process.exit(2);
}
const owner = postgres(OWNER, { max: 2, onnotice: () => {} });

let bad = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const no = (m) => { console.error(`  WRONG ${m}`); bad++; };
let projectId = null;

/** Assert a measure, naming the hand-computed expectation in the failure. */
function expect(label, actual, expected) {
  if (actual === expected) return ok(`${label} = ${actual === null ? 'null (not measured)' : actual}`);
  no(`${label} is ${actual === null ? 'null' : actual}, expected ${expected === null ? 'null' : expected}`);
}

async function main() {
  const { rollup } = await import('../lib/projects/rollup.ts');
  const { enterTenant } = await import('../lib/tenant-context.ts');

  const [tenant] = await owner`SELECT id, slug FROM tenants ORDER BY created_at LIMIT 1`;
  if (!tenant) { console.error('  CANT-RUN no tenants on this box'); process.exit(1); }

  const [p] = await owner`
    INSERT INTO projects (tenant_id, name) VALUES (${tenant.id}, ${`rollup-probe-${process.pid}`})
    RETURNING id`;
  projectId = p.id;

  const [clinA] = await owner`
    INSERT INTO project_clins (tenant_id, project_id, clin_number, title, sort_index)
    VALUES (${tenant.id}, ${projectId}, '0001', 'Design', 1) RETURNING id`;
  const [clinB] = await owner`
    INSERT INTO project_clins (tenant_id, project_id, clin_number, title, sort_index)
    VALUES (${tenant.id}, ${projectId}, '0002', 'Build', 2) RETURNING id`;

  // ── The fixture, chosen so each failure mode shows up as a DIFFERENT wrong number ──────────
  //
  // CLIN 0001 — a parent carrying the CLIN, and a CHILD that does not. If the CTE is wrong and the
  // child is dropped, cost reads 25% instead of 40%: both plausible, only one right.
  //
  //   parent  planned 1000  actual  400
  //   child   planned 1000  actual  400      (clin_id NULL — inherits)
  //   ⇒ planned 2000, actual 800  ⇒ cost 40.0%
  const [parentA] = await owner`
    INSERT INTO project_wbs_nodes
      (tenant_id, project_id, clin_id, code, title, planned_cost, actual_cost,
       planned_start, planned_end, sort_index)
    VALUES (${tenant.id}, ${projectId}, ${clinA.id}, '1', 'Design', 1000, 400,
            CURRENT_DATE - 9, CURRENT_DATE, 1)
    RETURNING id`;
  await owner`
    INSERT INTO project_wbs_nodes
      (tenant_id, project_id, clin_id, parent_id, code, title, planned_cost, actual_cost,
       planned_start, planned_end, sort_index)
    VALUES (${tenant.id}, ${projectId}, NULL, ${parentA.id}, '1.1', 'Wireframes', 1000, 400,
            CURRENT_DATE - 9, CURRENT_DATE, 2)`;

  // CLIN 0002 — planned but not started, and a LONG task next to a SHORT one so an unweighted
  // schedule average is distinguishable from a duration-weighted one.
  //
  //   short   2 days, fully elapsed        → 2 of 2
  //   long  200 days, starts tomorrow      → 0 of 200
  //   unweighted average would be 50%; duration-weighted is 2/202 = 1.0%
  await owner`
    INSERT INTO project_wbs_nodes
      (tenant_id, project_id, clin_id, code, title, planned_cost, actual_cost,
       planned_start, planned_end, sort_index)
    VALUES (${tenant.id}, ${projectId}, ${clinB.id}, '2.1', 'Spike', 500, 0,
            CURRENT_DATE - 1, CURRENT_DATE, 3)`;
  await owner`
    INSERT INTO project_wbs_nodes
      (tenant_id, project_id, clin_id, code, title, planned_cost, actual_cost,
       planned_start, planned_end, sort_index)
    VALUES (${tenant.id}, ${projectId}, ${clinB.id}, '2.2', 'Build out', 500, 0,
            CURRENT_DATE + 1, CURRENT_DATE + 200, 4)`;

  // Deliverables on CLIN 0001: THREE under one milestone, one accepted.
  // If the WBS and deliverables were joined in one statement, CLIN 0001's planned cost would be
  // multiplied by 3 → 6000, and cost% would read 13.3% instead of 40%.
  const [ms] = await owner`
    INSERT INTO project_milestones (tenant_id, project_id, clin_id, title, sort_index)
    VALUES (${tenant.id}, ${projectId}, ${clinA.id}, 'Design review', 1) RETURNING id`;
  for (const [title, accepted] of [['Wireframe pack', true], ['Style guide', false], ['Spec', false]]) {
    await owner`
      INSERT INTO project_deliverables
        (tenant_id, milestone_id, title, storage_key, filename, accepted_at)
      VALUES (${tenant.id}, ${ms.id}, ${title}, 'k', 'f.pdf',
              ${accepted ? owner`now()` : null})`;
  }

  // ── measure ────────────────────────────────────────────────────────────────────────────────
  //
  // ENTER THE TENANT CONTEXT FIRST, exactly as `projectGate` does on a real request. Without it
  // `sql` runs on the app pool with `app.tenant_id` unset, RLS matches nothing, and every query
  // returns ZERO ROWS — with no error. The first run of this script reported all four measures as
  // `null` and read like a broken rollup; the rollup was fine and the harness had no context.
  //
  // That silent-empty is the whole reason `verify-project-isolation.mjs` asserts own-rows-visible
  // BEFORE foreign-rows-invisible: a deny-all satisfies every "no leak" check trivially, and here
  // it satisfied every arithmetic check with a null.
  enterTenant(tenant.id);
  const r = await rollup(tenant.id, projectId);
  const byClin = Object.fromEntries(r.clins.map((c) => [c.clinNumber, c]));

  console.log(`  fixture: tenant '${tenant.slug}', 4 WBS nodes, 2 CLINs, 3 deliverables`);

  // CLIN 0001 — the effective-CLIN test.
  const a = byClin['0001'];
  if (!a) no('CLIN 0001 is missing from the rollup');
  else {
    expect("0001 cost% (child inherits the CLIN: 800/2000)", a.costPct, 40);
    if (a.plannedCost !== null && Number(a.plannedCost) !== 2000) {
      no(`0001 planned cost is ${a.plannedCost}, expected 2000 — a value of 6000 means the `
        + 'deliverables join multiplied the WBS rows');
    } else ok('0001 planned cost is 2000 — no cartesian product with deliverables');
    expect('0001 deliverables% (1 of 3 accepted)', a.deliverablesPct, 33.3);
  }

  // CLIN 0002 — the duration-weighting test.
  const b = byClin['0002'];
  if (!b) no('CLIN 0002 is missing from the rollup');
  else {
    expect('0002 schedule% (duration-weighted 2/202, NOT the 50% an unweighted average gives)',
      b.schedulePct, 1);
    expect('0002 cost% (nothing spent yet — a measured zero)', b.costPct, 0);
    expect('0002 deliverables% (none exist — NOT MEASURED, not zero)', b.deliverablesPct, null);
  }

  // The project total, computed from rows rather than by averaging the CLIN percentages.
  //   planned 1000+1000+500+500 = 3000 · actual 800 ⇒ 26.7%
  //   averaging the two CLIN cost percentages would give (40 + 0) / 2 = 20%
  expect('project cost% from ROWS (800/3000), not the average of CLIN percentages (20%)',
    r.project.costPct, 26.7);
  expect('project deliverables% (1 of 3)', r.project.deliverablesPct, 33.3);

  // The contract that makes all of this readable.
  if ('percentComplete' in r.project || 'overallPct' in r.project) {
    no('the rollup exposes a blended percentage — three measures side by side is the whole point');
  } else ok('no blended percentage is exposed');
}

async function cleanup() {
  if (projectId) {
    try { await owner`DELETE FROM projects WHERE id = ${projectId}`; }
    catch (err) { console.error('  cleanup failed:', err?.message ?? err); }
    console.log(`\n  MUTATED 1 projects row and its cascade — fixture-only, now removed.`);
  }
  await owner.end();
}

main()
  .then(async () => {
    await cleanup();
    console.log();
    if (bad === 0) console.log('✓ The three measures compute what a person would compute by hand.');
    else console.error(`✗ ${bad} measure(s) do not.`);
    process.exit(bad === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(`could not run: ${String(err?.message ?? err)}`);
    await cleanup().catch(() => {});
    process.exit(2);
  });
