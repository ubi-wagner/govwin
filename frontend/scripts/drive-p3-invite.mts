/**
 * COLLABORATOR INVITE → MEMBERSHIP, without clobbering anybody's home.
 *
 * An invite has to do two things at once, and the second is the one that can go quietly wrong:
 *
 *   A. a BRAND-NEW external invitee gets an active membership at the inviting company, so the
 *      deep-link in their invitation email actually lands them somewhere they can work;
 *   B. an EXISTING person whose home is another company gets a membership at the inviting company
 *      **without their home being reassigned**. Overwriting `users.tenant_id` would silently move
 *      someone's whole account to the company that invited them — a one-line bug with a very large
 *      blast radius, and invisible to any check that only looks at whether the invite returned 200.
 *
 * WHAT THIS DRIVE USED TO BE. It posted two invites, printed their HTTP status, and ended with
 * "(assertions verified against the DB by the caller)". There is no caller. It asserted nothing
 * about memberships and nothing about the home it was named after — while pinning two tenants and
 * three accounts that no longer exist. It now builds its own two companies and checks the thing.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-p3-invite.mts
 */
import { sqlBypass as sql } from '@/lib/db';
import { runScenario } from './lib/scenario.mts';
import { BASE, buildCrossCompany, launch, signIn } from './lib/cross-company.mts';

await runScenario('p3-invite', async (s) => {
  let ok = true;
  const A = (label: string, cond: boolean, detail = '') => {
    console.log(`${cond ? '✅' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!cond) ok = false;
  };

  const browser = await launch();
  try {
    const xc = await buildCrossCompany(s, browser);
    const host = await signIn(browser, xc.host.adminEmail, xc.host.password);
    const invite = async (email: string, name: string) => (await host.request.post(
      `${BASE}/api/portal/${xc.host.slug}/proposals/${xc.hostBuild.proposalId}/collaborators`,
      { data: { email, name, role: 'external', permission: 'view',
        assignedSections: xc.hostSectionId ? [xc.hostSectionId] : [] } },
    )).status();

    // ── A · a brand-new external person ────────────────────────────────────────────────────────
    const NEW_EMAIL = `newcollab.${s.tag}@external.test`;
    A('inviting a brand-new external person is accepted', await invite(NEW_EMAIL, 'New Collab') < 300);
    const [newUser] = await sql<{ id: string; tenantId: string | null }[]>`
      SELECT id, tenant_id AS "tenantId" FROM users WHERE email = ${NEW_EMAIL}`;
    A('  → a user account exists for them', !!newUser, newUser?.id);
    if (newUser) {
      s.track(`invited user ${NEW_EMAIL}`, [
        async () => (await sql`DELETE FROM user_memberships WHERE user_id = ${newUser.id}::uuid`).count,
        async () => (await sql`DELETE FROM users WHERE id = ${newUser.id}::uuid`).count,
      ]);
      const [m] = await sql<{ status: string; role: string }[]>`
        SELECT status, role FROM user_memberships
        WHERE user_id = ${newUser.id}::uuid AND tenant_id = ${xc.host.tenantId}::uuid`;
      A('  → and an ACTIVE membership at the inviting company, so the invite link lands somewhere',
        m?.status === 'active', m ? `${m.role}/${m.status}` : 'NO MEMBERSHIP');
    }

    // ── B · an existing person whose home is elsewhere ──────────────────────────────────────────
    //
    // `buildCrossCompany` has already invited the home company's admin onto this build, so the
    // membership exists. What matters here is what did NOT happen to their home.
    const [multi] = await sql<{ id: string; tenantId: string | null }[]>`
      SELECT id, tenant_id AS "tenantId" FROM users WHERE email = ${xc.multiEmail}`;
    A('the cross-company person exists', !!multi);
    A('  → their HOME is still their own company — the invite did not reassign it',
      multi?.tenantId === xc.home.tenantId,
      `home=${multi?.tenantId === xc.home.tenantId ? xc.home.slug : String(multi?.tenantId)}`);

    const mems = await sql<{ slug: string; role: string; status: string }[]>`
      SELECT t.slug, m.role, m.status FROM user_memberships m
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${multi?.id ?? null}::uuid ORDER BY t.slug`;
    A('  → they now hold TWO memberships, one per company', mems.length === 2,
      mems.map((m) => `${m.slug}:${m.role}/${m.status}`).join(' · '));
    A('  → tenant_admin at home', mems.some((m) => m.slug === xc.home.slug && m.role === 'tenant_admin' && m.status === 'active'));
    A('  → and a collaborator membership at the host', mems.some((m) => m.slug === xc.host.slug && m.status === 'active'));

    // RE-INVITING AN ACTIVE COLLABORATOR IS REFUSED, 409, and that is the right answer.
    //
    // The route says so in as many words: "An ACTIVE one is a real duplicate (409)" — while a
    // REVOKED one reactivates instead, which is what the lifecycle drive exercises. My first
    // version asserted the re-invite would be *accepted*, read the 409 as a failure, and would have
    // reported a working guard as a broken invite. Assert the contract the system has.
    const reStatus = await invite(xc.multiEmail, 'Cross Collab');
    A('re-inviting an ACTIVE collaborator is refused as a duplicate', reStatus === 409, `${reStatus}`);
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM user_memberships
      WHERE user_id = ${multi?.id ?? null}::uuid AND tenant_id = ${xc.host.tenantId}::uuid`;
    A('  → and no second membership was created', n === 1, `${n}`);

    await host.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${ok ? '✅ ALL PASS' : '❌ FAILURES ABOVE'}\n`);
  return ok;
});
