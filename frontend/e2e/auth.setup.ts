/**
 * Playwright auth setup — logs in through the real Credentials form and saves a
 * storageState per persona, so every spec reuses an authenticated session
 * instead of logging in again. This is the foundation the wiring audit drives on
 * (docs/HITL_WIRING_AUDIT_RUNBOOK.md). Requires a running, seeded instance
 * (scripts/seed_dev_accounts.mjs) at TEST_BASE_URL.
 */
import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR = path.join(__dirname, '.auth');
fs.mkdirSync(AUTH_DIR, { recursive: true });

// Passwords match scripts/seed_dev_accounts.mjs defaults (override via env).
const ACCOUNTS = {
  admin: {
    email: 'eric@rfppipeline.com',
    password: process.env.RFP_ADMIN_PW || 'RFPAdmin2026!',
    file: 'admin.json',
    landing: '/admin/dashboard',
  },
  lighthouse: {
    email: 'eric@lighthouse.com',
    password: process.env.LIGHTHOUSE_PW || 'LighthouseAdmin',
    file: 'lighthouse.json',
    landing: '/portal/lighthouse/dashboard',
  },
} as const;

for (const [name, acct] of Object.entries(ACCOUNTS)) {
  setup(`authenticate ${name}`, async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', acct.email);
    await page.fill('input[name="password"]', acct.password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    // Prove the cookie actually authenticates by loading a gated page.
    await page.goto(acct.landing);
    await expect(page, `${name} should not bounce back to /login`).not.toHaveURL(/\/login/);
    await page.context().storageState({ path: path.join(AUTH_DIR, acct.file) });
  });
}
