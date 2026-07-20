/**
 * Drive-test: singular-session enforcement + active-role rewrite.
 *
 * expert@beacon-labs.test is tenant_admin @ beacon-labs (home) AND partner_user @
 * acme-navy-systems (collaborator). Proves:
 *  1. >1 membership + not pinned → login lands on /select-company.
 *  2. Picking Acme REWRITES the session (role→partner_user, tenant→acme) and pins it
 *     — verified via GET /api/auth/session (the real JWT-derived session).
 *  3. Pinned session CANNOT hop to beacon-labs mid-session (bounced back to acme).
 *  4. Control: teammate@acme.test (single membership) logs straight in, unaffected.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const PW = 'DemoPass123!';
const OUT = '/home/user/govwin/docs/user-guides/img';
mkdirSync(OUT, { recursive: true });

function ok(cond: boolean, label: string) {
  console.log(`${cond ? '✅' : '❌ FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function sessionJson(page: Page): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${BASE}/api/auth/session`);
  const j = await res.json();
  return (j?.user ?? {}) as Record<string, unknown>;
}

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log(`   📸 ${name}.png  (${page.url()})`);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

try {
  // ---- 1. Multi-membership login → selector ----
  console.log('\n== expert@beacon-labs.test (multi-membership) ==');
  await login(page, 'expert@beacon-labs.test');
  ok(page.url().includes('/select-company'), `login lands on /select-company (got ${page.url()})`);
  await shot(page, 'pin-01-select-company');

  const pre = await sessionJson(page);
  console.log(`   session pre-pick: role=${pre.role} tenant=${pre.tenantSlug} pinned=${pre.membershipPinned}`);
  ok(pre.membershipPinned !== true, 'pre-pick: NOT pinned');

  // ---- 2. Pick Acme (where expert is only a partner_user) ----
  // Find the Acme form's submit button by its visible company name.
  const acmeBtn = page.locator('form:has-text("Acme") button[type="submit"]').first();
  await acmeBtn.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  ok(page.url().includes('/portal/acme-navy-systems'), `landed in acme portal (got ${page.url()})`);
  await shot(page, 'pin-02-acme-collaborator-view');

  const post = await sessionJson(page);
  console.log(`   session post-pick: role=${post.role} tenant=${post.tenantSlug} pinned=${post.membershipPinned}`);
  ok(post.role === 'partner_user', `active role REWRITTEN to partner_user (got ${post.role})`);
  ok(post.tenantSlug === 'acme-navy-systems', `active tenant = acme (got ${post.tenantSlug})`);
  ok(post.membershipPinned === true, 'session is PINNED');

  // ---- 3. Try to hop to beacon-labs mid-session → must be denied ----
  await page.goto(`${BASE}/portal/beacon-labs/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  ok(!page.url().includes('/portal/beacon-labs'), `beacon hop DENIED (ended at ${page.url()})`);
  const afterHop = await sessionJson(page);
  ok(afterHop.tenantSlug === 'acme-navy-systems', `still pinned to acme after hop attempt (got ${afterHop.tenantSlug})`);
  await shot(page, 'pin-03-beacon-hop-denied');

  // ---- 4. Re-pick-proof: /select-company should NOT re-offer the choice ----
  await page.goto(`${BASE}/select-company`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  ok(!page.url().includes('/select-company'), `/select-company is re-pick-proof (ended at ${page.url()})`);

  // ---- 5. Control: single-membership user unaffected ----
  console.log('\n== teammate@acme-navy.test (single membership) ==');
  await login(page, 'teammate@acme-navy.test');
  ok(!page.url().includes('/select-company'), `single-membership skips selector (got ${page.url()})`);
  const solo = await sessionJson(page);
  console.log(`   session: role=${solo.role} tenant=${solo.tenantSlug} pinned=${solo.membershipPinned}`);
  ok(String(page.url()).includes('/portal/acme-navy-systems'), 'single-membership lands in its portal');
  ok(solo.role === 'tenant_user', `single-membership keeps its role (got ${solo.role})`);
  await shot(page, 'pin-04-single-membership-control');

  // ---- 6. Control: admin (0 memberships) → platform, never the selector ----
  console.log('\n== eric@rfppipeline.com (admin) ==');
  await login(page, 'eric@rfppipeline.com');
  ok(!page.url().includes('/select-company'), `admin never sees selector (got ${page.url()})`);
  ok(page.url().includes('/admin'), `admin lands on platform (got ${page.url()})`);
  const adm = await sessionJson(page);
  console.log(`   session: role=${adm.role} tenant=${adm.tenantSlug} pinned=${adm.membershipPinned}`);
  // Admin can still descend into ANY customer portal (shadow) — not blocked by the pin.
  await page.goto(`${BASE}/portal/acme-navy-systems/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  ok(page.url().includes('/portal/acme-navy-systems'), `admin descends into a customer (got ${page.url()})`);
  await shot(page, 'pin-05-admin-shadow-control');

  console.log('\nDrive-test complete.');
} catch (e) {
  console.error('DRIVE-TEST ERROR', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
