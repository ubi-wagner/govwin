/**
 * Blocker-fix drive: screenshots the five changed surfaces against a live seeded
 * instance. Self-contained — logs in per persona (fresh context), no storageState
 * dependency. Run: npx playwright test e2e/zzblockers.tenant.spec.ts --project=tenant --no-deps
 *
 * Data seeded out-of-band (see the session's seed step):
 *  - member@ubihere.com  : base tenant_user in a zero-proposal tenant (ubihere)
 *  - proposal a1b2c3d4-…001 in lighthouse: stage='submitted', is_locked, lock_count=1
 *  - one pinned lighthouse card (Purchase button visible)
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = path.join(__dirname, '..', 'blocker-shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Ignore any project storageState — we authenticate explicitly per test.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1360, height: 940 } });
test.describe.configure({ mode: 'serial' });

const PROP = 'a1b2c3d4-0000-4000-8000-000000000001';
const OPP_FOR_FREE_PORTAL = '223f57f4-d6c4-47d6-8795-2f0c46a61c06'; // a lighthouse opp w/o an existing portal

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('1 — RFP-Admin free-portal approval form (expert-gated, audited as purchased)', async ({ page }) => {
  await login(page, 'eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
  await page.goto('/portal/lighthouse/portals');
  // Descending into a tenant as an RFP admin raises a shadow-consent modal — acknowledge it.
  const consent = page.getByRole('button', { name: /I understand/i });
  if (await consent.isVisible().catch(() => false)) {
    await consent.click();
    await expect(consent).toBeHidden();
  }
  await expect(page.getByText(/approve a free portal/i)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-freeportal-form.png`, fullPage: true });

  // Approve one — records a $0 audited purchase.
  await page.fill('input[placeholder="opportunity uuid"]', OPP_FOR_FREE_PORTAL);
  await page.getByRole('button', { name: /Approve free portal/i }).click();
  // The new guardrails_pending portal card should appear.
  await expect(page.getByText(/guardrails pending/i).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/02-freeportal-approved.png`, fullPage: true });
});

test('2a — Cold-start checklist shows to an admin who can act', async ({ page }) => {
  await login(page, 'eric@ubihere.com', process.env.UBIHERE_PW || 'UbihereAdmin');
  await page.goto('/portal/ubihere/dashboard');
  await expect(page.getByText('Get started')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-coldstart-admin-checklist.png`, fullPage: true });
});

test('2b — Base team member sees the honest "you\'re on the team" card (no redirect-trap)', async ({ page }) => {
  await login(page, 'member@ubihere.com', process.env.MEMBER_PW || 'MemberPass1');
  await page.goto('/portal/ubihere/dashboard');
  await expect(page.getByText(/You're on the team/i)).toBeVisible();
  await expect(page.getByText(/ask your admin/i)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-coldstart-baseuser-waiting.png`, fullPage: true });
});

test('3 — Post-submit "Unlock for Edit" button renders (dead-end gone)', async ({ page }) => {
  await login(page, 'eric@lighthouse.com', process.env.LIGHTHOUSE_PW || 'LighthouseAdmin');
  await page.goto(`/portal/lighthouse/proposals/${PROP}`);
  await expect(page.getByRole('button', { name: /Unlock for Edit/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/05-postsubmit-unlock-button.png`, fullPage: true });
});

test('4 — Purchase modal shows the friendly Stripe fallback (not a raw 500)', async ({ page }) => {
  await login(page, 'eric@lighthouse.com', process.env.LIGHTHOUSE_PW || 'LighthouseAdmin');
  await page.goto('/portal/lighthouse/cards');
  await page.getByRole('button', { name: /^Purchase$/ }).first().click();
  await expect(page.getByRole('button', { name: /Pay by card/i })).toBeVisible();
  await page.getByRole('button', { name: /Pay by card/i }).click();
  await expect(page.getByText(/not available yet|use an access code/i)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/06-purchase-stripe-fallback.png`, fullPage: true });
});
