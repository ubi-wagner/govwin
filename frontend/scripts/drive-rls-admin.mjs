/**
 * Admin-side RLS proof (docs/RLS_CUTOVER.md P5). App connected as govtech_app (NOBYPASSRLS).
 * Log in as the platform admin (master_admin) and GET the cross-tenant admin routes. These
 * legitimately span tenants, so under govtech_app they DENY-ALL unless the route reads via the
 * owner `sqlBypass` pool. A route that reads an RLS'd table without bypass surfaces as a 500,
 * a 200-but-empty where cross-tenant data exists, or a tenants list that sees <2 tenants.
 *   node scripts/drive-rls-admin.mjs
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const IMMO = 'dd831b77-2d6b-4b53-bb18-4d48569a2258';

// mode: 'multi' expect 200 + ≥2 tenants (cross-tenant proof); 'data' expect 200 + non-empty; 'ok' expect 200 (not 500)
const ROUTES = [
  ['tenants (ALL tenants — cross-tenant)', `/api/admin/tenants`, 'multi'],
  ['tenants/[id] (any-tenant admin view)', `/api/admin/tenants/${IMMO}`, 'data'],
  ['dashboard (cross-tenant aggregates)', `/api/admin/dashboard`, 'data'],
  ['purchases (all tenants)', `/api/admin/purchases`, 'ok'],
  ['workflows (process_instances)', `/api/admin/workflows`, 'ok'],
  ['processes', `/api/admin/processes`, 'ok'],
  ['tasks (admin triage)', `/api/admin/tasks`, 'ok'],
  ['agents', `/api/admin/agents`, 'ok'],
  ['agents/workforce (agent_task_queue rollup)', `/api/admin/agents/workforce`, 'ok'],
  ['agents/usage', `/api/admin/agents/usage`, 'ok'],
  ['section-standards', `/api/admin/section-standards`, 'ok'],
  ['templates', `/api/admin/templates`, 'ok'],
  ['guardrail-defaults', `/api/admin/guardrail-defaults`, 'ok'],
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
  const p = await login(ctx, 'eric@rfppipeline.com', 'Sandbox2026!');
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
  console.log(`\n${fails.length === 0 ? '✅ ADMIN RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' admin route(s) DENY-ALL/error'}: ${ROUTES.length - fails.length}/${ROUTES.length}`);
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
