/**
 * Server-component RLS proof (docs/RLS_CUTOVER.md P5). App connected as govtech_app (NOBYPASSRLS).
 * Next server components (page.tsx) query forced tables directly and render the HTML server-side —
 * the API drives can't see this. Here we log in and NAVIGATE to real pages, then assert a known
 * forced-data token appears in the rendered HTML. If a page's forced query DENY-ALLs, the token is
 * absent (the page rendered empty). Tokens: DON26BX03 (immobileyes proposal), Autonomy (a bucket),
 * GHOST (a library atom).  node scripts/drive-rls-pages.mjs
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const S = 'immobileyes';
const PROP = '62960c36-80ff-40ee-8879-9a72f42bb8eb';
const IMMO = 'dd831b77-2d6b-4b53-bb18-4d48569a2258';

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
  ['proposals (list)', `/portal/${S}/proposals`, 'DON26BX03'],
  ['proposals/[id] (detail)', `/portal/${S}/proposals/${PROP}`, 'DON26BX03'],
  ['dashboard', `/portal/${S}/dashboard`, 'DON26BX03'],
  ['buckets', `/portal/${S}/buckets`, 'Autonomy'],
  ['cards', `/portal/${S}/cards`, 'Autonomy'],
  // atoms + manage are counts/facets rendered from forced tables (client-lib / server console),
  // so assert a NON-ZERO forced-data string (a DENY-ALL would show 0 / no facets), not a title.
  ['atoms (library facets)', `/portal/${S}/atoms`, 'commercialization'],
  ['manage (spotlight summary)', `/portal/${S}/manage`, '8 OPPs'],
];
const ADMIN = [
  ['admin/proposals (cross-tenant)', `/admin/proposals`, 'DON26BX03'],
  ['admin/tenants/[id] (any-tenant, atom count)', `/admin/tenants/${IMMO}`, '367'],
];

async function checkPage(page, path, token) {
  try {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(600);
    const html = await page.content();
    const status = r ? r.status() : 0;
    const has = html.includes(token);
    return { status, has, len: html.length };
  } catch (e) { return { status: 0, has: false, len: 0, err: String(e).slice(0, 50) }; }
}

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const rows = [];
  const fails = [];

  const tctx = await b.newContext();
  const tp = await login(tctx, 'eric@immobileyes.com', 'Sandbox2026!');
  console.log('tenant login →', tp.url());
  for (const [label, path, token] of PORTAL) {
    const { status, has, len, err } = await checkPage(tp, path, token);
    const ok = status === 200 && has;
    rows.push([`portal · ${label}`, ok, `${status} · "${token}" ${has ? 'found' : 'MISSING'} · ${len}b${err ? ' · ' + err : ''}`]);
    if (!ok) fails.push(label);
  }
  await tctx.close();

  const actx = await b.newContext();
  const ap = await login(actx, 'eric@rfppipeline.com', 'Sandbox2026!');
  console.log('admin login →', ap.url());
  for (const [label, path, token] of ADMIN) {
    const { status, has, len, err } = await checkPage(ap, path, token);
    const ok = status === 200 && has;
    rows.push([`admin · ${label}`, ok, `${status} · "${token}" ${has ? 'found' : 'MISSING'} · ${len}b${err ? ' · ' + err : ''}`]);
    if (!ok) fails.push(label);
  }
  await actx.close(); await b.close();

  for (const [m, ok, info] of rows) console.log(`${ok ? '✅' : '❌'} ${m.padEnd(42)} (${info})`);
  console.log(`\n${fails.length === 0 ? '✅ SERVER-COMPONENT RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' page(s) rendered empty (DENY-ALL)'}: ${rows.length - fails.length}/${rows.length}`);
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
