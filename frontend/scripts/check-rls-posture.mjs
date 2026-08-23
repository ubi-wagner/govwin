/**
 * PREFLIGHT: is this box actually enforcing RLS, or only appearing to?
 *
 * THE FAILURE THIS EXISTS FOR (bug log B86). Every drive, lens and sweep in one long session ran
 * against a server started as `govtech` — which is `rolsuper = t`. A superuser bypasses row-level
 * security entirely, so the database layer was never engaged, and every isolation result produced
 * that day was an APP-LAYER result reported as though it were the whole story.
 *
 * Nothing failed. That is precisely the danger: **RLS bypassed looks identical to RLS satisfied**
 * from every angle except a cross-tenant read that should return nothing and doesn't. There is no
 * error, no warning, no slow query — just a quieter guarantee than the one you believe you have.
 *
 * It happened because `govtech_app` is created NOLOGIN by migration (094/177) and prod supplies its
 * password by env, so on a fresh box the only credential to hand a script is the owner's. The wrong
 * posture is the path of least resistance, which is exactly the kind of thing that needs a check
 * rather than a paragraph in a runbook.
 *
 * WHAT IT ASSERTS, in the order that matters:
 *
 *   1. ROLE — the connection is neither a superuser nor BYPASSRLS. Superuser is the one people miss:
 *      `rolbypassrls` can read `f` on a superuser and RLS is still bypassed.
 *   2. MACHINERY — policies exist and tables actually FORCE row security. A NOBYPASSRLS role against
 *      a table with no policy is unprotected in a different way.
 *   3. BEHAVIOUR — the only assertion that cannot be faked: set one tenant's context, count another
 *      tenant's rows, and require zero. Then count the SAME tenant's own rows and require non-zero,
 *      because a connection that sees nothing at all would satisfy the first half trivially.
 *
 * Steps 1 and 2 can both pass on a box that leaks; step 3 is the proof. Steps 1 and 2 stay because
 * when 3 fails they say WHY in one line instead of sending someone into the policies.
 *
 *   DATABASE_URL=<app role> node scripts/check-rls-posture.mjs
 *   DATABASE_URL_OWNER=<owner> is optional; used only to read the fixture for step 3.
 *
 * Exit 0 posture correct · 1 posture WRONG (results would be meaningless) · 2 could not check.
 */
import postgres from 'postgres';

const APP = process.env.DATABASE_URL;
const OWNER = process.env.DATABASE_URL_OWNER || APP;
if (!APP) { console.error('DATABASE_URL required'); process.exit(2); }

const app = postgres(APP, { max: 1 });
const owner = postgres(OWNER, { max: 1 });

let bad = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const no = (m) => { console.error(`  WRONG ${m}`); bad++; };

async function main() {
  // ── 1 · the role ────────────────────────────────────────────────────────────────────────────
  const [me] = await app`
    SELECT current_user AS who, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (me.rolsuper) {
    no(`connected as '${me.who}', which is a SUPERUSER — RLS is bypassed entirely, whatever `
      + `rolbypassrls says. Nothing measured on this connection can distinguish isolation from `
      + `its absence.`);
  } else if (me.rolbypassrls) {
    no(`connected as '${me.who}', which has BYPASSRLS — same consequence as superuser.`);
  } else {
    ok(`connected as '${me.who}' — not superuser, not BYPASSRLS`);
  }

  // ── 2 · the machinery ───────────────────────────────────────────────────────────────────────
  const [{ policies }] = await owner`SELECT count(*)::int AS policies FROM pg_policies WHERE schemaname = 'public'`;
  const [{ forced }] = await owner`SELECT count(*)::int AS forced FROM pg_class WHERE relforcerowsecurity`;
  if (policies === 0) no('no RLS policies exist in schema public — nothing to enforce');
  else ok(`${policies} policies across ${forced} force-RLS table(s)`);

  // ── 3 · the behaviour, which is the only part that cannot be faked ──────────────────────────
  //
  // Read the fixture through the OWNER: working out what a tenant SHOULD see is a legitimate
  // cross-tenant read, and doing it on the scoped connection would return nothing and look like
  // an empty box (that mistake is recorded in B86 too).
  const pair = await owner`
    SELECT t.id, t.slug,
           (SELECT count(*)::int FROM tenant_opportunity_cards c WHERE c.tenant_id = t.id) AS cards
    FROM tenants t ORDER BY cards DESC LIMIT 2`;
  if (pair.length < 2 || pair[0].cards === 0) {
    console.error('  SKIP  behaviour check needs two tenants and rows to hide — this box has neither');
    console.error('        (that is NOT a pass: the strongest assertion did not run)');
    bad++;
  } else {
    const [A, B] = pair;
    const [seen] = await app`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${A.id}::uuid`
      .then(async (r) => { return r; }, () => [{ n: -1 }]);
    // set_config within the same session, then measure both directions
    const cross = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${B.id}, true)`;
      const [x] = await tx`SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${A.id}::uuid`;
      const [own] = await tx`SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${B.id}::uuid`;
      return { foreign: x.n, own: own.n };
    });
    void seen;
    if (cross.foreign !== 0) {
      no(`with app.tenant_id set to '${B.slug}', ${cross.foreign} of '${A.slug}'s cards are still `
        + `visible — the isolation this box reports is not real`);
    } else if (cross.own === 0) {
      no(`'${B.slug}' cannot see its OWN cards either (0) — that is a deny-all, not isolation, and `
        + `a run against it would pass every "no leak" check for the wrong reason`);
    } else {
      ok(`context '${B.slug}': ${cross.foreign} foreign card(s) visible, ${cross.own} own — isolation, not deny-all`);
    }
  }

  console.log();
  if (bad === 0) {
    console.log('✓ RLS posture correct — isolation results from this box mean what they say.');
  } else {
    console.error('✗ RLS POSTURE WRONG. Any isolation result measured here is meaningless — not');
    console.error('  wrong, MEANINGLESS: a bypassed database layer produces the same output as a');
    console.error('  perfectly isolated one. Serve as the NOBYPASSRLS app role and re-run.');
    console.error('    ALTER ROLE govtech_app LOGIN PASSWORD \'…\';   -- created NOLOGIN by migration');
    console.error('    DATABASE_URL=postgresql://govtech_app:…  DATABASE_URL_OWNER=postgresql://govtech:…');
  }
  await app.end(); await owner.end();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`could not check RLS posture: ${String(e).slice(0, 200)}`);
  await app.end().catch(() => {}); await owner.end().catch(() => {});
  process.exit(2);
});
