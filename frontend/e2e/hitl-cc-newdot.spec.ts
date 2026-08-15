/**
 * Command Center "new since you last looked" dot — live proof (mig 179 command_seen_state).
 * With Kate's watermarks pre-seeded (todos/activity in the past → items are newer → dot;
 * opp/workflows in the future → nothing newer → no dot), the tenant CC must light up exactly
 * To-dos + Activity, and viewing a tab must clear its dot. Re-seed the watermarks immediately
 * before running. Run: npx playwright test --project=hitl hitl-cc-newdot
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const DIR = process.env.CC_SHOT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/cc-shots';

test.use({ viewport: { width: 1280, height: 900 } });
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

test('new-dot lights up todos+activity (past watermark), not opp+workflows (future)', async ({ page }) => {
  await login(page, 'kate.ulepic@foundation3dp.com');
  await page.goto('/portal/foundation/command', { waitUntil: 'networkidle', timeout: 45_000 });

  // The accent dot is the only sky-500 span in the tab list.
  const dot = (name: RegExp) => page.getByRole('tab', { name }).locator('span.bg-sky-500');

  await expect(dot(/To-dos/), 'To-dos should show a new dot (past watermark)').toBeVisible();
  await expect(dot(/Activity/), 'Activity should show a new dot (past watermark)').toBeVisible();
  await expect(dot(/Opportunities/), 'Opportunities should NOT (future watermark)').toHaveCount(0);
  await expect(dot(/Workflows/), 'Workflows should NOT (future watermark)').toHaveCount(0);

  await page.screenshot({ path: `${DIR}/08-new-dots.png`, fullPage: true });

  // Viewing a tab clears its dot optimistically (and POSTs the watermark).
  await page.getByRole('tab', { name: /To-dos/ }).click();
  await expect(dot(/To-dos/), 'To-dos dot clears on view').toHaveCount(0);
});
