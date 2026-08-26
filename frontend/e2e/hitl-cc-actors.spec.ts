/**
 * Command Center — every actor × both modalities (desktop 1280 + mobile 390). Proves the same
 * console renders correctly for each role and adapts across viewports, and that the gates hold.
 * Run: npx playwright test --project=hitl hitl-cc-actors
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const PW = { foundation: 'DemoPass123!', admin: (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!') };
const DIR = process.env.CC_SHOT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/cc-shots/actors';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });

async function login(page: Page, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced`).not.toHaveURL(/\/login/);
}
async function assertClean(page: Page, name: string) {
  const body = (await page.textContent('body').catch(() => '')) || '';
  expect(body.length, `${name} blank`).toBeGreaterThan(300);
  expect(new URL(page.url()).pathname, `${name} bounced`).not.toMatch(/^\/login/);
}

test('rfp_admin — /admin/command desktop + mobile', async ({ page }) => {
  await login(page, 'eric@rfppipeline.com', PW.admin);
  for (const [mod, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    await page.setViewportSize(vp);
    await page.goto('/admin/command', { waitUntil: 'networkidle', timeout: 45_000 });
    await assertClean(page, `admin-${mod}`);
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/rfpadmin-${mod}.png`, fullPage: mod === 'mobile' });
  }
});

test('tenant_admin — /portal command desktop + mobile', async ({ page }) => {
  await login(page, 'kate.ulepic@foundation3dp.com', PW.foundation);
  for (const [mod, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    await page.setViewportSize(vp);
    await page.goto('/portal/foundation/command', { waitUntil: 'networkidle', timeout: 45_000 });
    await assertClean(page, `tenant-${mod}`);
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
    // exercise a tab switch on desktop
    if (mod === 'desktop') {
      await page.getByRole('tab', { name: /Workflows/ }).click();
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: `${DIR}/tenant-${mod}.png`, fullPage: mod === 'mobile' });
  }
});

test('partner_admin — console + descend, desktop + mobile', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com', PW.foundation);
  for (const [mod, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    await page.setViewportSize(vp);
    await page.goto('/partner', { waitUntil: 'networkidle', timeout: 45_000 });
    await assertClean(page, `partner-${mod}`);
    await expect(page.getByRole('heading', { name: 'Partner Console' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/partner-console-${mod}.png`, fullPage: mod === 'mobile' });
  }
  // descend once (desktop) into the tenant CC
  await page.setViewportSize(DESKTOP);
  await page.goto('/partner', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /^Open workspace/ }).first().click();
  await page.waitForURL(/\/portal\/foundation\/command/, { timeout: 30_000 });
  await expect(page.getByRole('link', { name: /Exit to partner console/ })).toBeVisible();
  await page.screenshot({ path: `${DIR}/partner-descended-desktop.png` });
});

test('tenant_user — gated OUT of the Command Center', async ({ page }) => {
  await login(page, 'connor.casey@foundation3dp.com', PW.foundation);
  await page.goto('/portal/foundation/command', { waitUntil: 'networkidle', timeout: 45_000 });
  await expect(page, 'tenant_user NOT redirected off /command').toHaveURL(/\/portal\/foundation\/(dashboard|proposals)/);
});
