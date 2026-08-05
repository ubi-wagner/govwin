/**
 * Seed the driven-Playwright e2e FIXTURES (punch list C2) — the stateful rows the
 * persona specs hardcode, which seed_dev_accounts.mjs does NOT build:
 *   • library.tenant   — A1/A2/A3 atoms (tenant-shared / admin-private / collab-private)
 *   • lock/collab/fullloop/atomloop — provisioned proposals + sections (+ atom lineage)
 *   • matrix.tenant     — an RFP chain (solicitation + volume + 2 required items + topic)
 *   • fanout / ranking  — two independent 2-topic AF SBIR solicitations (c3 / c4)
 *   • zzaudit.tenant    — a pinned Lighthouse card under solicitation 6c8571ca
 *   • zzblockers.tenant — opp 223f57f4 (free-portal target) + a submitted/locked proposal
 *
 * Idempotent + re-runnable: upserts, resets mutated fixtures, and clears the stateful
 * artifacts (pushed solicitations, a prior free-portal, the audit-proof-co tenant) so the
 * whole suite is green on a second run. Delegates the row DDL to scripts/e2e_fixtures.sql
 * (declarative, one place) and runs it in a single transaction.
 *
 * Run AFTER scripts/seed_dev_accounts.mjs (needs the lighthouse/ubihere tenants + admins):
 *   DATABASE_URL=<db> node scripts/seed_e2e_fixtures.mjs
 */
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('[e2e-fixtures] FATAL: DATABASE_URL not set'); process.exit(1); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

async function run() {
  const [lh] = await sql`SELECT id FROM tenants WHERE slug = 'lighthouse'`;
  if (!lh) { console.error('[e2e-fixtures] lighthouse tenant missing — run scripts/seed_dev_accounts.mjs first'); process.exit(1); }

  const ddl = await readFile(path.join(__dirname, 'e2e_fixtures.sql'), 'utf8');
  // The file is a single DO $$ … $$ block (+ leading comments); run it whole.
  await sql.unsafe(ddl);

  // Report what landed (a quick sanity fingerprint).
  const [{ n: atoms }] = await sql`SELECT count(*)::int n FROM library_atoms WHERE id IN ('a1a1a1a1-0000-4000-8000-000000000001','a2a2a2a2-0000-4000-8000-000000000002','a3a3a3a3-0000-4000-8000-000000000003')`;
  const [{ n: props }] = await sql`SELECT count(*)::int n FROM proposals WHERE id IN ('d0000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','a1b2c3d4-0000-4000-8000-000000000001')`;
  const [{ n: sols }] = await sql`SELECT count(*)::int n FROM curated_solicitations WHERE id IN ('c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','6c8571ca-292f-41db-9762-c5055a06e71e')`;
  const [{ n: pinned }] = await sql`SELECT count(*)::int n FROM tenant_opportunity_cards WHERE tenant_id = ${lh.id}::uuid AND is_pinned = true`;
  console.log(`[e2e-fixtures] ✓ atoms=${atoms}/3  proposals=${props}/4  solicitations=${sols}/4  pinned lighthouse cards=${pinned}`);
  console.log('[e2e-fixtures] done — the driven persona + blocker specs are now seeded.');
}
run().then(() => sql.end()).catch(async (e) => { console.error('[e2e-fixtures] FAILED:', e.message || e); await sql.end(); process.exit(1); });
