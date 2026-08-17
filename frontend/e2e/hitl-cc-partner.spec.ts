/**
 * Command Center — partner-manager live drive (verification). Logs in as an EconDev
 * partner-manager (pjackson @ Entrepreneurs' Center, managing Foundation), asserts the
 * console renders with the new stable-wide pipeline glance, then proves "Open workspace →"
 * DESCENDS into the tenant Command Center (/portal/foundation/command) with the partner
 * banner. Run: npx playwright test --project=hitl hitl-cc-partner
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const DIR = process.env.CC_SHOT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/cc-shots';

test.use({ viewport: { width: 1280, height: 1200 } });
test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced to /login`).not.toHaveURL(/\/login/);
}

test('partner console → descend into the tenant Command Center', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com');

  await page.goto('/partner', { waitUntil: 'networkidle', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'Partner Console' })).toBeVisible();
  // The new stable-wide pipeline glance line.
  await expect(page.getByText(/build.* in flight across your stable/)).toBeVisible();
  await page.screenshot({ path: `${DIR}/06-partner-console.png`, fullPage: true });

  // "Open workspace →" on the Foundation (managed) card descends into its Command Center.
  await page.getByRole('link', { name: /^Open workspace/ }).first().click();
  await page.waitForURL(/\/portal\/foundation\/command/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Command Center', level: 1 })).toBeVisible();
  // The pinned-in manager banner is present (layout.tsx) — assert the unique Exit link.
  await expect(page.getByRole('link', { name: /Exit to partner console/ })).toBeVisible();
  await page.screenshot({ path: `${DIR}/07-partner-descended-cc.png`, fullPage: true });
});
