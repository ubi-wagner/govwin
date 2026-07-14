/**
 * Smoke: the tenant persona loads its own portal (tenant-scoped) with the tenant
 * name rendered — i.e. the portal layout's auth + tenant-access check passed and
 * the dashboard's real query ran.
 */
import { test, expect } from '@playwright/test';

test('lighthouse tenant loads its portal dashboard', async ({ page }) => {
  const res = await page.goto('/portal/lighthouse/dashboard');
  expect(res?.status(), 'route should not 5xx').toBeLessThan(500);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText(/Lighthouse/i).first()).toBeVisible();
});
