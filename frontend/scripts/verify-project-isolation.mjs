/**
 * Does the project spine isolate, and does the baseline actually refuse to move?
 *
 * Migration 216 makes claims that fail SILENTLY when wrong. A missing policy returns rows instead
 * of an error. A baseline that can be rewritten still adds up — the variance is simply against a
 * number that has quietly changed, and nothing in the product can tell you it did.
 *
 * ── WHY A SCRIPT AND NOT A VITEST FILE ───────────────────────────────────────────────────────
 * `vitest.config.ts` hands every test a dummy `DATABASE_URL` so unit tests survive CI without a
 * database. A test asserting RLS or a trigger under that dummy would connect to nothing, skip, and
 * report green — the exact shape of an unearned pass. Behaviour against a live cluster belongs with
 * the other `verify-*` lenses. The APP-layer half of D1 (the assignment predicate, which RLS cannot
 * express) is a vitest file: `__tests__/projects-assignment-boundary.test.ts`.
 *
 * ── THE INSTRUMENT BEFORE THE FINDING ────────────────────────────────────────────────────────
 * Step 0 asserts the connection is not a superuser and not BYPASSRLS. On a superuser every
 * isolation assertion below passes for the wrong reason — RLS is bypassed, so a database with no
 * policies at all measures identically to a correct one.
 *
 * ⚠️ NOT READ-ONLY. It writes fixture rows through the OWNER connection and removes them; the
 * footprint is printed every run. Sandbox only.
 *
 *   source scripts/sandbox-env.sh && node frontend/scripts/verify-project-isolation.mjs
 *
 * Exit 0 correct · 1 a claim does not hold · 2 could not measure.
 */
import postgres from 'postgres';

const APP = process.env.DATABASE_URL;
const OWNER = process.env.DATABASE_URL_OWNER;
if (!APP || !OWNER) {
  console.error('DATABASE_URL (app role) and DATABASE_URL_OWNER (owner) are both required.');
  console.error('  source scripts/sandbox-env.sh');
  process.exit(2);
}

const app = postgres(APP, { max: 1, onnotice: () => {} });
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });

const TABLES = [
  'projects',
  'project_source_documents',
  'project_clins',
  'project_wbs_nodes',
  'project_milestones',
  'project_deliverables',
  'project_provenance',
  'project_assignments',
];

let bad = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const no = (m) => { console.error(`  WRONG ${m}`); bad++; };

const created = { projects: [] };

/** Returns the SQLSTATE a statement raised, or null when it succeeded. */
async function refusedWith(fn) {
  try { await fn(); return null; } catch (e) { return e.code ?? 'THREW'; }
}

async function main() {
  // ── 0 · the instrument ──────────────────────────────────────────────────────────────────────
  const [me] = await app`
    SELECT current_user AS who, r.rolsuper AS super, r.rolbypassrls AS bypass
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (me.super || me.bypass) {
    console.error(`  ABORT connected as '${me.who}', which ${me.super ? 'is a SUPERUSER' : 'has BYPASSRLS'}.`);
    console.error('        RLS is bypassed on this connection, so every clean result below would be');
    console.error('        unearned. Serve as the NOBYPASSRLS app role and re-run.');
    await app.end(); await owner.end();
    process.exit(2);
  }
  ok(`connected as '${me.who}' — not superuser, not BYPASSRLS`);

  // ── 1 · structure, which holds on an empty box ──────────────────────────────────────────────
  //
  // This assertion needs no fixture data, which is exactly when a missing policy is easiest to
  // introduce and hardest to see (mig 212's whole class was invisible for months).
  let missing = 0;
  for (const t of TABLES) {
    const [row] = await owner`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = ${t}) AS policies,
             -- ALIASED to a quoted camelCase name. (No backticks in this comment: it lives inside
             -- a JS tagged template, where one would end the literal.) This client is a bare
             -- postgres() with no toCamel column transform, unlike lib/db.ts, so an unquoted
             -- AS tenant_col reads back as row.tenant_col and row.tenantCol is undefined — which
             -- this check reported as "no NOT NULL tenant_id column" against eight tables that all
             -- had one. Second occurrence this session. Rule: in a bare-client script, every alias
             -- is quoted camelCase.
             (SELECT count(*)::int FROM information_schema.columns col
               WHERE col.table_schema = 'public' AND col.table_name = ${t}
                 AND col.column_name = 'tenant_id' AND col.is_nullable = 'NO') AS "tenantCol"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${t}`;
    if (!row) { no(`${t} does not exist — migration 216 has not been applied here`); missing++; continue; }
    if (!row.rls || !row.forced) no(`${t}: rls ${row.rls ? 'on' : 'OFF'}, force ${row.forced ? 'on' : 'OFF'}`);
    else if (row.policies !== 1) no(`${t}: ${row.policies} policies, expected exactly 1 (tenant_isolation)`);
    // Tenancy by COLUMN, not by FK lineage. A tenant_id-shaped audit cannot see a lineage-shaped
    // table, which is how seven proposal-spine tables leaked unnoticed until mig 212.
    else if (row.tenantCol !== 1) no(`${t}: no NOT NULL tenant_id column — tenancy by lineage is invisible to every audit here`);
  }
  if (missing) { await finish(); return; }
  if (bad === 0) ok(`all ${TABLES.length} tables: force-RLS, one tenant_isolation policy, NOT NULL tenant_id`);

  // ── 2 · the reserved-word regression ────────────────────────────────────────────────────────
  //
  // The design specified `current_date`, which is a reserved keyword and a syntax error unquoted.
  // If someone "restores" it later the table still creates (quoted) and every hand-written query
  // then breaks in a way that reads like a typo.
  const [{ n: reserved }] = await owner`
    SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY(${TABLES}) AND column_name = 'current_date'`;
  if (reserved) no('a project table has a column literally named `current_date` — a reserved keyword');
  else ok('no project column is named with a reserved keyword');

  // ── 3 · fixture ─────────────────────────────────────────────────────────────────────────────
  //
  // Two tenants by created_at, not by slug: a resolver must select for what its consumer needs,
  // and `ORDER BY slug` picks whatever a fixture happened to name (B147).
  const tenants = await owner`SELECT id, slug FROM tenants ORDER BY created_at LIMIT 2`;
  if (tenants.length < 2) {
    console.error(`  CANT-RUN needs two tenants; this box has ${tenants.length}. The posture here is`);
    console.error('        UNMEASURED, not correct — one tenant cannot demonstrate isolation.');
    bad++; await finish(); return;
  }
  const [A, B] = tenants;
  const stamp = process.pid;

  const [pA] = await owner`
    INSERT INTO projects (tenant_id, name) VALUES (${A.id}, ${`probe-A-${stamp}`}) RETURNING id`;
  const [pB] = await owner`
    INSERT INTO projects (tenant_id, name) VALUES (${B.id}, ${`probe-B-${stamp}`}) RETURNING id`;
  created.projects.push(pA.id, pB.id);

  await owner`
    INSERT INTO project_wbs_nodes (tenant_id, project_id, code, title, planned_cost)
    VALUES (${A.id}, ${pA.id}, '1.1', 'Probe task', 1000)`;
  await owner`
    INSERT INTO project_milestones (tenant_id, project_id, title) VALUES (${A.id}, ${pA.id}, 'Probe milestone')`;

  // ── 4 · behaviour, the part that cannot be faked ─────────────────────────────────────────────
  const seen = await app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${B.id}, true)`;
    const [own] = await tx`SELECT count(*)::int AS n FROM projects WHERE id = ${pB.id}`;
    const [foreign] = await tx`SELECT count(*)::int AS n FROM projects WHERE id = ${pA.id}`;
    const [foreignWbs] = await tx`SELECT count(*)::int AS n FROM project_wbs_nodes WHERE project_id = ${pA.id}`;
    return { own: own.n, foreign: foreign.n, foreignWbs: foreignWbs.n };
  });

  // Own rows FIRST: a connection that sees nothing at all satisfies every "no leak" assertion
  // trivially, and reporting that as isolation is B86.
  if (seen.own !== 1) no(`tenant '${B.slug}' cannot see its OWN project (${seen.own}) — a deny-all, not isolation`);
  else ok(`tenant '${B.slug}' sees its own project`);
  if (seen.foreign !== 0) no(`tenant '${B.slug}' can see '${A.slug}'s project`);
  else ok(`tenant '${B.slug}' sees 0 of '${A.slug}'s projects`);
  if (seen.foreignWbs !== 0) no(`tenant '${B.slug}' can read ${seen.foreignWbs} of '${A.slug}'s WBS node(s)`);
  else ok(`tenant '${B.slug}' sees 0 of '${A.slug}'s WBS nodes`);

  // A write into another tenant's project must be refused by WITH CHECK, not merely invisible.
  const writeCode = await refusedWith(() => app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${B.id}, true)`;
    await tx`INSERT INTO project_wbs_nodes (tenant_id, project_id, code, title)
             VALUES (${A.id}, ${pA.id}, '9.9', 'injected')`;
  }));
  if (writeCode !== '42501') {
    no(`a cross-tenant INSERT ${writeCode === null ? 'SUCCEEDED' : `raised ${writeCode}`} — expected 42501`);
    if (writeCode === null) await owner`DELETE FROM project_wbs_nodes WHERE code = '9.9' AND project_id = ${pA.id}`;
  } else ok('a cross-tenant INSERT is refused (42501)');

  // ── 5 · the baseline refuses to move ────────────────────────────────────────────────────────
  //
  // Three distinct facts, and only the third is the headline. Setting once must WORK, or the
  // trigger is a deny-all wearing an immutability badge; rewriting the same value must work, or an
  // idempotent whole-row UPDATE fails for touching a column it did not change.
  const [node] = await owner`SELECT id FROM project_wbs_nodes WHERE project_id = ${pA.id} LIMIT 1`;

  const setCode = await refusedWith(() => owner`
    UPDATE project_wbs_nodes SET baseline_start = '2026-01-01', baseline_cost = 1000 WHERE id = ${node.id}`);
  if (setCode !== null) no(`setting a baseline for the first time was refused (${setCode}) — the trigger is a deny-all`);
  else ok('a baseline can be set once');

  const rewriteSameCode = await refusedWith(() => owner`
    UPDATE project_wbs_nodes SET baseline_start = '2026-01-01', title = 'Probe task renamed' WHERE id = ${node.id}`);
  if (rewriteSameCode !== null) no(`rewriting a baseline with the SAME value was refused (${rewriteSameCode}) — an idempotent row update would fail`);
  else ok('rewriting a baseline with the same value is allowed (idempotent updates still work)');

  const moveCode = await refusedWith(() => owner`
    UPDATE project_wbs_nodes SET baseline_start = '2026-06-01' WHERE id = ${node.id}`);
  if (moveCode !== '23001') {
    no(`MOVING a set baseline ${moveCode === null ? 'SUCCEEDED' : `raised ${moveCode}`} — expected 23001 `
      + '(restrict_violation). Variance only means something if you still hold what you promised.');
  } else ok('moving a set baseline is refused (23001 restrict_violation)');

  const clearCode = await refusedWith(() => owner`
    UPDATE project_wbs_nodes SET baseline_cost = NULL WHERE id = ${node.id}`);
  if (clearCode !== '23001') no(`CLEARING a set baseline ${clearCode === null ? 'SUCCEEDED' : `raised ${clearCode}`} — expected 23001`);
  else ok('clearing a set baseline is refused (23001)');

  // The current plan must stay freely editable — an immutability rule that froze the live plan
  // would make the whole capability read-only and would pass every assertion above.
  const planCode = await refusedWith(() => owner`
    UPDATE project_wbs_nodes SET planned_start = '2026-07-01', planned_cost = 2500, actual_cost = 400
     WHERE id = ${node.id}`);
  if (planCode !== null) no(`editing the CURRENT plan was refused (${planCode}) — the trigger is too wide`);
  else ok('the current plan stays freely editable');

  // ── 6 · a milestone's baseline date, same rule, different table ──────────────────────────────
  const [ms] = await owner`SELECT id FROM project_milestones WHERE project_id = ${pA.id} LIMIT 1`;
  await owner`UPDATE project_milestones SET baseline_date = '2026-03-01', forecast_date = '2026-03-01' WHERE id = ${ms.id}`;
  const msMove = await refusedWith(() => owner`UPDATE project_milestones SET baseline_date = '2026-04-01' WHERE id = ${ms.id}`);
  const msForecast = await refusedWith(() => owner`UPDATE project_milestones SET forecast_date = '2026-04-15' WHERE id = ${ms.id}`);
  if (msMove !== '23001') no(`a milestone baseline_date could be moved (${msMove ?? 'succeeded'})`);
  else if (msForecast !== null) no(`a milestone forecast_date could NOT be moved (${msForecast}) — variance would be unrecordable`);
  else ok('milestone: baseline_date frozen, forecast_date free — variance is recordable');

  await finish();
}

async function finish() {
  if (created.projects.length) {
    // Everything else cascades from the project.
    try { await owner`DELETE FROM projects WHERE id IN ${owner(created.projects)}`; }
    catch (err) { console.error('  cleanup failed:', err?.message ?? err); }
    console.log();
    console.log(`  MUTATED ${created.projects.length} projects row(s) and their cascade — `
      + 'fixture-only, now removed.');
  }
  console.log();
  if (bad === 0) console.log('✓ Project isolation holds, and the baseline refuses to move.');
  else console.error(`✗ ${bad} claim(s) in migration 216 do not hold on this database.`);
  await app.end(); await owner.end();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`could not measure: ${String(e?.message ?? e).slice(0, 300)}`);
  await owner.end().catch(() => {}); await app.end().catch(() => {});
  process.exit(2);
});
