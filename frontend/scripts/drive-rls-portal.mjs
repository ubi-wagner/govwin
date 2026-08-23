/**
 * Comprehensive app-level RLS proof (docs/RLS_CUTOVER.md P5). App connected as govtech_app
 * (NOBYPASSRLS). Log in as the immobileyes tenant admin and GET every data-bearing portal
 * route (list + detail with REAL ids). A route that reads an RLS-forced table without pinning
 * the tenant context DENY-ALLs — surfacing as a 500 (query error), a 404 on a valid id (row
 * "not found"), or a 200 with an empty body where data exists. Any of those = a missed choke
 * point. 401/403 would be an auth problem (not what we test). Run:  node scripts/drive-rls-portal.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { resolveActor, loginOrDie, dieWell, CannotRun, harnessDbUrl } from './lib/drive-actor.mjs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }
// The harness's OWN reads go through the owner — see harnessDbUrl(). The app under
// test stays on the scoped role; only this bookkeeping is cross-tenant.
const sql = postgres(harnessDbUrl(), { max: 2 });
/**
 * NOTHING HERE IS PINNED ANY MORE.
 *
 * This file used to hardcode the tenant slug, a login that no longer exists, and four entity uuids
 * commented "real immobileyes ids (owner-fetched)". After the database was rebuilt, the account was
 * gone and the ids matched no rows — so the login silently failed, every route answered 401, and
 * the drive reported the whole portal as a DENY-ALL. See docs/E2E_SWEEP_2026-08-23.md §3.
 *
 * A detail probe needs a REAL id, and the only reliable source of one is the database at run time.
 * Where an entity type has no rows at all, the probe is reported SKIPPED with the reason — never
 * silently dropped, and never counted as a pass, because a route nothing exercised is uncovered.
 */
let S, PROP, BUCKET, VAULT, ATOM;

// mode: 'list' expect 200 (data-bearing); 'detail' expect 200 NOT 404 (valid id); 'any' expect not 500
const routesFor = () => [
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
  ['proposals/[id]/seed-job (self-serve since W3.1)', `/api/portal/${S}/proposals/${PROP}/seed-job`, 'any'],
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
  ['guardrail-templates', `/api/portal/${S}/guardrail-templates`, 'any'],
  ['automation-policies', `/api/portal/${S}/automation-policies`, 'any'],
  ['automation-overview', `/api/portal/${S}/automation-overview`, 'any'],
  ['portals', `/api/portal/${S}/portals`, 'any'],
  ['agents/usage', `/api/portal/${S}/agents/usage`, 'any'],
  ['section-standards', `/api/portal/${S}/section-standards`, 'any'],
  ['templates', `/api/portal/${S}/templates`, 'any'],
  ['taxonomy', `/api/portal/${S}/taxonomy`, 'any'],
];

/**
 * The richest tenant that has an active admin — driving RLS against an empty tenant proves nothing,
 * because every route would return zero and the script could not tell isolation from emptiness.
 */
async function resolveFixture() {
  const [t] = await sql`
    SELECT * FROM (
      SELECT t.id, t.slug,
             (SELECT count(*)::int FROM proposals p WHERE p.tenant_id = t.id) AS proposals,
             (SELECT count(*)::int FROM tenant_opportunity_cards c WHERE c.tenant_id = t.id) AS cards
      FROM tenants t
      WHERE EXISTS (SELECT 1 FROM users u
                    WHERE u.tenant_id = t.id AND u.is_active AND u.role = 'tenant_admin')
    ) x ORDER BY x.proposals + x.cards DESC LIMIT 1`;
  if (!t) throw new CannotRun('no tenant with an active tenant_admin exists on this box');

  const one = async (q) => (await q)[0]?.id ?? null;
  S = t.slug;
  PROP   = await one(sql`SELECT id FROM proposals WHERE tenant_id=${t.id}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`);
  BUCKET = await one(sql`SELECT id FROM tenant_spotlight_buckets WHERE tenant_id=${t.id}::uuid AND is_active ORDER BY created_at LIMIT 1`);
  VAULT  = await one(sql`SELECT id FROM collaboration_vaults WHERE tenant_id=${t.id}::uuid AND status='active' ORDER BY created_at LIMIT 1`);
  ATOM   = await one(sql`SELECT id FROM library_atoms WHERE tenant_id=${t.id}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`);
  console.log(`tenant ${S} · proposal=${PROP ? 'yes' : 'NONE'} bucket=${BUCKET ? 'yes' : 'NONE'} vault=${VAULT ? 'yes' : 'NONE'} atom=${ATOM ? 'yes' : 'NONE'}`);
  return t;
}

/**
 * Does the tenant actually HAVE rows behind this list route?
 *
 * Only the routes that can legitimately be empty need an answer; anything else falls through to
 * `true`, which keeps the old strict behaviour for routes that are always populated.
 */
async function tenantHasRows(label) {
  const t = TENANT_ID;
  const q = {
    vaults: sql`SELECT count(*)::int n FROM collaboration_vaults WHERE tenant_id=${t}::uuid AND status='active'`,
    atoms: sql`SELECT count(*)::int n FROM library_atoms WHERE tenant_id=${t}::uuid AND archived_at IS NULL`,
    buckets: sql`SELECT count(*)::int n FROM tenant_spotlight_buckets WHERE tenant_id=${t}::uuid AND is_active`,
    cards: sql`SELECT count(*)::int n FROM tenant_opportunity_cards WHERE tenant_id=${t}::uuid`,
    proposals: sql`SELECT count(*)::int n FROM proposals WHERE tenant_id=${t}::uuid`,
  }[label];
  if (!q) return true;
  return (await q)[0].n > 0;
}

let TENANT_ID = null;

async function main() {
  const tenant = await resolveFixture();
  TENANT_ID = tenant.id;
  const actor = await resolveActor(sql, { role: 'tenant_admin', tenantSlug: tenant.slug });
  const ROUTES = routesFor();
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext();
  const p = await loginOrDie(ctx, BASE, actor);
  console.log(`signed in as ${actor.email} → ${p.url()}`);
  const fails = [];
  const rows = [];
  const skipped = [];
  for (const [label, path, mode] of ROUTES) {
    // `undefined` in the path means the entity type has no rows here. That is not a pass and not a
    // deny-all — it is a probe that never ran, and saying so is the whole point.
    if (/\/(null|undefined)(\/|$|\?)/.test(path)) {
      skipped.push(label);
      rows.push([label, 0, 0, true, 'SKIPPED — no such entity on this box, probe not run']);
      continue;
    }
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
        // AN EMPTY TABLE IS NOT A DENIAL, and conflating them is how this drive reported the
        // vaults route as a DENY-ALL when `collaboration_vaults` holds zero rows for EVERY tenant
        // on the box. A list route is a finding only when the tenant HAS rows and sees none, so
        // the expectation comes from the database rather than from "non-trivial body length".
        const empty = status === 200 && (bodyLen <= 20 || /\[\]\}?$/.test(txt.trim().slice(-3)));
        if (status !== 200) { ok = false; note = `HTTP ${status}`; }
        else if (!empty) { ok = true; }
        else {
          const has = await tenantHasRows(label);
          ok = !has;
          note = has ? 'DENY-ALL — the tenant has rows and saw none'
                     : 'empty, and the table holds 0 for this tenant — not a denial';
        }
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
  const measured = ROUTES.length - skipped.length;
  console.log(`\n${fails.length === 0 ? '✅ COMPREHENSIVE PORTAL RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' route(s) DENY-ALL/error'}: ${measured - fails.length}/${measured} measured`);
  if (skipped.length) {
    // Loud, because a skipped probe is UNCOVERED. Rounding it into the pass count would be the
    // exact self-deception this whole sweep exists to remove.
    console.log(`   ${skipped.length} probe(s) NOT RUN (no such entity on this box): ${skipped.join(', ')}`);
  }
  await sql.end();
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch(async (e) => { await sql.end().catch(() => {}); dieWell(e); });
