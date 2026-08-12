/**
 * RLS cutover deploy-readiness preflight — is the schema safe to flip the app onto the NOBYPASSRLS
 * `govtech_app` role? Codifies the manual head-173 audit into one repeatable gate (docs/RLS_CUTOVER.md).
 * FAILS (exit 1) if any tenant-scoped table lacks a tenant_isolation backstop and isn't on the
 * documented BYPASS allowlist, or if govtech_app is missing / can bypass RLS / lacks table grants.
 *   DATABASE_URL=<owner conn> node scripts/rls-preflight.mjs
 */
import postgres from 'postgres';

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('[rls-preflight] FATAL: DATABASE_URL not set'); process.exit(1); }
const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

// Read cross-tenant BY DESIGN (auth / identity / shared logs / pipeline fan-out) — RLS off is correct.
// Mirror of the classification in docs/RLS_CUTOVER.md §"BYPASS — leave RLS off".
const BYPASS_ALLOWLIST = new Set([
  'users', 'user_memberships', 'invitations', 'system_events', 'audit_log',
  'tenant_bridge_cursor', 'tool_invocation_metrics',
]);

async function main() {
  const problems = [];
  const note = (m) => problems.push(m);

  // 1) The app role must exist and be NOBYPASSRLS (else RLS is inert even after the flip).
  const [role] = await sql`SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'govtech_app'`;
  if (!role) note('govtech_app role is MISSING (mig 136 not applied?)');
  else if (role.rolbypassrls) note('govtech_app has BYPASSRLS — RLS would be inert; it must be NOBYPASSRLS');

  // 2) Every tenant-scoped table (has a tenant_id column) must either carry a tenant_isolation policy
  //    or be on the documented BYPASS allowlist. An unprotected, unlisted one is a leak with no backstop.
  const tenantTables = await sql`
    SELECT c.relname,
           c.relrowsecurity AS rls_on,
           (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS iso
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY c.relname`;
  let protectedCount = 0, bypassCount = 0;
  for (const t of tenantTables) {
    if (t.iso > 0 && t.rls_on) { protectedCount++; continue; }
    if (BYPASS_ALLOWLIST.has(t.relname)) { bypassCount++; continue; }
    note(`tenant-scoped table "${t.relname}" has NO tenant_isolation policy and is not on the BYPASS allowlist`);
  }

  // 2b) COVERAGE BOUNDARY — proposal-scoped CHILD tables (FK to proposals via `proposal_id`, no direct
  //     `tenant_id` column) with RLS NOT active are invisible to the tenant_id scan above AND carry no
  //     schema backstop: they inherit tenant scope only through the app-layer proposal→tenant bind each
  //     route runs (verifyProposalAccess / a `proposals WHERE tenant_id` belt before the child read).
  //     Enumerate them so the success line doesn't imply full schema coverage. (Excluded here: children
  //     that DO carry an active proposal-correlated RLS policy — e.g. proposal_sections, mig 117 —
  //     `relrowsecurity = false` filters those out because they ARE schema-backstopped.)
  const fkScoped = await sql`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute pa ON pa.attrelid = c.oid AND pa.attname = 'proposal_id' AND pa.attnum > 0 AND NOT pa.attisdropped
    WHERE c.relkind = 'r' AND n.nspname = 'public'
      AND c.relrowsecurity = false
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute ta
        WHERE ta.attrelid = c.oid AND ta.attname = 'tenant_id' AND ta.attnum > 0 AND NOT ta.attisdropped)
    ORDER BY c.relname`;

  // 3) govtech_app must be able to touch every base table (else the flip 500s on permission denied).
  if (role) {
    const [{ missing }] = await sql`
      SELECT count(*)::int AS missing
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.role_table_grants g
          WHERE g.grantee = 'govtech_app' AND g.table_name = t.table_name AND g.privilege_type = 'SELECT')`;
    if (missing > 0) note(`${missing} base table(s) have NO govtech_app SELECT grant`);
  }

  console.log(`[rls-preflight] direct-tenant_id tables: ${protectedCount} isolated · ${bypassCount} bypass-by-design · ${problems.length} problem(s)`);
  console.log(`[rls-preflight] proposal-FK-scoped child tables with NO schema backstop (app-layer proposal→tenant bind only): ${fkScoped.length}`);
  if (fkScoped.length) console.log(`    ${fkScoped.map((t) => t.relname).join(', ')}`);
  if (problems.length) {
    for (const p of problems) console.log(`  ❌ ${p}`);
    console.log('\n❌ NOT READY to flip DATABASE_URL → govtech_app — close the gaps above first.');
    process.exit(1);
  }
  console.log('\n✅ RLS CUTOVER DEPLOY-READY — every table with a direct tenant_id column is isolated or');
  console.log(`   bypass-by-design; govtech_app is NOBYPASSRLS + granted. NOTE: the ${fkScoped.length} proposal-FK-scoped`);
  console.log('   child table(s) above are guarded by the app-layer proposal→tenant bind, not a schema policy');
  console.log('   (docs/RLS_CUTOVER.md) — verify that bind holds in any new route that reads them.');
}
main().then(() => sql.end()).catch(async (e) => { console.error('[rls-preflight] FAILED:', e.message || e); await sql.end(); process.exit(1); });
