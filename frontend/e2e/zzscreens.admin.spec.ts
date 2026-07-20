/**
 * Screenshot capture — RFP-ADMIN persona (admin.json storageState via the `admin` project).
 * Drives every key admin surface (esp. the ones shipped this session: workflow catalog +
 * monitor, automation, agents, events) and saves full-page PNGs to docs/manuals/img/admin/.
 * Not an assertion spec — it captures for the role guides. Run:
 *   npx playwright test e2e/zzscreens.admin.spec.ts --project=admin
 */
import { test } from '@playwright/test';
import path from 'path';

const OUT = path.join(__dirname, '..', '..', 'docs', 'manuals', 'img', 'admin');

const ROUTES: Array<[string, string]> = [
  ['admin-dashboard', '/admin/dashboard'],
  ['admin-opportunities', '/admin/opportunities'],
  ['admin-cards', '/admin/cards'],
  ['admin-rfp-curation', '/admin/rfp-curation'],
  ['admin-rfp-upload', '/admin/rfp-curation/upload'],
  ['admin-sources', '/admin/sources'],
  ['admin-scouts', '/admin/scouts'],
  ['admin-purchases', '/admin/purchases'],
  ['admin-applications', '/admin/applications'],
  ['admin-templates', '/admin/templates'],
  ['admin-workflows', '/admin/workflows'],        // NEW: catalog + instances (headline)
  ['admin-automation', '/admin/automation'],      // observability: rules + logs
  ['admin-agents', '/admin/agents'],              // agent workforce roster + usage
  ['admin-events', '/admin/events'],              // event stream
  ['admin-process', '/admin/process'],            // process monitor
  ['admin-processes', '/admin/processes'],        // process ledger
  ['admin-system-state', '/admin/system-state'],
  ['admin-analytics', '/admin/analytics'],
  ['admin-guardrail-defaults', '/admin/guardrail-defaults'],
  ['admin-tenants', '/admin/tenants'],
];

for (const [name, route] of ROUTES) {
  test(`capture ${name}`, async ({ page }) => {
    const res = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Don't fail the whole run on one heavy page; capture whatever rendered.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    // eslint-disable-next-line no-console
    console.log(`  captured ${name} (HTTP ${res?.status()})`);
  });
}
