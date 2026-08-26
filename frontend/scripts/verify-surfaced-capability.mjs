#!/usr/bin/env node
/**
 * verify-surfaced-capability.mjs — photograph the two capabilities the reconciliation surfaced.
 *
 * `reconcile-capability.mjs` finds backend capability with no way in; this proves the way in now
 * exists, in a browser, against a running build, as the real actor. Both findings were confirmed
 * from the atlas images before being fixed, so both are re-shot here in the same frame for a
 * before/after a person can hold side by side:
 *
 *   1. Billing → Purchase History names WHAT each purchase bought. The route
 *      `/api/portal/[slug]/purchases` had always joined `proposal_title` / `opportunity_title`;
 *      nothing called it, and the page's own query selected neither, so three portal purchases
 *      rendered as three identical rows (docs/ui-atlas/tenant__portal-tenantSlug-billing.jpg).
 *   2. /admin/site/[pageKey] → the page's full publish history. `getVersions()` and
 *      `GET …/pages/[pageKey]/versions` both existed with no caller; the editor could only ever
 *      say "Live v7 · Draft v8".
 *
 * It asserts, not just captures — a screenshot of a broken page is still a screenshot.
 *
 *   node scripts/verify-surfaced-capability.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join('/home/user/govwin/docs/ui-surfaced');
const TENANT = process.env.TENANT_EMAIL || 'kate.ulepic@foundation3dp.com';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const ADMIN = process.env.RFP_ADMIN_EMAIL || 'eric@rfppipeline.com';
const ADMIN_PW = process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || '';

const fails = [];
const check = (ok, why) => { console.log(`  ${ok ? '✓' : '✗'} ${why}`); if (!ok) fails.push(why); };

// Auth must go through localhost, not 127.0.0.1 — the session cookie is host-scoped and the
// callback bounces otherwise (docs/CONTINUATION.md §2).
async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
}

const shot = async (page, name) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, fullPage: true });
};

/**
 * IS THE SERVER OLDER THAN THE BUILD?
 *
 * The first run of this script reported both features missing. Both were present: a `next-server`
 * from an earlier drive still held :3000, the new server had died on EADDRINUSE, and the browser was
 * driving a build from an hour before the change. That is the third time in this sweep a stale
 * server has produced a confident, wrong "the feature is not there" — so it is checked, not
 * remembered.
 */
const buildAt = fs.statSync('/home/user/govwin/frontend/.next/BUILD_ID').mtimeMs;
const serverAt = (() => {
  try {
    const pid = fs.readdirSync('/proc').find((d) => /^\d+$/.test(d) && (() => {
      try { return fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').includes('server.js'); } catch { return false; }
    })());
    return pid ? fs.statSync(`/proc/${pid}`).ctimeMs : null;
  } catch { return null; }
})();
if (serverAt != null && serverAt < buildAt) {
  console.log(`  ✗ the server (${new Date(serverAt).toISOString()}) predates the build (${new Date(buildAt).toISOString()})`);
  console.log('    restart it before believing anything below — see docs/CONTINUATION.md §2');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
try {
  // ── 1 · purchase history names the work ────────────────────────────────────
  console.log('── billing: purchase history');
  const tctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const tp = await tctx.newPage();
  await signIn(tp, TENANT, TENANT_PW);
  const slug = new URL(tp.url()).pathname.split('/')[2] || 'foundation3dp';
  await tp.goto(`${BASE}/portal/${slug}/billing`, { waitUntil: 'networkidle' });

  const rows = await tp.$$eval('table tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
  check(rows.length > 0, `purchase history rendered ${rows.length} row(s)`);
  // The defect was rows that could not be told apart. Distinctness IS the contract.
  const distinct = new Set(rows).size;
  check(distinct === rows.length || rows.length === 0,
    `every row is distinguishable (${distinct} distinct of ${rows.length})`);
  const named = rows.filter((r) => /Phase|Portal .|—|:/.test(r)).length;
  check(named > 0, `at least one row names the work it bought (${named})`);
  await shot(tp, 'billing-purchase-history');
  await tctx.close();

  // ── 2 · page version history ───────────────────────────────────────────────
  console.log('── admin/site: version history');
  const actx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const ap = await actx.newPage();
  await signIn(ap, ADMIN, ADMIN_PW);
  await ap.goto(`${BASE}/admin/site/homepage`, { waitUntil: 'networkidle' });

  const toggle = ap.getByRole('button', { name: /version history/i });
  check(await toggle.count() > 0, 'the editor offers a version-history control');
  if (await toggle.count() > 0) {
    await toggle.first().click();
    await ap.waitForTimeout(1200);
    const cells = await ap.$$eval('table td', (tds) => tds.map((t) => t.innerText.trim()));
    check(cells.some((c) => /^v\d+$/.test(c)), `history lists version numbers (${cells.filter((c) => /^v\d+$/.test(c)).join(', ') || 'none'})`);
    await shot(ap, 'admin-site-version-history');
  }
  await actx.close();
} finally {
  await browser.close();
}

console.log(fails.length ? `\n${fails.length} check(s) failed` : `\nall checks passed · images in docs/ui-surfaced/`);
process.exit(fails.length ? 1 : 0);
