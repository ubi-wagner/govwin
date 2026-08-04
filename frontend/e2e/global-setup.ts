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
  try {
    console.log('[e2e globalSetup] seeding e2e fixtures (scripts/seed_e2e_fixtures.mjs)…');
    execSync('node scripts/seed_e2e_fixtures.mjs', { cwd: repoRoot, stdio: 'inherit', env: process.env });
  } catch (err) {
    console.warn('[e2e globalSetup] fixture seed failed (continuing — persona specs will report the real gap):', (err as Error).message);
  }
}
