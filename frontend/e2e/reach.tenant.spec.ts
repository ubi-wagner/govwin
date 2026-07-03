/**
 * Reachability sweep (tenant persona): every static customer portal page should
 * load for the Lighthouse tenant admin without a 5xx or a bounce to /login.
 * Reports a status table; fails only on 5xx.
 */
import { test, expect } from '@playwright/test';

const BASE = '/portal/lighthouse';
const PORTAL_ROUTES = [
  'dashboard', 'spotlights', 'pipeline', 'library', 'library/upload', 'library/review',
  'cards', 'buckets', 'atoms', 'portals', 'proposals', 'processes', 'activity', 'team',
  'documents', 'billing', 'profile', 'automation', 'agents',
].map((p) => `${BASE}/${p}`);

test('tenant portal pages reachability sweep', async ({ page }) => {
  const rows: Array<{ route: string; status: number; url: string }> = [];
  for (const route of PORTAL_ROUTES) {
    let status = 0;
    try {
      const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
      status = res?.status() ?? 0;
    } catch {
      status = -1;
    }
    rows.push({ route, status, url: new URL(page.url()).pathname });
  }
  // eslint-disable-next-line no-console
  console.log('\nTENANT REACHABILITY:\n' + rows.map((r) => {
    const bounced = /\/login/.test(r.url) ? ' ⤳LOGIN' : '';
    const flag = r.status >= 500 || r.status < 0 ? ' ✗5xx' : r.status >= 400 ? ' ⚠4xx' : '';
    return `  ${String(r.status).padStart(4)}  ${r.route}${bounced}${flag}`;
  }).join('\n'));
  const server5xx = rows.filter((r) => r.status >= 500 || r.status === -1);
  expect(server5xx, `5xx/crash on: ${server5xx.map((r) => `${r.route}(${r.status})`).join(', ')}`).toEqual([]);
});
