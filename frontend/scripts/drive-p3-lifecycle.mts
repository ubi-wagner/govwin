/**
 * COLLABORATOR MEMBERSHIP LIFECYCLE — invite · remove · re-invite · the still-collaborating guard.
 *
 *   invite            → membership active, collaborator row active
 *   remove (the last) → membership REVOKED, collaborator row PERSISTS as revoked (never deleted)
 *   re-invite         → the SAME row reactivates, membership reactivates
 *   remove one of two → membership STAYS active, because they still collaborate elsewhere
 *
 * The last one is the guard that matters: revoking someone's access to one proposal must not throw
 * them out of the company they are still working with.
 *
 * BUILDS ITS OWN SITUATION. This drive used to pin `acme-navy-systems`, `beacon-labs`,
 * `admin@acme-navy.test`, a proposal uuid and a collaborator email — none of which exist any more,
 * so it failed on a missing row and reported the LIFECYCLE broken. It now constructs two companies,
 * a build in one, and a cross-company person, through the product's own routes, and disposes of all
 * of it. Nothing here can rot, because nothing here is pinned.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-p3-lifecycle.mts
 */
import { sqlBypass as sql } from '@/lib/db';
import { runScenario } from './lib/scenario.mts';
import { BASE, buildCrossCompany, launch, signIn } from './lib/cross-company.mts';

await runScenario('p3-lifecycle', async (s) => {
  let ok = true;
  const A = (label: string, cond: boolean, detail = '') => {
    console.log(`${cond ? '✅' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!cond) ok = false;
  };

  const browser = await launch();
  try {
    const xc = await buildCrossCompany(s, browser);
    // A second build in the SAME host company — the guard needs somewhere else to still be working.
    const buildB = await s.build({ tenant: xc.host, label: 'guard' });
    const host = await signIn(browser, xc.host.adminEmail, xc.host.password);

    const A_ID = xc.hostBuild.proposalId;
    const B_ID = buildB.proposalId;
    const EMAIL = xc.multiEmail;

    const invite = async (pid: string) => (await host.request.post(
      `${BASE}/api/portal/${xc.host.slug}/proposals/${pid}/collaborators`,
      { data: { email: EMAIL, name: 'lifecycle', role: 'external', permission: 'view', assignedSections: [] } },
    )).status();
    const remove = async (pid: string, cid: string) => (await host.request.delete(
      `${BASE}/api/portal/${xc.host.slug}/proposals/${pid}/collaborators/${cid}`)).status();

    const collabId = async (pid: string) => (await sql<{ id: string }[]>`
      SELECT id FROM proposal_collaborators WHERE proposal_id = ${pid}::uuid AND email = ${EMAIL}`)[0]?.id ?? null;
    /** 'absent' | 'active' | 'revoked' — proves the row is never DELETED, only stamped. */
    const collabState = async (pid: string) => {
      const rows = await sql<{ revoked: boolean }[]>`
        SELECT (revoked_at IS NOT NULL) AS revoked FROM proposal_collaborators
        WHERE proposal_id = ${pid}::uuid AND email = ${EMAIL}`;
      return rows.length === 0 ? 'absent' : rows[0].revoked ? 'revoked' : 'active';
    };
    const memStatus = async () => (await sql<{ status: string }[]>`
      SELECT m.status FROM user_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE u.email = ${EMAIL} AND m.tenant_id = ${xc.host.tenantId}::uuid AND m.source = 'collaborator'`)[0]?.status ?? null;
    const listShowsRevoked = async () => {
      const r = await host.request.get(`${BASE}/api/portal/${xc.host.slug}/proposals/${A_ID}/collaborators`);
      const j = await r.json().catch(() => ({}));
      const row = (j?.data ?? []).find((c: { email: string }) => c.email === EMAIL);
      return !!row && row.active === false; // still listed, badged inactive
    };

    // `buildCrossCompany` already invited this person onto build A — that is the shape it makes.
    A('invited on build A', await collabState(A_ID) === 'active', await collabState(A_ID));
    A('  → the invite materialised a membership at the host company', await memStatus() === 'active',
      `${await memStatus()}`);

    const cidA = await collabId(A_ID);
    A('remove (their only collaboration) accepted', cidA !== null && await remove(A_ID, cidA) < 300);
    A('  → the collaborator row PERSISTS as revoked, never deleted', await collabState(A_ID) === 'revoked',
      await collabState(A_ID));
    A('  → the membership is revoked with it', await memStatus() === 'revoked', `${await memStatus()}`);
    A('  → and they still appear in the list, badged inactive (history is kept)', await listShowsRevoked());

    A('re-invite accepted', await invite(A_ID) < 300);
    A('  → the SAME row reactivates', await collabState(A_ID) === 'active', await collabState(A_ID));
    A('  → the membership reactivates with it', await memStatus() === 'active', `${await memStatus()}`);

    // THE GUARD: still collaborating on B, so losing A must not evict them from the company.
    A('invited on a second build in the same company', await invite(B_ID) < 300);
    const cidA2 = await collabId(A_ID);
    A('removed from build A while still on build B', cidA2 !== null && await remove(A_ID, cidA2) < 300);
    A('  → the membership STAYS active — they still work here', await memStatus() === 'active',
      `${await memStatus()}`);
    A('  → build B\'s grant is untouched', await collabState(B_ID) === 'active', await collabState(B_ID));

    await host.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${ok ? '✅ ALL PASS' : '❌ FAILURES ABOVE'}\n`);
  return ok;
});
