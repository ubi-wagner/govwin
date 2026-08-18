/**
 * Capture the compliance matrix as the curator sees it, post-mig-187.
 * Every value written by Ingest Assist from DEFAULT_SBIR_CSO_SKELETON must render
 * a red "Default — unverified" badge, never a yellow "AI" one.
 */
import { test } from '@playwright/test';
const SHOTS = 'public/guides/rfp-ingest';
const SOL = process.env.DRIVE_SOL_ID!;

test('curation workspace — compliance matrix provenance', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto('/login');
  await page.fill('input[name="email"], input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[name="password"], input[type="password"]', 'RFPAdmin2026!');
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.goto(`/admin/rfp-curation/${SOL}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/06-curation-workspace.png`, fullPage: true });

  const el = page.locator('#section-compliance, [id*="compliance"]').first();
  if (await el.count()) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/07-compliance-matrix.png`, fullPage: true });
  }
  const badges = await page.getByText('Default — unverified').count();
  console.log(`[drive] "Default — unverified" badges rendered: ${badges}`);
});
