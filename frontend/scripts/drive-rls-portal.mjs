/**
 * Comprehensive app-level RLS proof (docs/RLS_CUTOVER.md P5). App connected as govtech_app
 * (NOBYPASSRLS). Log in as the immobileyes tenant admin and GET every data-bearing portal
 * route (list + detail with REAL ids). A route that reads an RLS-forced table without pinning
 * the tenant context DENY-ALLs — surfacing as a 500 (query error), a 404 on a valid id (row
 * "not found"), or a 200 with an empty body where data exists. Any of those = a missed choke
 * point. 401/403 would be an auth problem (not what we test). Run:  node scripts/drive-rls-portal.mjs
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const S = 'immobileyes';
// real immobileyes ids (owner-fetched)
const PROP = '62960c36-80ff-40ee-8879-9a72f42bb8eb';
const BUCKET = 'f3d22fc8-4a11-4584-a829-c1597103900c';
const VAULT = 'eb11718e-7a5e-4659-aab0-0664351d3034';
const ATOM = '3dc03e8f-a615-49b4-90bc-b690d1ea09e3';

// mode: 'list' expect 200 (data-bearing); 'detail' expect 200 NOT 404 (valid id); 'any' expect not 500
const ROUTES = [
  ['cards', `/api/portal/${S}/cards`, 'list'],
  ['buckets', `/api/portal/${S}/buckets`, 'list'],
  ['buckets/[id]', `/api/portal/${S}/buckets/${BUCKET}`, 'detail'],
  ['proposals', `/api/portal/${S}/proposals`, 'list'],
  ['proposals/[id]', `/api/portal/${S}/proposals/${PROP}`, 'detail'],
  ['proposals/[id]/sections', `/api/portal/${S}/proposals/${PROP}/sections`, 'detail'],
  ['proposals/[id]/activity', `/api/portal/${S}/proposals/${PROP}/activity`, 'detail'],
  ['proposals/[id]/comments', `/api/portal/${S}/proposals/${PROP}/comments`, 'detail'],
  ['proposals/[id]/compliance', `/api/portal/${S}/proposals/${PROP}/compliance`, 'detail'],
  ['proposals/[id]/collaborators', `/api/portal/${S}/proposals/${PROP}/collaborators`, 'detail'],
  ['proposals/[id]/gates', `/api/portal/${S}/proposals/${PROP}/gates`, 'detail'],
  ['proposals/[id]/stage', `/api/portal/${S}/proposals/${PROP}/stage`, 'detail'],
  ['proposals/[id]/seed-job (admin-only→403)', `/api/portal/${S}/proposals/${PROP}/seed-job`, 'expect403'],
  ['proposals/[id]/supporting-docs', `/api/portal/${S}/proposals/${PROP}/supporting-docs`, 'detail'],
  ['team', `/api/portal/${S}/team`, 'list'],
  ['vaults', `/api/portal/${S}/vaults`, 'list'],
  ['vaults/[id]/atoms', `/api/portal/${S}/vaults/${VAULT}/atoms`, 'detail'],
  ['vaults/[id]/members', `/api/portal/${S}/vaults/${VAULT}/members`, 'detail'],
  ['atoms', `/api/portal/${S}/atoms`, 'list'],
  ['atoms/[id]', `/api/portal/${S}/atoms/${ATOM}`, 'detail'],
  ['library/atoms', `/api/portal/${S}/library/atoms`, 'any'],
  ['library/past-proposals', `/api/portal/${S}/library/past-proposals`, 'any'],
  ['dashboard', `/api/portal/${S}/dashboard`, 'any'],
  ['profile', `/api/portal/${S}/profile`, 'any'],
  ['purchases', `/api/portal/${S}/purchases`, 'any'],
  ['tasks', `/api/portal/${S}/tasks`, 'any'],
  ['notifications', `/api/portal/${S}/notifications`, 'any'],
  ['expert-time', `/api/portal/${S}/expert-time`, 'any'],
  ['guardrail-templates', `/api/portal/${S}/guardrail-templates`, 'any'],
  ['automation-policies', `/api/portal/${S}/automation-policies`, 'any'],
  ['automation-overview', `/api/portal/${S}/automation-overview`, 'any'],
  ['portals', `/api/portal/${S}/portals`, 'any'],
  ['agents/usage', `/api/portal/${S}/agents/usage`, 'any'],
  ['section-standards', `/api/portal/${S}/section-standards`, 'any'],
  ['templates', `/api/portal/${S}/templates`, 'any'],
  ['taxonomy', `/api/portal/${S}/taxonomy`, 'any'],
];

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

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext();
  const p = await login(ctx, 'eric@immobileyes.com', 'Sandbox2026!');
  console.log('login →', p.url());
  const fails = [];
  const rows = [];
  for (const [label, path, mode] of ROUTES) {
    let status = 0, bodyLen = 0, note = '';
    try {
      const r = await ctx.request.get(`${BASE}${path}`);
      status = r.status();
      const txt = await r.text();
      bodyLen = txt.length;
      let ok;
      if (mode === 'expect403') { ok = status === 403; note = ok ? 'admin-only (correct 403)' : `expected 403, got ${status}`; }
      else if (mode === 'expect410') { ok = status === 410; note = ok ? 'retired (correct 410)' : `expected 410, got ${status}`; }
      else if (status >= 500) { ok = false; note = 'SERVER ERROR'; }
      else if (mode === 'detail' && status === 404) { ok = false; note = 'DENY-ALL (404 on valid id)'; }
      else if (status === 401 || status === 403) { ok = false; note = `auth ${status}`; }
      else if (mode === 'list') {
        // data-bearing: body should be non-trivial (immobileyes has rows)
        ok = status === 200 && bodyLen > 20 && !/\[\]\}?$/.test(txt.trim().slice(-3));
        if (!ok && status === 200) note = 'empty (possible DENY-ALL)';
      } else { ok = status < 400; }
      rows.push([label, status, bodyLen, ok, note]);
      if (!ok) fails.push(label);
    } catch (e) {
      rows.push([label, 'ERR', 0, false, String(e).slice(0, 60)]);
      fails.push(label);
    }
  }
  await ctx.close(); await b.close();
  for (const [label, status, len, ok, note] of rows) {
    console.log(`${ok ? '✅' : '❌'} ${label.padEnd(34)} ${String(status).padStart(4)}  len=${String(len).padStart(6)} ${note}`);
  }
  console.log(`\n${fails.length === 0 ? '✅ COMPREHENSIVE PORTAL RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' route(s) DENY-ALL/error'}: ${ROUTES.length - fails.length}/${ROUTES.length}`);
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
