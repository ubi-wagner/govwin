/**
 * Screenshot capture — CUSTOMER-ADMIN persona (lighthouse.json via the `tenant` project).
 * Drives the customer portal (cards spine, buckets/scoring, atoms library, proposals,
 * documents, activity, automation) → docs/manuals/img/tenant/. Run:
 *   npx playwright test e2e/zzscreens.tenant.spec.ts --project=tenant --no-deps
 */
import { test } from '@playwright/test';
import path from 'path';

const OUT = path.join(__dirname, '..', '..', 'docs', 'manuals', 'img', 'tenant');
const T = '/portal/lighthouse';

const ROUTES: Array<[string, string]> = [
  ['portal-dashboard', `${T}/dashboard`],
  ['portal-cards', `${T}/cards`],                 // canonical opportunity surface
  ['portal-buckets', `${T}/buckets`],             // scoring criteria (re-ranks on edit)
  ['portal-atoms', `${T}/atoms`],                 // content library (canonical)
  ['portal-proposals', `${T}/proposals`],
  ['portal-documents', `${T}/documents`],
  ['portal-documents-new', `${T}/documents/new`],
  ['portal-activity', `${T}/activity`],           // audit timeline
  ['portal-processes', `${T}/processes`],
  ['portal-automation', `${T}/automation`],       // automation preferences
  ['portal-team', `${T}/team`],
  ['portal-profile', `${T}/profile`],
  ['portal-billing', `${T}/billing`],
];

for (const [name, route] of ROUTES) {
  test(`capture ${name}`, async ({ page }) => {
    const res = await page.goto(route, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => null);
    await page.waitForTimeout(2500);
    const title = await page.title().catch(() => '?');
    const h1 = await page.locator('h1, h2').first().textContent({ timeout: 3000 }).catch(() => '(none)');
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    // eslint-disable-next-line no-console
    console.log(`  ${name}: HTTP ${res?.status() ?? 'nav'} url=${page.url().replace('http://localhost:3000','')} h1="${(h1 ?? '').slice(0,40)}"`);
  });
}
