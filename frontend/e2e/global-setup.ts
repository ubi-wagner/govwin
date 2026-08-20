/**
 * E2E global setup — re-seed the driven-suite FIXTURES before every run.
 *
 * The persona specs are STATEFUL against their fixtures: fanout/ranking push a
 * solicitation (flips it out of 'approved'), matrix provisions a proposal, lock/
 * fullloop/atomloop mutate their sections, and the zzaudit/zzblockers drives create a
 * company / approve a free portal. scripts/e2e_fixtures.sql is written to RESET all of
 * that, so it must run before each suite run or a second run fails on leftover state.
 * Wiring it here (globalSetup) makes the gate reproducible — run it twice, same green.
 *
 * Non-fatal by design: needs DATABASE_URL (+ scripts/seed_dev_accounts.mjs already run
 * for the tenants/personas). If DATABASE_URL is unset (fixtures seeded externally) or the
 * seed can't run (e.g. a hitl-only run on a DB without Lighthouse), we WARN and continue —
 * the persona specs then fail meaningfully rather than the whole run aborting in setup.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    console.warn('[e2e globalSetup] DATABASE_URL unset — skipping fixture seed (assuming fixtures are seeded externally).');
    return;
  }
  const repoRoot = path.join(__dirname, '..', '..'); // frontend/e2e → repo root

  // The seeds WRITE tenant-scoped, RLS-forced tables (library_atoms among them) and hold no
  // per-request tenant context, so under the app role every insert is refused:
  //   [e2e-fixtures] FAILED: new row violates row-level security policy for table "library_atoms"
  // That failure used to be swallowed, so the suite proceeded with no fixtures and the persona
  // specs failed for reasons that had nothing to do with the product. Seeding is a bootstrap
  // job — it runs as the OWNER when one is available, exactly like migrations and the pipeline
  // worker (docs/RLS_CUTOVER.md). DATABASE_URL is left alone for everything else, so specs that
  // deliberately probe RLS as the app role still get the app role.
  const seedEnv = { ...process.env };
  if (process.env.DATABASE_URL_OWNER) seedEnv.DATABASE_URL = process.env.DATABASE_URL_OWNER;

  // ORDER MATTERS, and each step owns a different cohort. Running only the third — which is all
  // this did until now — left the other two cohorts to whatever a long-lived box happened to have
  // lying around, and on a machine built from the repo they were simply absent: the five
  // hitl-deep-sweep specs failed on "Invalid email or password", and hitl-full-draft failed on a
  // proposal that did not exist. Neither had a product defect behind it. A suite whose fixtures
  // only exist on one hand-prepared machine cannot tell you anything about a clean deploy.
  const SEEDS: Array<[string, string]> = [
    ['dev accounts + lighthouse + the cold-start tenant', 'node scripts/seed_dev_accounts.mjs'],
    ['E2E HITL cohort (5 roles @ acme-navy-systems + the scenario proposal)', 'node scripts/seed-e2e-hitl.mjs'],
    // Foundation is the rich build scenario: Kate/Conor/Connor/Will + Paul Jackson the
    // partner-manager, the 5 buckets, and the ranked card pipeline. Every hitl-foundation-*,
    // hitl-cc-partner and the deep sweep's tenant_admin leg sign in as one of these.
    ['Foundation cohort (founders + Paul + buckets + ranked cards)', 'node scripts/seed-foundation.mjs'],
    ['driven-suite fixtures (proposals, sections, atoms, cards)', 'node scripts/seed_e2e_fixtures.mjs'],
  ];
  for (const [label, cmd] of SEEDS) {
    try {
      console.log(`[e2e globalSetup] seeding ${label}…`);
      execSync(cmd, { cwd: repoRoot, stdio: 'inherit', env: seedEnv });
    } catch (err) {
      // Still non-fatal: a partial box should fail in the specs that need the missing piece, not
      // abort every spec in setup. But it is now LOUD about which cohort is missing.
      console.warn(`[e2e globalSetup] SEED FAILED (${label}) — specs needing it will fail:`, (err as Error).message);
    }
  }
}
