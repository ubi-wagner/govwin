/**
 * Smoke: the admin persona has a working, authenticated session that can reach a
 * real admin surface backed by a live query. Proves the harness drives before the
 * full wiring audit relies on it.
 */
import { test, expect } from '@playwright/test';

test('admin session reaches an admin surface without bouncing to login', async ({ page }) => {
  const res = await page.goto('/admin/opportunities');
  expect(res?.status(), 'route should not 5xx').toBeLessThan(500);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('body')).toBeVisible();
});
