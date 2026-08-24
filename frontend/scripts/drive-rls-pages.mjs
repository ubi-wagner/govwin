/**
 * Server-component RLS proof (docs/RLS_CUTOVER.md P5). App connected as govtech_app (NOBYPASSRLS).
 * Next server components (page.tsx) query forced tables directly and render the HTML server-side —
 * the API drives can't see this. Here we log in and NAVIGATE to real pages, then assert a known
 * forced-data token appears in the rendered HTML. If a page's forced query DENY-ALLs, the token is
 * absent (the page rendered empty). Tokens: DON26BX03 (immobileyes proposal), Autonomy (a bucket),
 * GHOST (a library atom).  node scripts/drive-rls-pages.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { resolveActor, loginOrDie, dieWell, CannotRun, harnessDbUrl } from './lib/drive-actor.mjs';
import { clientHeaders } from './lib/client-ip.mjs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }
// The harness's OWN reads go through the owner — see harnessDbUrl(). The app under
// test stays on the scoped role; only this bookkeeping is cross-tenant.
const sql = postgres(harnessDbUrl(), { max: 2 });

/**
 * THE TOKENS ARE READ FROM THE ROW THE PAGE SHOULD RENDER — they used to be pinned strings.
 *
 * This drive proves a server component's forced query did not DENY-ALL, by asserting a known piece
 * of that tenant's data appears in the rendered HTML. It used to hardcode TOK_PROPOSAL, TOK_BUCKET
 * and TOK_ATOM alongside a tenant slug, a proposal uuid and a tenant uuid — every one of which
 * stopped matching after the database was rebuilt, on top of a login that no longer existed. The
 * result was every page reported as "rendered empty (DENY-ALL)".
 *
 * Reading the token from the same row the page queries is strictly better than pinning one: it
 * cannot drift, and it fails for the right reason. If the tenant has no such row, the check is
 * SKIPPED and said so — a page with nothing to render proves nothing either way.
 */
let S, PROP, TENANT_ID, TOK_PROPOSAL, TOK_BUCKET, TOK_ATOM, TOK_TENANT_NAME;

/** A distinctive, renderable fragment — long enough not to match by accident. */
const tokenOf = (v) => {
  if (!v) return null;
  const t = String(v).trim();
  return t.length >= 6 ? t.slice(0, 40) : null;
};

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
  S = t.slug; TENANT_ID = t.id;
  const [tn] = await sql`SELECT name FROM tenants WHERE id=${t.id}::uuid`;
  TOK_TENANT_NAME = tokenOf(tn?.name);

  const [prop] = await sql`SELECT id, title FROM proposals
    WHERE tenant_id=${t.id}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`;
  const [bucket] = await sql`SELECT name FROM tenant_spotlight_buckets
    WHERE tenant_id=${t.id}::uuid AND is_active ORDER BY created_at LIMIT 1`;
  const [atom] = await sql`SELECT title FROM library_atoms
    WHERE tenant_id=${t.id}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`;

  PROP = prop?.id ?? null;
  TOK_PROPOSAL = tokenOf(prop?.title);
  TOK_BUCKET = tokenOf(bucket?.name);
  TOK_ATOM = tokenOf(atom?.title);
  console.log(`tenant ${S}`);
  console.log(`tokens  proposal=${TOK_PROPOSAL ?? 'NONE'} · bucket=${TOK_BUCKET ?? 'NONE'} · atom=${TOK_ATOM ?? 'NONE'} · tenant=${TOK_TENANT_NAME ?? 'NONE'}`);
  return t;
}

// [label, path, token that MUST appear if the forced query rendered]
const portalPages = () => [
  ['proposals (list)', `/portal/${S}/proposals`, TOK_PROPOSAL],
  ['proposals/[id] (detail)', `/portal/${S}/proposals/${PROP}`, TOK_PROPOSAL],
  ['dashboard', `/portal/${S}/dashboard`, TOK_PROPOSAL],
  ['buckets', `/portal/${S}/buckets`, TOK_BUCKET],
  ['cards', `/portal/${S}/cards`, TOK_BUCKET],
  // atoms + manage are counts/facets rendered from forced tables (client-lib / server console),
  // so assert a NON-ZERO forced-data string (a DENY-ALL would show 0 / no facets), not a title.
  ['atoms (library facets)', `/portal/${S}/atoms`, 'commercialization'],
  // `/manage` is the account page: its forced-table reads are COUNTS, not names, so a bucket name
  // never appears there. Its original token was '8 OPPs' — a count that drifted. The company name
  // is what this page actually renders from tenant-scoped data, so that is what to assert.
  ['manage (account summary)', `/portal/${S}/manage`, TOK_TENANT_NAME],
];
const adminPages = () => [
  ['admin/proposals (cross-tenant)', `/admin/proposals`, TOK_PROPOSAL],
  ['admin/tenants/[id] (any-tenant view)', `/admin/tenants/${TENANT_ID}`, TOK_TENANT_NAME],
];

async function checkPage(page, path, token) {
  try {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(600);
    const html = await page.content();
    const status = r ? r.status() : 0;
    // A token carrying & < > " is ESCAPED in the rendered HTML, so a raw `includes` misses it and
    // the page reads as empty — which this drive would have called a DENY-ALL. Two of the four
    // "failures" on its first repaired run were exactly that: a bucket named
    // "Additive Construction & 3D Printing" rendering as "&amp;". Match either form.
    const esc = token
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const has = html.includes(token) || html.includes(esc);
    return { status, has, len: html.length };
  } catch (e) { return { status: 0, has: false, len: 0, err: String(e).slice(0, 50) }; }
}

async function main() {
  const tenant = await resolveFixture();
  const tenantActor = await resolveActor(sql, { role: 'tenant_admin', tenantSlug: tenant.slug });
  const adminActor = await resolveActor(sql, { role: 'master_admin' });
  const PORTAL = portalPages();
  const ADMIN = adminPages();
  const skipped = [];
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const rows = [];
  const fails = [];

  const tctx = await b.newContext({ extraHTTPHeaders: clientHeaders() });
  const tp = await loginOrDie(tctx, BASE, tenantActor);
  console.log(`tenant ${tenantActor.email} → ${tp.url()}`);
  for (const [label, path, token] of PORTAL) {
    if (!token || /\/(null|undefined)(\/|$|\?)/.test(path)) {
      skipped.push(label);
      rows.push([`portal · ${label}`, true, 'SKIPPED — the tenant has no such row, nothing to assert']);
      continue;
    }
    const { status, has, len, err } = await checkPage(tp, path, token);
    const ok = status === 200 && has;
    rows.push([`portal · ${label}`, ok, `${status} · "${token}" ${has ? 'found' : 'MISSING'} · ${len}b${err ? ' · ' + err : ''}`]);
    if (!ok) fails.push(label);
  }
  await tctx.close();

  const actx = await b.newContext({ extraHTTPHeaders: clientHeaders() });
  const ap = await loginOrDie(actx, BASE, adminActor);
  console.log(`admin ${adminActor.email} → ${ap.url()}`);
  for (const [label, path, token] of ADMIN) {
    if (!token || /\/(null|undefined)(\/|$|\?)/.test(path)) {
      skipped.push(label);
      rows.push([`admin · ${label}`, true, 'SKIPPED — the tenant has no such row, nothing to assert']);
      continue;
    }
    const { status, has, len, err } = await checkPage(ap, path, token);
    const ok = status === 200 && has;
    rows.push([`admin · ${label}`, ok, `${status} · "${token}" ${has ? 'found' : 'MISSING'} · ${len}b${err ? ' · ' + err : ''}`]);
    if (!ok) fails.push(label);
  }
  await actx.close(); await b.close();

  for (const [m, ok, info] of rows) console.log(`${ok ? '✅' : '❌'} ${m.padEnd(42)} (${info})`);
  const measured = rows.length - skipped.length;
  console.log(`\n${fails.length === 0 ? '✅ SERVER-COMPONENT RLS PROOF PASS' : '❌ FAIL — ' + fails.length + ' page(s) rendered empty (DENY-ALL)'}: ${measured - fails.length}/${measured} measured`);
  if (skipped.length) console.log(`   ${skipped.length} check(s) NOT RUN (no row to assert): ${skipped.join(', ')}`);
  await sql.end();
  if (fails.length) { console.log('   failing:', fails.join(', ')); process.exit(1); }
}
main().catch(async (e) => { await sql.end().catch(() => {}); dieWell(e); });
