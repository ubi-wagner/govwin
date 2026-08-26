/**
 * THE VAULT AUTHORIZATION CONTRACT, adversarially (P8.10 security gate over P8.2/P8.5/P8.6).
 *
 * Two companies, each with its own vault and its own external collaborator, and then every boundary
 * in docs/LIBRARY_AND_VAULTS_DESIGN.md §5.2 is pushed on from the wrong side.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. Checks 1–7 are the APP layer: `resolveVaultAccess` and
 * `listVaultsForCollaborator`, the functions every vault route calls before it does anything. That
 * is the layer where a wrong answer becomes a wrong page. Check 8 is the DATABASE layer underneath
 * it — RLS, asked directly, through a genuinely scoped connection — because an app-layer proof and
 * an RLS proof are different claims and the two-layer posture means neither one covers the other.
 *
 * BUILDS ITS OWN SITUATION. It used to pin two tenant uuids and one actor, and create both vaults
 * through the context-aware `sql` with no tenant context — so under the production posture its very
 * first write died with `new row violates row-level security policy for table
 * "collaboration_vaults"`, before a single boundary was tested. Nothing in that output distinguished
 * "the vault contract is broken" from "the harness never got to ask".
 *
 * Two checks also got stronger in the rebuild, because a built company makes real people available
 * where the old version could only invent uuids: check 5 now uses a REAL tenant_admin of the other
 * company rather than a random uuid with a tenant_admin label, and check 3 crosses between two
 * vaults that genuinely belong to different owners.
 *
 *   cd frontend && DATABASE_URL=<owner> DATABASE_URL_APP=<scoped> \
 *     node --import tsx scripts/drive-vault-isolation.mts
 */
import postgres from 'postgres';
import { runInTenant } from '@/lib/tenant-context';
import {
  createVault, inviteVaultMember, resolveVaultAccess, listVaultsForCollaborator,
} from '@/lib/vaults/vaults';
import { runScenario } from './lib/scenario.mts';

const uid = () => crypto.randomUUID();

await runScenario('vault-isolation', async (s) => {
  const results: Array<[string, boolean]> = [];
  const check = (name: string, ok: boolean) => { results.push([name, ok]); };

  const coA = await s.tenant({ label: 'owner-a' });
  const coB = await s.tenant({ label: 'owner-b' });
  const emailA = `partner-a.${s.tag}@ext.test`;
  const emailB = `partner-b.${s.tag}@ext.test`;

  // Setup writes go through a TENANT CONTEXT, the way a request does. Under the scoped role this is
  // what makes them legal at all; under the owner it is simply faithful.
  const vA = await runInTenant(coA.tenantId, () =>
    createVault(coA.tenantId, { id: coA.adminUserId }, { partnerName: `Probe Partner A ${s.tag}` }));
  const vB = await runInTenant(coB.tenantId, () =>
    createVault(coB.tenantId, { id: coB.adminUserId }, { partnerName: `Probe Partner B ${s.tag}` }));
  await runInTenant(coA.tenantId, () => inviteVaultMember(vA.id, coA.tenantId, { id: coA.adminUserId }, emailA));
  await runInTenant(coB.tenantId, () => inviteVaultMember(vB.id, coB.tenantId, { id: coB.adminUserId }, emailB));

  const collabA = { userId: uid(), email: emailA, role: 'partner_user' as const };

  // 1) tenant admin of the owner → tenant side, full rights
  const t = await resolveVaultAccess(vA.id, { userId: coA.adminUserId, email: coA.adminEmail, role: 'tenant_admin' });
  check('1 owner tenant_admin → tenant + full rights',
    t?.side === 'tenant' && t.rights.downloadGrain && t.rights.ingest && t.rights.manage);

  // 2) collaborator → whole-only (no grain, no ingest, no manage)
  const c = await resolveVaultAccess(vA.id, collabA);
  check('2 collaborator → whole-only',
    c?.side === 'collaborator' && c.rights.downloadWhole && !c.rights.downloadGrain && !c.rights.ingest && !c.rights.manage);

  // 3) cross-vault: partner A cannot reach company B's vault
  check('3 collaborator A → vault B = null', (await resolveVaultAccess(vB.id, collabA)) === null);

  // 4) non-member → null
  check('4 non-member → null',
    (await resolveVaultAccess(vA.id, { userId: uid(), email: `nobody.${s.tag}@ext.test`, role: 'partner_user' })) === null);

  // 5) a REAL tenant_admin of the OTHER company → null. (Was a random uuid wearing the label; a
  //    real admin of a real other company is the case the rule actually has to hold against.)
  check('5 other-company tenant_admin → null',
    (await resolveVaultAccess(vA.id, { userId: coB.adminUserId, email: coB.adminEmail, role: 'tenant_admin' })) === null);

  // 6) platform admin (rfp_admin shadow / master_admin) → tenant side
  const rfp = await resolveVaultAccess(vA.id, { userId: uid(), email: 'rfp@x', role: 'rfp_admin' });
  const master = await resolveVaultAccess(vA.id, { userId: uid(), email: 'm@x', role: 'master_admin' });
  check('6 platform admin (rfp/master) → tenant', rfp?.side === 'tenant' && master?.side === 'tenant');

  // 7) segregation: each collaborator sees ONLY their own vault
  const seenA = await listVaultsForCollaborator(collabA.userId, emailA);
  const seenB = await listVaultsForCollaborator(uid(), emailB);
  check('7 collaborator sees only their vault',
    seenA.some((v) => v.id === vA.id) && !seenA.some((v) => v.id === vB.id) &&
    seenB.some((v) => v.id === vB.id) && !seenB.some((v) => v.id === vA.id));

  // 8) THE LAYER UNDERNEATH. Everything above is the app answering correctly; this asks the database
  //    directly, in company B's context, for company A's vault. Through a connection that bypasses
  //    RLS the question is meaningless (B86), so the posture is checked first and the result is
  //    reported as NOT MEASURED rather than as either verdict.
  const appUrl = process.env.DATABASE_URL_APP
    || (process.env.DATABASE_URL?.includes('govtech_app') ? process.env.DATABASE_URL : null);
  if (!appUrl) {
    console.log('·  8 RLS layer — no scoped connection (DATABASE_URL_APP): UNCOVERED, not passing');
  } else {
    const appSql = postgres(appUrl, { max: 1 });
    try {
      const [me] = await appSql<Array<{ who: string; rolsuper: boolean; rolbypassrls: boolean }>>`
        SELECT current_user AS who, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`;
      if (me?.rolsuper || me?.rolbypassrls) {
        console.log(`·  8 RLS layer — connection is '${me.who}', which BYPASSES RLS: NOT MEASURED`);
      } else {
        const rows = await appSql.begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', ${coB.tenantId}, true)`;
          return tx<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM collaboration_vaults WHERE id = ${vA.id}::uuid`;
        });
        check("8 RLS itself hides company A's vault from company B's context", rows[0].n === 0);
      }
    } catch (e) {
      check(`8 RLS probe failed — ${String(e).slice(0, 70)}`, false);
    } finally { await appSql.end(); }
  }

  for (const [name, ok] of results) console.log(`${ok ? '✅' : '❌'} ${name}`);
  const pass = results.every(([, ok]) => ok);
  // No cleanup step — both companies go away on dispose, vaults and members with them.
  console.log(pass ? `\n✅ VAULT ISOLATION PROOF PASS (${results.length}/${results.length})` : '\n❌ FAIL');
  return pass;
});
