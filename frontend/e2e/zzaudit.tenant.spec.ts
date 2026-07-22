/**
 * Audit-sweep certification drive. Self-contained (fresh logins, no storageState).
 * Run: npx playwright test e2e/zzaudit.tenant.spec.ts --project=tenant --no-deps
 *
 * Proves two of the highest-value audit fixes live:
 *  1. rfp-curation "Customer Interest" panel now reads the live tenant_opportunity_cards
 *     spine (was the RETIRED tenant_pipeline_items → showed nothing). Lighthouse pinned a
 *     card under solicitation 6c8571ca, so the panel must now show Lighthouse.
 *  2. Creating a company emits finder:tenant.created — the DB assert (tenant_id IS NULL,
 *     admin-event convention) runs in a follow-up psql step keyed on the slug below.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = path.join(__dirname, '..', 'blocker-shots');
fs.mkdirSync(SHOTS, { recursive: true });

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1360, height: 940 } });
test.describe.configure({ mode: 'serial' });

const RFP = { email: 'eric@rfppipeline.com', pw: process.env.RFP_ADMIN_PW || 'RFPAdmin2026!' };
const SOL = '6c8571ca-292f-41db-9762-c5055a06e71e';
export const NEW_CO_SLUG = 'audit-proof-co';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('1 — Customer Interest panel reads the live spine (retired-table fix)', async ({ page }) => {
  await login(page, RFP.email, RFP.pw);
  await page.goto(`/admin/rfp-curation/${SOL}`);
  // The repointed pins JOIN must surface Lighthouse (it pinned a card under this solicitation).
  await expect(page.getByText(/Lighthouse/i).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/07-customer-interest-live-spine.png`, fullPage: true });
});

test('2 — Creating a company is auditable (finder:tenant.created)', async ({ page }) => {
  await login(page, RFP.email, RFP.pw);
  await page.goto('/admin/tenants');
  // Open the New Company form and create a uniquely-named test tenant.
  const nameField = page.locator('input[name="name"], input[placeholder*="name" i]').first();
  if (!(await nameField.isVisible().catch(() => false))) {
    const toggle = page.getByRole('button', { name: /New Company|Add Company|New tenant/i }).first();
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
  }
  await page.locator('input[name="name"], input[placeholder*="company" i], input[placeholder*="name" i]').first().fill('Audit Proof Co');
  const slug = page.locator('input[name="slug"], input[placeholder*="slug" i]');
  if (await slug.first().isVisible().catch(() => false)) await slug.first().fill(NEW_CO_SLUG);
  const email = page.locator('input[type="email"], input[name="adminEmail"], input[placeholder*="email" i]').first();
  if (await email.isVisible().catch(() => false)) await email.fill('admin@audit-proof-co.test');
  await page.getByRole('button', { name: /Create( Company)?|Add|Save/i }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/08-new-company-created.png`, fullPage: true });
});
