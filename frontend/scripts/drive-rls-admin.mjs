/**
 * Admin-side RLS proof (docs/RLS_CUTOVER.md P5). App connected as govtech_app (NOBYPASSRLS).
 * Log in as the platform admin (master_admin) and GET the cross-tenant admin routes. These
 * legitimately span tenants, so under govtech_app they DENY-ALL unless the route reads via the
 * owner `sqlBypass` pool. A route that reads an RLS'd table without bypass surfaces as a 500,
 * a 200-but-empty where cross-tenant data exists, or a tenants list that sees <2 tenants.
 *   node scripts/drive-rls-admin.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { resolveActor, loginOrDie, dieWell, CannotRun } from './lib/drive-actor.mjs';
import { clientHeaders } from './lib/client-ip.mjs';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }
const sql = postgres(DB, { max: 2 });
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const IMMO = 'dd831b77-2d6b-4b53-bb18-4d48569a2258';

// mode: 'multi' expect 200 + ≥2 tenants (cross-tenant proof); 'data' expect 200 + non-empty; 'ok' expect 200 (not 500)
/**
 * THREE PROBES WERE REMOVED HERE, and their absence is the point.
 *
 * `/api/admin/dashboard`, `/api/admin/purchases` and `/api/admin/processes` do not exist and are
 * not missing: those admin surfaces are SERVER COMPONENTS that read the database directly, so they
 * never had an API route to probe. All three returned 404 — and this drive labelled a 404
 * "empty (possible DENY-ALL)", reporting three phantom security failures on every run.
 *
 * A route that does not exist is not a denial. Those surfaces are covered where they actually live,
 * by `verify-surfaces`, which renders them as the real actor.
 *
 * `tenantId` is resolved at run time; it used to be a pinned uuid that stopped matching any tenant
 * after the database was rebuilt, which is how the fourth phantom appeared.
 */
const routesFor = (tenantId) => [
  ['tenants (ALL tenants — cross-tenant)', `/api/admin/tenants`, 'multi'],
  ['tenants/[id] (any-tenant admin view)', `/api/admin/tenants/${tenantId}`, 'data'],
  ['workflows (process_instances)', `/api/admin/workflows`, 'ok'],
  ['tasks (admin triage)', `/api/admin/tasks`, 'ok'],
  ['agents', `/api/admin/agents`, 'ok'],
  ['agents/workforce (agent_task_queue rollup)', `/api/admin/agents/workforce`, 'ok'],
  ['agents/usage', `/api/admin/agents/usage`, 'ok'],
  ['section-standards', `/api/admin/section-standards`, 'ok'],
  ['templates', `/api/admin/templates`, 'ok'],
  ['guardrail-defaults', `/api/admin/guardrail-defaults`, 'ok'],
];

/**
 * Login lives in scripts/lib/drive-actor.mjs now, and it PROVES the session took.
 *
 * The old local copy ended with `.catch(() => {})` on the post-submit navigation and returned the
 * page either way. Paired with a pinned password that had been rotated (`Sandbox2026!` — the real
 * one is SandboxDrive2026!), this drive measured a logged-out browser and reported every admin
 * route as a DENY-ALL. See docs/E2E_SWEEP_2026-08-23.md §3.
 */

function tenantCount(data) {
  const arr = Array.isArray(data) ? data
    : data && Array.isArray(data.tenants) ? data.tenants
    : data && Array.isArray(data.data) ? data.data
    : data && data.data && Array.isArray(data.data.tenants) ? data.data.tenants : null;
  return arr ? arr.length : -1;
}

async function main() {
  // Resolved, not pinned: a re-seed cannot rot this.
  const admin = await resolveActor(sql, { role: 'master_admin' });
  const [anyTenant] = await sql`SELECT id, slug FROM tenants ORDER BY created_at LIMIT 1`;
  if (!anyTenant) throw new CannotRun('no tenants on this box — the cross-tenant admin proof has nothing to read');
  const ROUTES = routesFor(anyTenant.id);
  console.log(`cross-tenant target: ${anyTenant.slug}`);
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ extraHTTPHeaders: clientHeaders() });
  const p = await loginOrDie(ctx, BASE, admin);
  console.log(`admin ${admin.email} → ${p.url()}`);
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
      else if (mode === 'data') { ok = status === 200 && len > 20; note = ok ? '' : (status === 404 ? 'HTTP 404 — no such route, NOT a denial' : 'empty (possible DENY-ALL)'); }
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
  await sql.end();
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch(async (e) => { await sql.end().catch(() => {}); dieWell(e); });
