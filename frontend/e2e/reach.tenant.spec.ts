/**
 * Reachability sweep (tenant persona): every static customer portal page should
 * load for the Lighthouse tenant admin without a 5xx or a bounce to /login.
 * Reports a status table; fails only on 5xx.
 */
import { test, expect } from '@playwright/test';

const BASE = '/portal/lighthouse';
// Canonical customer surface (design A). `spotlights` + `pipeline` are now
// redirects onto `cards`/`buckets` (see redirect.tenant.spec.ts), so they're not
// in this page-load sweep — their destination `cards` is.
const PORTAL_ROUTES = [
  'dashboard', 'library', 'library/upload', 'library/review',
  'cards', 'buckets', 'atoms', 'portals', 'proposals', 'processes', 'activity', 'team',
  'documents', 'billing', 'profile', 'automation', 'agents',
].map((p) => `${BASE}/${p}`);

test('tenant portal pages reachability sweep', async ({ page }) => {
  const rows: Array<{ route: string; status: number; url: string }> = [];
  for (const route of PORTAL_ROUTES) {
    let status = 0;
    // A genuine HTTP 500 resolves (goto only throws on a NAVIGATION failure), so a real
    // server error still surfaces as status>=500 and fails. The intermittent `-1` was a
    // transient client-side navigation abort under the rapid sequential sweep — wait for
    // full `load` + a per-route timeout, and retry ONCE so a one-off abort self-heals.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await page.goto(route, { waitUntil: 'load', timeout: 30_000 });
        status = res?.status() ?? 0;
        break;
      } catch {
        status = -1;
      }
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
