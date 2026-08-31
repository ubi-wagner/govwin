/**
 * Admin-side RLS proof (retargeted). App as govtech_app (NOBYPASSRLS). Log in as rfp_admin and
 * GET cross-tenant admin routes — these legitimately span tenants, so under govtech_app they
 * DENY-ALL unless the route reads via the owner sqlBypass pool. A route reading a forced table
 * without bypass surfaces as 500 / empty / <2 tenants. node scripts/drive-rls-admin-fnd.mjs
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';

const ROUTES = [
  ['tenants (ALL tenants — cross-tenant)', `/api/admin/tenants`, 'multi'],
  ['tenants/[id] (any-tenant admin view)', `/api/admin/tenants/${FND}`, 'data'],
  ['sources (cross-tenant discovery)', `/api/admin/sources`, 'ok'],
  ['rfp-curation (platform queue)', `/api/admin/rfp-curation`, 'ok'],
  ['workflows (process_instances)', `/api/admin/workflows`, 'ok'],
  ['tasks (admin triage)', `/api/admin/tasks`, 'ok'],
  ['agents', `/api/admin/agents`, 'ok'],
  ['agents/workforce (agent_task_queue rollup)', `/api/admin/agents/workforce`, 'ok'],
  ['agents/usage', `/api/admin/agents/usage`, 'ok'],
  ['section-standards', `/api/admin/section-standards`, 'ok'],
  ['templates', `/api/admin/templates`, 'ok'],
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

function tenantCount(data) {
  const arr = Array.isArray(data) ? data
    : data && Array.isArray(data.tenants) ? data.tenants
    : data && Array.isArray(data.data) ? data.data
    : data && data.data && Array.isArray(data.data.tenants) ? data.data.tenants : null;
  return arr ? arr.length : -1;
}

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext();
  const p = await login(ctx, 'eric@rfppipeline.com', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  console.log('admin login →', p.url());
  const rows = [];
  const fails = [];
  for (const [label, path, mode] of ROUTES) {
    let status = 0, len = 0, note = '', ok = false;
    try {
      const r = await ctx.request.get(`${BASE}${path}`);
      status = r.status();
      const txt = await r.text();
      len = txt.length;
      let body = null; try { body = JSON.parse(txt); } catch { /* */ }
      const data = body && (body.data ?? body);
      if (status >= 500) { ok = false; note = 'SERVER ERROR'; }
      else if (status === 401 || status === 403) { ok = false; note = `auth ${status}`; }
      else if (mode === 'multi') { const n = tenantCount(data); ok = status === 200 && n >= 2; note = `sees ${n} tenants`; }
      else if (mode === 'data') { ok = status === 200 && len > 20; note = ok ? '' : 'empty (possible DENY-ALL)'; }
      else { ok = status === 200; }
    } catch (e) { note = String(e).slice(0, 50); }
    rows.push([label, status, len, ok, note]);
    if (!ok) fails.push(label);
  }
  await ctx.close(); await b.close();
  for (const [label, status, len, ok, note] of rows) {
    console.log(`${ok ? '✅' : '❌'} ${label.padEnd(44)} ${String(status).padStart(4)}  len=${String(len).padStart(6)} ${note}`);
  }
  console.log(`\n${fails.length === 0 ? '✅ ADMIN RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' admin route(s)'}: ${ROUTES.length - fails.length}/${ROUTES.length}`);
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
