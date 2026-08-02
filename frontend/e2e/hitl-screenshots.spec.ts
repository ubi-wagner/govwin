/**
 * HITL screenshots — the visual manual. Logs in as each actor and captures a full-page PNG of
 * every key surface into e2e/screenshots/. Each shot is also asserted to have rendered (not
 * 500 / blank / auth-bounce) so the manual can't silently contain a broken page.
 *
 * Cohorts: e2e-* on acme-navy (E2ETest!2026) + Foundation/Paul (DemoPass123!). See E2E_HITL_RUNBOOK.md.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const E2E_PW = process.env.E2E_PW || 'E2ETest!2026';
const FOUNDATION_PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const DIR = 'e2e/screenshots';
const TVSF_PROPOSAL = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const TVSF_SECTION = 'e43e02fd-798b-4d46-a95f-1e158ce67704';

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });

async function login(page: Page, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced to /login`).not.toHaveURL(/\/login/);
}

/** Go to a surface, assert it rendered, screenshot it full-page. */
async function shot(page: Page, name: string, url: string) {
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 40_000 });
  const status = resp?.status() ?? 0;
  expect(new URL(page.url()).pathname, `${name} bounced to /login`).not.toMatch(/^\/login/);
  expect(status, `${name} bad status`).toBeLessThan(500);
  const body = await page.textContent('body').catch(() => '');
  expect(body && /Application error|Internal Server Error/i.test(body), `${name} rendered an error page`).toBeFalsy();
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

test('master_admin — the oversight manual', async ({ page }) => {
  await login(page, 'e2e-master@rfppipeline.test', E2E_PW);
  await shot(page, '01-master-dashboard', '/admin/dashboard');
  await shot(page, '02-master-agents-roster', '/admin/agents');      // F6: 35 archetypes + dormant
  await shot(page, '03-master-events-audit', '/admin/events');
  await shot(page, '04-master-tenants', '/admin/tenants');
  await shot(page, '05-master-purchases', '/admin/purchases');
});

test('rfp_admin — the ingest→curate→release manual', async ({ page }) => {
  await login(page, 'e2e-rfpadmin@rfppipeline.test', E2E_PW);
  await shot(page, '06-rfpadmin-intake', '/admin/intake');
  await shot(page, '07-rfpadmin-opportunities', '/admin/opportunities');
  await shot(page, '08-rfpadmin-curation', '/admin/rfp-curation');
  await shot(page, '09-rfpadmin-purchases', '/admin/purchases');
});

test('tenant_admin (Foundation/Paul) — the customer build manual', async ({ page }) => {
  await login(page, 'pjackson@ecinnovates.com', FOUNDATION_PW);
  await shot(page, '10-foundation-dashboard', '/portal/foundation/dashboard');
  await shot(page, '11-foundation-buckets', '/portal/foundation/buckets');
  await shot(page, '12-foundation-cards', '/portal/foundation/cards');
  await shot(page, '13-foundation-proposals', '/portal/foundation/proposals');
  await shot(page, '14-foundation-proposal-tvsf', `/portal/foundation/proposals/${TVSF_PROPOSAL}`);
  await shot(page, '15-foundation-section-editor-REHYDRATED', `/portal/foundation/proposals/${TVSF_PROPOSAL}/sections/${TVSF_SECTION}`); // F2
  await shot(page, '16-foundation-atoms-library', '/portal/foundation/atoms');
  await shot(page, '17-foundation-team', '/portal/foundation/team');
});

test('tenant_user + partner_user — the scoped-access manual', async ({ page }) => {
  await login(page, 'e2e-tuser@acme-navy.test', E2E_PW);
  await shot(page, '18-tenantuser-dashboard', '/portal/acme-navy-systems/dashboard');
  await shot(page, '19-tenantuser-cards', '/portal/acme-navy-systems/cards');
  await login(page, 'e2e-partner@ext.test', E2E_PW);
  await shot(page, '20-partner-vaults', '/vaults');
});
