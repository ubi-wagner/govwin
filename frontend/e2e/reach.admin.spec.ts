/**
 * Reachability sweep (admin persona): every static admin page should load for an
 * authenticated admin without a 5xx or a bounce to /login. Reports a status table;
 * fails only on 5xx (a hard break). Dynamic [id] routes are covered by driven flows.
 */
import { test, expect } from '@playwright/test';

const ADMIN_ROUTES = [
  '/admin/dashboard', '/admin/opportunities', '/admin/rfp-curation', '/admin/rfp-curation/upload',
  '/admin/templates', '/admin/section-standards', '/admin/purchases', '/admin/tenants', '/admin/cards',
  '/admin/pipeline', '/admin/process', '/admin/processes', '/admin/proposals', '/admin/events',
  '/admin/analytics', '/admin/automation', '/admin/intake', '/admin/sources', '/admin/storage',
  '/admin/system', '/admin/system-state', '/admin/waitlist', '/admin/guardrail-defaults',
  '/admin/workflows', '/admin/agents', '/admin/billing', '/admin/crm', '/admin/documents',
  '/admin/applications', '/admin/site',
];

test('admin pages reachability sweep', async ({ page }) => {
  const rows: Array<{ route: string; status: number; url: string }> = [];
  for (const route of ADMIN_ROUTES) {
    let status = 0;
    try {
      const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
      status = res?.status() ?? 0;
    } catch (e) {
      status = -1;
    }
    rows.push({ route, status, url: new URL(page.url()).pathname });
  }
  // eslint-disable-next-line no-console
  console.log('\nADMIN REACHABILITY:\n' + rows.map((r) => {
    const bounced = /\/login/.test(r.url) ? ' ⤳LOGIN' : '';
    const flag = r.status >= 500 || r.status < 0 ? ' ✗5xx' : r.status >= 400 ? ' ⚠4xx' : '';
    return `  ${String(r.status).padStart(4)}  ${r.route}${bounced}${flag}`;
  }).join('\n'));
  const server5xx = rows.filter((r) => r.status >= 500 || r.status === -1);
  expect(server5xx, `5xx/crash on: ${server5xx.map((r) => `${r.route}(${r.status})`).join(', ')}`).toEqual([]);
});
