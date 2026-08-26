/**
 * IDENTITY HOLDS EVEN WHEN THE LINK CAME FROM AN EMAIL.
 *
 * Nudges and notifications deep-link people straight into work — `/go?task=…`, `/go?tenant=…`,
 * `/api/enter`. Whatever session the recipient happens to be carrying when they click, they must end
 * up acting in the RIGHT company, visibly, under the singular-session rule. The failure this guards
 * against is the quiet one: a link that silently re-scopes a session, so someone's next edit is
 * attributed to a company they did not think they were in.
 *
 *   CASE 1  pinned to one company, deep-link to the other → a SWITCH GATE, never a silent switch;
 *           taking it signs out and back in, landing pinned to the target
 *   CASE 2  unauthenticated deep-link to a non-home company → login preserves the target, and they
 *           land there rather than at their own company
 *   CASE 3  a NON-MEMBER deep-link is refused, and the session is never re-scoped by the attempt
 *   CASE 4  a dead link (an already-completed task) → an "already complete" acknowledgement naming
 *           the company, rather than a broken destination
 *   CASE 5  hitting /api/enter directly while pinned elsewhere → the switch gate, never a re-pin
 *
 * Every assertion reads the server-derived session, not the URL.
 *
 * BUILDS ITS OWN SITUATION — it used to pin two tenants and two accounts that no longer exist, and
 * hand-inserted its completed task against them.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-identity-deeplink.mts
 */
import type { Page } from 'playwright';
import { sqlBypass as sql } from '@/lib/db';
import { runScenario } from './lib/scenario.mts';
import { BASE, buildCrossCompany, launch, newDriveContext, signIn, session, settledSession, waitForLanding } from './lib/cross-company.mts';

await runScenario('identity-deeplink', async (s) => {
  let ok = true;
  const A = (label: string, cond: boolean, detail = '') => {
    console.log(`${cond ? '✅' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!cond) ok = false;
  };

  const browser = await launch();
  try {
    const xc = await buildCrossCompany(s, browser);
    const [multiUser] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${xc.multiEmail}`;

    // A COMPLETED task at their HOME company, for the dead-link case. Tracked for teardown.
    const [task] = await sql<{ id: string }[]>`
      INSERT INTO tasks (tenant_id, assignee_user_id, assignee_role, task_type, title, status, completed_at)
      VALUES (${xc.home.tenantId}::uuid, ${multiUser.id}::uuid, 'tenant_admin', 'review',
              ${`Deep-link dead-link fixture ${s.tag}`}, 'completed', now())
      RETURNING id`;
    s.track(`dead-link task ${task.id}`, [
      async () => (await sql`DELETE FROM tasks WHERE id = ${task.id}::uuid`).count,
    ]);

    /** Sign in on the CURRENT page, so a preserved deep-link target survives the login. */
    const loginHere = async (page: Page, email: string, password: string) => {
      await page.fill('#email', email);
      await page.fill('#password', password);
      await page.click('button[type="submit"]');
      // Wait for the login to LAND, not for a guessed number of milliseconds and not merely for the
      // URL to stop being /login — `/portal` is a dispatcher and reading it as a destination is what
      // made this drive report six failures it never observed. See `waitForLanding`.
      await waitForLanding(page);
      await settledSession(page.context());
    };
    // BY NAME, NOT SLUG. The company selector renders the DISPLAY name ("Scenario host 1a2b3c4d");
    // matching on the slug ("scenario-host-1a2b3c4d") finds no form, the click never happens, and
    // the session stays on whatever the page defaulted to — which then fails four downstream
    // assertions for a reason that has nothing to do with deep links.
    //
    // AND VERIFY THE POSTCONDITION. A click is an action, not an outcome. Each company on that page
    // is its own `<form action={selectCompanyAction}>` — a React server action — and a click that
    // lands before the form is wired leaves the person exactly where they were. Returning `true`
    // for "I clicked something" is what let this drive assert "picked the host company" while the
    // session was still sitting, unpinned, at their own company; every case after it then measured
    // the wrong session. So the pick is only a pick once the SESSION says so, and if the first
    // click did not take we click once more and say out loud that it was needed — because a
    // selector that ignores the first click is a product problem, not a harness inconvenience.
    const pick = async (page: Page, name: string, slug: string) => {
      const btn = page.locator(`form:has-text("${name}") button[type="submit"]`).first();
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (await btn.count() === 0) return false;
        await btn.click();
        await waitForLanding(page);
        // THE POSTCONDITION IS "PINNED THERE", not "the session mentions that slug". An unpinned
        // session already carries the person's HOME slug, so `tenantSlug === slug` is satisfied
        // before `pickHome` clicks anything — the check passes, the pick never happens, and CASE 4
        // then measures an unpinned session. Picking a company IS pinning it; assert that.
        const took = (x: Record<string, unknown>) => x.tenantSlug === slug && x.membershipPinned === true;
        const after = await settledSession(page.context(), took, 6, 700);
        if (took(after)) {
          if (attempt > 1) console.error(`  ⚠ picking "${name}" needed ${attempt} clicks to take`);
          return true;
        }
        console.error(`  ⚠ click ${attempt} on "${name}" did not take — at `
          + `${page.url().replace(BASE, '')}, session tenant=${after.tenantSlug} `
          + `pinned=${after.membershipPinned}`);
        if (!page.url().includes('/select-company')) {
          await page.goto(`${BASE}/select-company`, { waitUntil: 'domcontentloaded' });
        }
      }
      return false;
    };
    const pickHost = (page: Page) => pick(page, xc.host.name, xc.host.slug);
    const pickHome = (page: Page) => pick(page, xc.home.name, xc.home.slug);

    // ── CASE 1 · pinned here, deep-linked there → the switch gate ──────────────────────────────
    console.log('\n== CASE 1: pinned to the host, deep link to their home ==');
    let bc = await newDriveContext(browser);
    let page = await bc.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await loginHere(page, xc.multiEmail, xc.multiPassword);
    A('multi-membership login offers the selector', page.url().includes('/select-company'),
      page.url().replace(BASE, ''));
    const picked = await pickHost(page);
    A('picked the host company', picked);
    let sess = await session(bc);
    A('  → pinned there as a collaborator',
      sess.membershipPinned === true && sess.tenantSlug === xc.host.slug && sess.role === 'partner_user',
      `role=${sess.role} tenant=${sess.tenantSlug} pinned=${sess.membershipPinned}`);

    await page.goto(`${BASE}/go?tenant=${xc.home.slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    A('a deep link to the OTHER company raises a switch gate, not a silent switch',
      await page.locator('text=/Switching companies/i').count() > 0, page.url().replace(BASE, ''));
    sess = await session(bc);
    A('  → and the session is still pinned where it was while the gate is up',
      sess.tenantSlug === xc.host.slug, `tenant=${sess.tenantSlug}`);

    const switchBtn = page.locator('button:has-text("Sign in to")').first();
    if (await switchBtn.count() > 0) {
      await switchBtn.click();
      await page.waitForTimeout(2200);
      A('  → taking the switch signs them out', page.url().includes('/login'), page.url().replace(BASE, ''));
      A('  → and says so on the login page',
        await page.locator('text=/signed out/i').count() > 0);
      await loginHere(page, xc.multiEmail, xc.multiPassword);
      sess = await settledSession(bc, (x) => x.tenantSlug === xc.home.slug);
      A('  → re-login lands PINNED to the target company',
        sess.membershipPinned === true && sess.tenantSlug === xc.home.slug,
        `tenant=${sess.tenantSlug} pinned=${sess.membershipPinned}`);
      A('  → with the role they hold THERE, not the one they had before',
        sess.role === 'tenant_admin', `role=${sess.role}`);
    } else {
      A('the switch gate offers a way through', false, 'no "Sign in to …" button on the gate');
    }
    await bc.close();

    // ── CASE 2 · an unauthenticated deep link keeps its target through login ───────────────────
    console.log('\n== CASE 2: unauthenticated deep link to the non-home company ==');
    bc = await newDriveContext(browser);
    page = await bc.newPage();
    await page.goto(`${BASE}/go?tenant=${xc.host.slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    A('an unauthenticated deep link sends them to login', page.url().includes('/login'),
      page.url().replace(BASE, ''));
    await loginHere(page, xc.multiEmail, xc.multiPassword);
    sess = await settledSession(bc, (x) => x.tenantSlug === xc.host.slug);
    A('  → and login honours the TARGET, not their own company',
      sess.tenantSlug === xc.host.slug, `tenant=${sess.tenantSlug}`);
    A('  → pinned there, in the role they hold there',
      sess.role === 'partner_user' && sess.membershipPinned === true,
      `role=${sess.role} pinned=${sess.membershipPinned}`);
    await bc.close();

    // ── CASE 3 · a non-member is refused, and nothing is re-scoped by the attempt ──────────────
    console.log('\n== CASE 3: a non-member follows the same link ==');
    const solo = await signIn(browser, xc.singleEmail, xc.singlePassword);
    const soloPage = solo.pages()[0];
    await soloPage.goto(`${BASE}/go?tenant=${xc.home.slug}`, { waitUntil: 'domcontentloaded' });
    await soloPage.waitForTimeout(1800);
    A('a non-member is NOT let into the company they were linked to',
      !soloPage.url().includes(`/portal/${xc.home.slug}`), soloPage.url().replace(BASE, ''));
    const soloSess = await session(solo);
    A('  → and their session was never re-scoped by the attempt',
      soloSess.tenantSlug !== xc.home.slug, `tenant=${soloSess.tenantSlug}`);
    await solo.close();

    // ── CASE 4 · a dead link acknowledges itself instead of breaking ───────────────────────────
    console.log('\n== CASE 4: a link to an already-completed task ==');
    bc = await newDriveContext(browser);
    page = await bc.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await loginHere(page, xc.multiEmail, xc.multiPassword);
    // PIN THEIR HOME THROUGH THE SELECTOR — the way a person does it.
    //
    // The acknowledgement only renders for someone already committed to that company:
    // `(pinned && sessionSlug === targetSlug) || memberships.length === 1`. A multi-membership
    // person who is NOT pinned falls through to `/api/enter` and simply lands on the dashboard —
    // which is what my first version measured, having tried to pin via /api/enter directly and
    // silently not achieved it. Pinning through the picker is both faithful and unambiguous, and
    // it leaves /api/enter's own semantics to CASE 5, which is where they belong.
    await pickHome(page);
    const pinnedHome = await settledSession(bc, (x) => x.tenantSlug === xc.home.slug);
    A('pinned to the company the task belongs to',
      pinnedHome.membershipPinned === true && pinnedHome.tenantSlug === xc.home.slug,
      `tenant=${pinnedHome.tenantSlug} pinned=${pinnedHome.membershipPinned}`);
    await page.goto(`${BASE}/go?task=${task.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    A('a dead link says "already complete" rather than breaking',
      await page.locator('text=/already complete/i').count() > 0, page.url().replace(BASE, ''));
    A('  → and names the company they are working in',
      await page.locator(`text=/working in/i`).count() > 0);

    // ── CASE 5 · /api/enter cannot silently re-pin ─────────────────────────────────────────────
    console.log('\n== CASE 5: /api/enter hit directly while pinned elsewhere ==');
    await bc.close();
    bc = await newDriveContext(browser);
    page = await bc.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await loginHere(page, xc.multiEmail, xc.multiPassword);
    await pickHost(page);
    await page.goto(`${BASE}/api/enter?slug=${xc.home.slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    A('/api/enter to a different company hands off to the switch gate',
      await page.locator('text=/Switching companies/i').count() > 0, page.url().replace(BASE, ''));
    sess = await settledSession(bc, (x) => !!x.tenantSlug);
    A('  → the session is STILL pinned where it was — no silent re-pin',
      sess.tenantSlug === xc.host.slug && sess.membershipPinned === true, `tenant=${sess.tenantSlug}`);
    await bc.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${ok ? '✅ ALL PASS' : '❌ FAILURES ABOVE'}\n`);
  return ok;
});
