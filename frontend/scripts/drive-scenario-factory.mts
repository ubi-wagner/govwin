/**
 * THE INSTRUMENT BEFORE THE FINDING — a self-test for the scenario factory.
 *
 * `scripts/lib/scenario.mts` is about to become the substrate every rebuilt drive and the whole
 * scenario matrix stand on. A factory that silently builds half a scenario, or that disposes
 * incompletely, would make every drive above it report confidently about a situation that was
 * never actually constructed — the exact failure mode the factory exists to end.
 *
 * So it is validated against a known answer first: **count the world, build the scenario, assert
 * each piece is really there and really usable, dispose, and assert the world is byte-identical.**
 * The last assertion is the one that matters. A factory that creates cleanly but leaks is worse
 * than no factory, because the leak accumulates under every future run.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-scenario-factory.mts
 */
import { sqlBypass as sql } from '@/lib/db';
import { scenario, CannotRun, SCENARIO_PW } from './lib/scenario.mts';

let ok = true;
const A = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok = ok && cond;
};

/** The counts that must be identical before and after. Anything the factory touches is in here. */
async function census() {
  const [r] = await sql<Record<string, number>[]>`
    SELECT (SELECT count(*)::int FROM tenants)                    AS tenants,
           (SELECT count(*)::int FROM users)                      AS users,
           (SELECT count(*)::int FROM user_memberships)           AS memberships,
           (SELECT count(*)::int FROM proposals)                  AS proposals,
           (SELECT count(*)::int FROM proposal_portals)           AS portals,
           (SELECT count(*)::int FROM proposal_sections)          AS sections,
           (SELECT count(*)::int FROM proposal_artifacts)         AS artifacts,
           (SELECT count(*)::int FROM proposal_compliance_matrix) AS matrix,
           (SELECT count(*)::int FROM proposal_collaborators)     AS collaborators,
           (SELECT count(*)::int FROM tasks)                      AS tasks,
           (SELECT count(*)::int FROM process_instances)          AS instances,
           (SELECT count(*)::int FROM library_atoms)              AS atoms`;
  return r;
}

const diff = (before: Record<string, number>, after: Record<string, number>) =>
  Object.keys(before).filter((k) => before[k] !== after[k])
    .map((k) => `${k} ${before[k]}→${after[k]}`);

async function main() {
  console.log('\n── SCENARIO FACTORY · self-test ──\n');
  const before = await census();
  console.log(`world before: ${Object.entries(before).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);

  const s = await scenario('factory-selftest');
  let built = false;
  try {
    // ── build ────────────────────────────────────────────────────────────────────────────────
    const client = await s.tenant({ label: 'client' });
    A('tenant created through createTenantWithAdmin', !!client.tenantId && !!client.slug, client.slug);
    const [t] = await sql<{ slug: string; status: string }[]>`
      SELECT slug, status FROM tenants WHERE id = ${client.tenantId}::uuid`;
    A('  → the tenant row is really there and active', t?.status === 'active', t?.slug);

    const [admin] = await sql<{ email: string; role: string; tenantId: string }[]>`
      SELECT email, role, tenant_id AS "tenantId" FROM users WHERE id = ${client.adminUserId}::uuid`;
    A('  → its tenant_admin exists, homed in it',
      admin?.role === 'tenant_admin' && admin?.tenantId === client.tenantId, admin?.email);

    // The password is the point: a drive has to be able to SIGN IN as what the factory made.
    const bcrypt = (await import('bcryptjs')).default;
    const [pw] = await sql<{ hash: string }[]>`SELECT password_hash AS hash FROM users WHERE id = ${client.adminUserId}::uuid`;
    A('  → the admin password is the one the factory advertises',
      await bcrypt.compare(SCENARIO_PW, pw.hash));

    const home = await s.tenant({ label: 'home' });
    A('a SECOND tenant is independent of the first', home.tenantId !== client.tenantId, home.slug);

    const ext = await s.user({ label: 'collab', role: 'tenant_admin', homeTenant: home });
    const [eu] = await sql<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM users WHERE id = ${ext.userId}::uuid`;
    A('a cross-company person is homed in the OTHER tenant', eu?.tenantId === home.tenantId, ext.email);

    const buildA = await s.build({ tenant: client, label: 'A' });
    A('a build provisioned through provisionProposalForPortal', buildA.sectionCount > 0,
      `${buildA.sectionCount} sections`);
    const [secs] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM proposal_sections WHERE proposal_id = ${buildA.proposalId}::uuid`;
    A('  → the sections are really in the database', secs.n === buildA.sectionCount, `${secs.n}`);
    const [linked] = await sql<{ proposalId: string | null }[]>`
      SELECT proposal_id AS "proposalId" FROM proposal_portals WHERE id = ${buildA.portalId}::uuid`;
    A('  → the portal is bound to the proposal', linked?.proposalId === buildA.proposalId);

    const buildB = await s.build({ tenant: client, label: 'B' });
    A('a SECOND build in the same tenant is distinct', buildB.proposalId !== buildA.proposalId);

    built = true;
  } catch (e) {
    if (e instanceof CannotRun) {
      console.error(`\nCANNOT RUN\n  ${e.message}\n`);
      await s.dispose();
      await sql.end();
      process.exit(2);
    }
    console.error('BUILD ERROR', e);
    ok = false;
  }

  // ── dispose, and prove it ──────────────────────────────────────────────────────────────────
  await s.dispose();
  const after = await census();
  const leaked = diff(before, after);
  A('the world is exactly as it was found', leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(', ')}` : 'no residue');

  if (!built) A('scenario built at all', false);
  console.log(`\n${ok ? '✅ the factory builds and disposes cleanly' : '❌ FAILURES ABOVE'}\n`);
  await sql.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('SELF-TEST ERROR', e);
  await sql.end().catch(() => {});
  process.exit(1);
});
