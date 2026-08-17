/**
 * Command Center read-receipt drive. A GENUINE acknowledgement (a lane whose new-dot was showing being
 * cleared) emits ONE capture|finder:command.acknowledged audit event; a quiet re-view (hadNew=false)
 * writes only the watermark — no event. Proves the "signal, not per-view noise" rule end-to-end.
 * The event-count delta is asserted by the runner (psql) around this drive.
 * Run: npx playwright test --project=hitl hitl-command-receipt
 */
import { test, expect, type Page } from '@playwright/test';

const PW = process.env.ADMIN_PW || 'RFPAdmin2026!';

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced`).not.toHaveURL(/\/login/);
}

test('command read-receipt: genuine ack marks seen; quiet re-view marks seen', async ({ page }) => {
  await login(page, 'eric@rfppipeline.com'); // rfp_admin → admin CC scope (finder namespace, no tenant)

  // Genuine acknowledgement — the lane WAS flagged new → emits ONE command.acknowledged.
  let r = await page.request.post('/api/command/seen', { data: { scope: 'admin', tab: 'opp', hadNew: true } });
  expect(r.ok(), 'genuine ack recorded').toBeTruthy();

  // Quiet re-view — nothing new → watermark only, NO event.
  r = await page.request.post('/api/command/seen', { data: { scope: 'admin', tab: 'opp', hadNew: false } });
  expect(r.ok(), 'quiet re-view recorded').toBeTruthy();
});
