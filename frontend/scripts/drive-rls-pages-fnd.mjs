/**
 * Server-component RLS proof retargeted to FOUNDATION. App as govtech_app (NOBYPASSRLS).
 * Navigate to real pages, assert a forced-data token appears in the server-rendered HTML.
 * A DENY-ALL renders the page empty → token absent. node scripts/drive-rls-pages-fnd.mjs
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const S = 'foundation';
const PROP = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  await p.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await p.locator('#email').fill(email);
  await p.locator('#password').fill(pw);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1200);
  return p;
}

// [label, path, token that MUST appear if the forced query rendered]
const PORTAL = [
  ['proposals (list)', `/portal/${S}/proposals`, 'Round 45'],
  ['proposals/[id] (detail)', `/portal/${S}/proposals/${PROP}`, 'Round 45'],
  ['dashboard', `/portal/${S}/dashboard`, 'Round 45'],
  ['buckets', `/portal/${S}/buckets`, 'Additive Construction'],
  ['atoms (library)', `/portal/${S}/atoms`, 'Competitive Analysis'],
];
const ADMIN = [
  ['admin/proposals (cross-tenant)', `/admin/proposals`, 'Round 45'],
  ['admin/tenants/[id] (any-tenant)', `/admin/tenants/${FND}`, 'Foundation'],
];

async function checkPage(page, path, token) {
  try {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(600);
    const html = await page.content();
    const status = r ? r.status() : 0;
    return { status, has: html.includes(token), len: html.length };
  } catch (e) { return { status: 0, has: false, len: 0, err: String(e).slice(0, 50) }; }
}

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const rows = [];
  const fails = [];

  const tctx = await b.newContext();
  const tp = await login(tctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  console.log('tenant login →', tp.url());
  for (const [label, path, token] of PORTAL) {
    const { status, has, len, err } = await checkPage(tp, path, token);
    const ok = status === 200 && has;
    rows.push([`portal · ${label}`, ok, `${status} · "${token}" ${has ? 'found' : 'MISSING'} · ${len}b${err ? ' · ' + err : ''}`]);
    if (!ok) fails.push(label);
  }
  await tctx.close();

  const actx = await b.newContext();
  const ap = await login(actx, 'eric@rfppipeline.com', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  console.log('admin login →', ap.url());
  for (const [label, path, token] of ADMIN) {
    const { status, has, len, err } = await checkPage(ap, path, token);
    const ok = status === 200 && has;
    rows.push([`admin · ${label}`, ok, `${status} · "${token}" ${has ? 'found' : 'MISSING'} · ${len}b${err ? ' · ' + err : ''}`]);
    if (!ok) fails.push(label);
  }
  await actx.close(); await b.close();

  for (const [m, ok, info] of rows) console.log(`${ok ? '✅' : '❌'} ${m.padEnd(42)} (${info})`);
  console.log(`\n${fails.length === 0 ? '✅ SERVER-COMPONENT RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' page(s) DENY-ALL'}: ${rows.length - fails.length}/${rows.length}`);
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
