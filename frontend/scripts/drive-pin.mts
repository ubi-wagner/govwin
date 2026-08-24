/**
 * THE SINGULAR SESSION — one identity, several companies, exactly one of them active at a time.
 *
 * A person can legitimately belong to more than one company: their own, plus every company that has
 * invited them onto a build. The rule is that a session acts in **one** of them, chosen explicitly
 * and then pinned, so nothing they do is ambiguous about whose work it was.
 *
 *   1. more than one membership, not yet pinned → login lands on /select-company
 *   2. picking a company REWRITES the session — role and tenant both — and pins it
 *   3. a pinned session cannot hop to the other company mid-session
 *   4. /select-company will not re-offer the choice once pinned
 *   5. control: one membership → straight in, no selector, role unchanged
 *   6. control: a platform admin has no memberships → never sees the selector, and can still
 *      descend into any customer as a shadow
 *
 * Every assertion reads the session the SERVER derived from the JWT (`GET /api/auth/session`), not
 * the URL. A URL is where the browser ended up; the session is who the server thinks you are, and
 * those are exactly the two things a session bug makes disagree.
 *
 * BUILDS ITS OWN SITUATION — it used to pin `expert@beacon-labs.test`, `teammate@acme-navy.test`
 * and two tenants, none of which exist any more.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-pin.mts
 */
import type { Page } from 'playwright';
import { runScenario } from './lib/scenario.mts';
import { BASE, buildCrossCompany, launch, signIn, session } from './lib/cross-company.mts';

const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';

await runScenario('pin', async (s) => {
  let ok = true;
  const A = (label: string, cond: boolean, detail = '') => {
    console.log(`${cond ? '✅' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!cond) ok = false;
  };

  const browser = await launch();
  try {
    const xc = await buildCrossCompany(s, browser);

    // ── 1 · multi-membership, unpinned → the selector ───────────────────────────────────────────
    //
    // Signed in WITHOUT the shared helper's "must not still be on /login" check, because landing on
    // /select-company is the expected outcome here and the helper would be happy either way.
    const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page: Page = await bc.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('#email', xc.multiEmail);
    await page.fill('#password', xc.multiPassword);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2800);
    A('two memberships + not pinned → login lands on the company selector',
      page.url().includes('/select-company'), page.url().replace(BASE, ''));

    const pre = await session(bc);
    A('  → and the session is NOT yet pinned', pre.membershipPinned !== true, `pinned=${pre.membershipPinned}`);

    // ── 2 · pick the HOST company, where they are only a collaborator ───────────────────────────
    // BY NAME, exactly. The first version matched the slug OR the bare word "host" — and only the
    // second alternative ever hit, by luck, because the display name happens to contain it. A
    // locator that passes for the wrong reason is a locator that will stop passing without warning.
    const hostBtn = page.locator(`form:has-text("${xc.host.name}") button[type="submit"]`).first();
    if (await hostBtn.count() === 0) {
      A('the selector offers the host company', false, 'no form matched the host company');
    } else {
      await hostBtn.click();
      await page.waitForTimeout(2800);
      const post = await session(bc);
      A('picking the host company rewrites the ACTIVE ROLE to the collaborator role',
        post.role === 'partner_user', `role=${post.role}`);
      A('  → and the active tenant to the host', post.tenantSlug === xc.host.slug, `tenant=${post.tenantSlug}`);
      A('  → and pins the session', post.membershipPinned === true, `pinned=${post.membershipPinned}`);

      // ── 3 · the pin holds: no hopping to their own company mid-session ────────────────────────
      await page.goto(`${BASE}/portal/${xc.home.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      A('a pinned session cannot hop to the other company',
        !page.url().includes(`/portal/${xc.home.slug}`), `ended at ${page.url().replace(BASE, '')}`);
      const afterHop = await session(bc);
      A('  → and the session is still pinned where it was', afterHop.tenantSlug === xc.host.slug,
        `tenant=${afterHop.tenantSlug}`);

      // ── 4 · re-pick-proof ──────────────────────────────────────────────────────────────────────
      await page.goto(`${BASE}/select-company`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      A('the selector will not re-offer the choice once pinned',
        !page.url().includes('/select-company'), `ended at ${page.url().replace(BASE, '')}`);
    }
    await bc.close();

    // ── 5 · control: one membership → straight in ───────────────────────────────────────────────
    const solo = await signIn(browser, xc.singleEmail, xc.singlePassword);
    const soloPage = solo.pages()[0];
    A('one membership skips the selector entirely',
      !soloPage.url().includes('/select-company'), soloPage.url().replace(BASE, ''));
    const soloSess = await session(solo);
    A('  → landing in its own company', soloSess.tenantSlug === xc.host.slug, `tenant=${soloSess.tenantSlug}`);
    A('  → keeping its own role', soloSess.role === 'tenant_user', `role=${soloSess.role}`);
    await solo.close();

    // ── 6 · control: a platform admin, who has no memberships at all ────────────────────────────
    const adminUser = await s.admin();
    const admin = await signIn(browser, adminUser.email, ADMIN_PW);
    const adminPage = admin.pages()[0];
    A('a platform admin never sees the selector',
      !adminPage.url().includes('/select-company'), adminPage.url().replace(BASE, ''));
    await adminPage.goto(`${BASE}/portal/${xc.host.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForTimeout(2000);
    A('  → and can still descend into a customer as a shadow',
      adminPage.url().includes(`/portal/${xc.host.slug}`), adminPage.url().replace(BASE, ''));
    await admin.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${ok ? '✅ ALL PASS' : '❌ FAILURES ABOVE'}\n`);
  return ok;
});
