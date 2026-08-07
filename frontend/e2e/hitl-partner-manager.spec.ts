/**
 * Partner-manager E2E (docs/PARTNER_MANAGER_DESIGN.md). Drives the real UI as Paul Jackson
 * (partner_admin) through the console, the add-company precheck branches, and descend/ascend.
 *
 * Self-authenticating (the `hitl` project has no storageState). Requires a running, seeded
 * instance at TEST_BASE_URL with the partner seeded (migs 157–161) and Paul's password set to
 * E2E_PARTNER_PW. Run: `npx playwright test --project=hitl hitl-partner-manager`.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_PARTNER_EMAIL || 'pjackson@ecinnovates.com';
const PW = process.env.E2E_PARTNER_PW || 'DemoPass123!';

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('partner lands on the console with their own org + stable', async ({ page }) => {
  await login(page);
  await page.goto('/partner');
  await expect(page.locator('h1')).toHaveText(/Partner Console/i);
  await expect(page.getByRole('heading', { name: /Your organization/i })).toBeVisible();
  await expect(page.getByText(/Entrepreneurs.? Center/i).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Supported companies/i })).toBeVisible();
});

test('add-company precheck routes an existing name to the manager-request branch', async ({ page }) => {
  await login(page);
  await page.goto('/partner');
  await page.getByRole('button', { name: /Add a company/i }).click();
  await page.locator('input').nth(0).fill('Foundation');
  await page.locator('input').nth(1).fill('Test Admin');
  await page.locator('input').nth(2).fill('collide@foundation-e2e.test');
  await page.getByRole('button', { name: /Continue/i }).click();
  await expect(page.getByText(/already exists on RFP Pipeline/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Request manager access/i })).toBeVisible();
});

test('add-company precheck routes a new name to the onboarding form', async ({ page }) => {
  await login(page);
  await page.goto('/partner');
  await page.getByRole('button', { name: /Add a company/i }).click();
  await page.locator('input').nth(0).fill('Skyline Robotics E2E');
  await page.locator('input').nth(1).fill('Grace Hopper');
  await page.locator('input').nth(2).fill('grace@skyline-e2e.test');
  await page.getByRole('button', { name: /Continue/i }).click();
  await expect(page.getByText(/New company .? details/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Submit for approval/i })).toBeVisible();
});

test('partner descends into a managed company and can ascend back', async ({ page }) => {
  await login(page);
  // Descend via the partner-scoped enter route into Foundation (Paul manages it).
  await page.goto('/api/partner/enter?slug=foundation');
  await expect(page).toHaveURL(/\/portal\/foundation/);
  await expect(page.getByText(/Managing .* as a partner-manager/i)).toBeVisible();
  // Ascend back to the console.
  await page.getByRole('link', { name: /Exit to partner console/i }).click();
  await expect(page).toHaveURL(/\/partner/);
  await expect(page.locator('h1')).toHaveText(/Partner Console/i);
});
