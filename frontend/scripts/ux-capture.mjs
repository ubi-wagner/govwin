/**
 * UX touch-capture: log in as each real actor, visit every primary surface, and record
 * screenshot + HTTP status + console errors + pageerrors + load time. Owner-mode dev server.
 *   node scripts/ux-capture.mjs
 * Writes PNGs + ux-report.json to the scratchpad ux/ dir.
 */
import { chromium } from 'playwright';
import fs from 'fs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/ux';
const S = 'foundation';
const PROP = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';

const ACTORS = {
  kate:   { email: 'kate.ulepic@foundation3dp.com', pw: 'DemoPass123!', role: 'tenant_admin' },
  eric:   { email: 'eric@rfppipeline.com',          pw: (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'), role: 'rfp_admin' },
  connor: { email: 'connor.casey@foundation3dp.com', pw: 'DemoPass123!', role: 'tenant_user' },
  paul:   { email: 'pjackson@ecinnovates.com',       pw: 'DemoPass123!', role: 'partner' },
};

const SURFACES = {
  kate: [
    ['dashboard', `/portal/${S}/dashboard`],
    ['cards', `/portal/${S}/cards`],
    ['buckets', `/portal/${S}/buckets`],
    ['proposals-list', `/portal/${S}/proposals`],
    ['proposal-detail', `/portal/${S}/proposals/${PROP}`],
    ['atoms-library', `/portal/${S}/atoms`],
    ['team', `/portal/${S}/team`],
    ['profile', `/portal/${S}/profile`],
    ['notifications', `/portal/${S}/notifications`],
    ['tasks', `/portal/${S}/tasks`],
    ['purchases', `/portal/${S}/purchases`],
  ],
  eric: [
    ['admin-home', `/admin`],
    ['admin-proposals', `/admin/proposals`],
    ['admin-tenants', `/admin/tenants`],
    ['admin-workflows', `/admin/workflows`],
    ['admin-agents', `/admin/agents`],
    ['admin-rfp-curation', `/admin/rfp-curation`],
    ['admin-sources', `/admin/sources`],
    ['admin-site', `/admin/site`],
    ['admin-tasks', `/admin/tasks`],
    ['admin-intake', `/admin/intake`],
  ],
  connor: [
    ['dashboard', `/portal/${S}/dashboard`],
    ['proposals-list', `/portal/${S}/proposals`],
    ['proposal-detail', `/portal/${S}/proposals/${PROP}`],
  ],
  paul: [
    ['partner-console', `/partner`],
    ['dashboard-attempt', `/portal/${S}/dashboard`],
  ],
};

// mobile pass (a couple of primary tenant surfaces)
const MOBILE = [
  ['m-dashboard', `/portal/${S}/dashboard`],
  ['m-cards', `/portal/${S}/cards`],
  ['m-proposal-detail', `/portal/${S}/proposals/${PROP}`],
];

async function login(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return page.url();
}

async function capture(ctx, actor, label, path, results, mobile = false) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 140)));
  const t0 = Date.now();
  let status = 0;
  try {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 35000 });
    status = r ? r.status() : 0;
  } catch (e) { errors.push('NAV: ' + String(e).slice(0, 100)); }
  await page.waitForTimeout(800);
  const t = Date.now() - t0;
  const title = await page.title().catch(() => '');
  const finalUrl = page.url();
  const file = `${OUT}/${mobile ? '' : ''}${actor}-${label}.png`;
  await page.screenshot({ path: file, fullPage: !mobile }).catch(() => {});
  results.push({ actor, label, path, status, ms: t, title, finalUrl, errors: errors.slice(0, 6) });
  console.log(`${status === 200 ? '✓' : '⚠'} ${actor}/${label} ${status} ${t}ms ${errors.length ? '· ' + errors.length + ' err' : ''} → ${finalUrl.replace(BASE, '')}`);
  await page.close();
}

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const results = [];
  for (const [actor, cfg] of Object.entries(ACTORS)) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const landed = await login(p, cfg.email, cfg.pw);
    console.log(`\n── ${actor} (${cfg.role}) login → ${landed.replace(BASE, '')}`);
    await p.close();
    for (const [label, path] of SURFACES[actor]) await capture(ctx, actor, label, path, results);
    await ctx.close();
  }
  // mobile pass as kate
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mp = await mctx.newPage();
  await login(mp, ACTORS.kate.email, ACTORS.kate.pw);
  await mp.close();
  console.log('\n── mobile (390×844) as kate');
  for (const [label, path] of MOBILE) await capture(mctx, 'kate', label, path, results, true);
  await mctx.close();
  await b.close();
  fs.writeFileSync(`${OUT}/ux-report.json`, JSON.stringify(results, null, 2));
  const errs = results.filter((r) => r.errors.length).length;
  const slow = results.filter((r) => r.ms > 4000).length;
  console.log(`\n== ${results.length} surfaces · ${errs} with console/page errors · ${slow} slow (>4s) ==`);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
