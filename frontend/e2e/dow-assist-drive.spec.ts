import { test } from '@playwright/test';
const SHOTS = 'public/guides/rfp-ingest';
const SOL = process.env.DRIVE_SOL_ID!;
test('rfp_admin re-runs Ingest Assist now that full_text exists', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await page.goto('/login');
  await page.fill('input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[type="password"]', 'RFPAdmin2026!');
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.goto(`/admin/rfp-curation/${SOL}`);
  await page.waitForLoadState('networkidle');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: /Ingest Assist/i }).first().click();
  await page.waitForTimeout(45_000);          // give the parse room
  await page.screenshot({ path: `${SHOTS}/08-after-ingest-assist.png`, fullPage: true });
  console.log('[drive] assist re-run complete');
});
