/**
 * Drive-test P3: collaborator invite → membership (multi-company, no clobber).
 *
 * Proves the invite path now materializes a login-selectable membership so a
 * CROSS-COMPANY collaborator can actually reach the inviting tenant's portal:
 *   A. a brand-new external invitee gets an active partner_user membership at Acme;
 *   B. an EXISTING user whose home is Beacon, invited to Acme, gets an Acme
 *      partner_user membership WITHOUT their users.tenant_id (home) being clobbered.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const PW = 'DemoPass123!';
const ACME_PROPOSAL = '3b0e7f8b-7ca2-4570-91d9-48326add00ff';
const ACME_SECTION = 'dc8a44af-a4f4-4e23-9678-acc4d1f3d9a9';
const NEW_EMAIL = 'p3newcollab@external.test';
const CROSS_EMAIL = 'p3crosscollab@beacon-labs.test';

function ok(cond: boolean, label: string) {
  console.log(`${cond ? '✅' : '❌ FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

async function login(email: string) {
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
}

async function invite(email: string, name: string) {
  const res = await page.request.post(
    `${BASE}/api/portal/acme-navy-systems/proposals/${ACME_PROPOSAL}/collaborators`,
    { data: { email, name, role: 'external', permission: 'view', assignedSections: [ACME_SECTION] } },
  );
  console.log(`   invite ${email} → HTTP ${res.status()}`);
  return res.status();
}

try {
  await login('admin@acme-navy.test');
  ok(page.url().includes('/portal/acme-navy-systems'), `acme admin logged in (${page.url()})`);

  console.log('\n== A. new external invitee ==');
  ok((await invite(NEW_EMAIL, 'P3 New Collab')) < 300, 'invite new user succeeded');

  console.log('\n== B. existing cross-company user (home = Beacon) ==');
  ok((await invite(CROSS_EMAIL, 'P3 Cross Collab')) < 300, 'invite existing beacon user succeeded');

  console.log('\n(assertions verified against the DB by the caller)');
} catch (e) {
  console.error('DRIVE-TEST ERROR', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
