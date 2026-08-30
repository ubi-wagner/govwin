/**
 * App-level RLS proof retargeted to the FOUNDATION tenant (this DB's real seed).
 * App connected as govtech_app (NOBYPASSRLS). Log in as the Foundation tenant admin and GET
 * every data-bearing portal route with REAL ids. A route that reads a forced table without
 * pinning tenant context DENY-ALLs → 500 / 404-on-valid-id / 200-but-empty. Plus a cross-tenant
 * NEGATIVE: a Foundation login requesting another tenant's atom id MUST 404/empty.
 *   node scripts/drive-rls-portal-fnd.mjs
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const S = 'foundation';
const LOGIN = { email: 'kate.ulepic@foundation3dp.com', pw: 'DemoPass123!' };
// real Foundation ids (owner-fetched)
const PROP = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const BUCKET = '5b4306c5-4e42-4a9d-a714-e83a6ca0eb90';
const ATOM = '2c5b86ab-7a42-4126-a793-ed4bbd6ddd75';
const FOREIGN_ATOM = 'cb957b38-d417-4fb7-b709-3e85e4292638'; // owned by rfp-pipeline tenant → must be invisible

const ROUTES = [
  ['cards', `/api/portal/${S}/cards`, 'any'],
  ['buckets', `/api/portal/${S}/buckets`, 'list'],
  ['buckets/[id]', `/api/portal/${S}/buckets/${BUCKET}`, 'detail'],
  ['proposals', `/api/portal/${S}/proposals`, 'list'],
  ['proposals/[id]', `/api/portal/${S}/proposals/${PROP}`, 'detail'],
  ['proposals/[id]/sections', `/api/portal/${S}/proposals/${PROP}/sections`, 'detail'],
  ['proposals/[id]/activity', `/api/portal/${S}/proposals/${PROP}/activity`, 'detail'],
  ['proposals/[id]/comments', `/api/portal/${S}/proposals/${PROP}/comments`, 'detail'],
  ['proposals/[id]/compliance', `/api/portal/${S}/proposals/${PROP}/compliance`, 'detail'],
  ['proposals/[id]/collaborators', `/api/portal/${S}/proposals/${PROP}/collaborators`, 'detail'],
  ['proposals/[id]/supporting-docs', `/api/portal/${S}/proposals/${PROP}/supporting-docs`, 'detail'],
  ['team', `/api/portal/${S}/team`, 'list'],
  ['vaults', `/api/portal/${S}/vaults`, 'any'],
  ['atoms', `/api/portal/${S}/atoms`, 'list'],
  ['atoms/[id]', `/api/portal/${S}/atoms/${ATOM}`, 'detail'],
  ['atoms/[FOREIGN] (cross-tenant → DENY)', `/api/portal/${S}/atoms/${FOREIGN_ATOM}`, 'expectDeny'],
  ['library/atoms', `/api/portal/${S}/library/atoms`, 'any'],
  ['library/past-proposals', `/api/portal/${S}/library/past-proposals`, 'any'],
  ['dashboard', `/api/portal/${S}/dashboard`, 'any'],
  ['profile', `/api/portal/${S}/profile`, 'any'],
  ['purchases', `/api/portal/${S}/purchases`, 'any'],
  ['tasks', `/api/portal/${S}/tasks`, 'any'],
  ['notifications', `/api/portal/${S}/notifications`, 'any'],
  ['automation-policies', `/api/portal/${S}/automation-policies`, 'any'],
  ['portals', `/api/portal/${S}/portals`, 'any'],
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
  const p = await login(ctx, LOGIN.email, LOGIN.pw);
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
      if (mode === 'expectDeny') { ok = status === 404 || (status === 200 && /(\[\]|\{\}|null)\s*$/.test(txt.trim())); note = ok ? 'cross-tenant blocked (404/empty)' : `LEAK? ${status} len=${bodyLen}`; }
      else if (status >= 500) { ok = false; note = 'SERVER ERROR'; }
      else if (mode === 'detail' && status === 404) { ok = false; note = 'DENY-ALL (404 on valid id)'; }
      else if (status === 401 || status === 403) { ok = false; note = `auth ${status}`; }
      else if (mode === 'list') {
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
    console.log(`${ok ? '✅' : '❌'} ${label.padEnd(38)} ${String(status).padStart(4)}  len=${String(len).padStart(6)} ${note}`);
  }
  console.log(`\n${fails.length === 0 ? '✅ FOUNDATION PORTAL RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' route(s)'}: ${ROUTES.length - fails.length}/${ROUTES.length}`);
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
