/**
 * Does every page in the product actually render for the person who is allowed to see it?
 *
 * The guide capture drives the ~35 surfaces the two guides document. This drives ALL of them,
 * enumerated from the `app/` tree rather than from a list somebody maintained, so a page nobody
 * thought to add to a list is still checked.
 *
 * It exists because of what the guide pass found. Two live defects were sitting on customer-facing
 * routes, and BOTH answered HTTP 200 the whole time:
 *
 *   B78  /portal/[slug]/proposals/[id]   `canvas.font_default.family` on a stored partial canvas →
 *                                        the whole proposal workspace was the red error card.
 *   B79  /admin/events                   `Date.now()` read during render → the server wrote
 *                                        "2s ago", the client hydrated and wrote "4s ago", React
 *                                        #418, hydration failed for the subtree.
 *
 * Neither reached the server log (both threw in a client component), and neither changed the status
 * code. The only evidence either way is what the BROWSER ends up with — the rendered text and the
 * console — which is what this reads.
 *
 *   cd frontend && node scripts/verify-surfaces.mjs
 * Exit 0 if every reachable surface renders clean; 1 otherwise.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://claude@127.0.0.1:5433/govtech_intel';
const APP = '/home/user/govwin/frontend/app';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/** Every `page.tsx` under a root, as a route, with its dynamic segments named. */
function routesUnder(root, prefix) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, rel + '/' + e.name);
      else if (e.name === 'page.tsx') out.push((prefix + rel).replace(/\/\(.*?\)/g, '') || '/');
    }
  };
  walk(root, '');
  return out.sort();
}

/** Fill `[param]` segments from real rows — a route we cannot address is reported, not skipped. */
async function bindings() {
  const [prop] = await sql`
    SELECT p.id, t.slug FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.archived_at IS NULL AND t.slug = 'foundation'
    ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC LIMIT 1`;
  const [sect] = prop ? await sql`
    SELECT id FROM proposal_sections WHERE proposal_id = ${prop.id}
    ORDER BY sort_index ASC NULLS LAST LIMIT 1` : [];
  const [sol] = await sql`
    SELECT id FROM curated_solicitations WHERE solicitation_title IS NOT NULL
    ORDER BY (SELECT count(*) FROM opportunities o WHERE o.solicitation_id = curated_solicitations.id) DESC LIMIT 1`;
  const [topic] = sol ? await sql`SELECT id FROM opportunities WHERE solicitation_id = ${sol.id} LIMIT 1` : [];
  const [portal] = await sql`SELECT id FROM proposal_portals ORDER BY created_at DESC LIMIT 1`;
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  const [doc] = await sql`SELECT id FROM documents ORDER BY created_at DESC LIMIT 1`.catch(() => [undefined]);
  const [tmpl] = await sql`SELECT id FROM document_templates ORDER BY created_at DESC LIMIT 1`.catch(() => [undefined]);
  const [src] = await sql`SELECT id FROM source_profiles ORDER BY created_at DESC LIMIT 1`.catch(() => [undefined]);
  const [contract] = await sql`SELECT id FROM contracts ORDER BY created_at DESC LIMIT 1`.catch(() => [undefined]);
  const [vault] = await sql`SELECT id FROM proposals WHERE archived_at IS NULL LIMIT 1`;
  const [found] = await sql`SELECT id FROM library_atoms WHERE archived_at IS NULL LIMIT 1`;
  return {
    tenantSlug: 'foundation', proposalId: prop?.id, sectionId: sect?.id, solId: sol?.id,
    topicId: topic?.id, portalId: portal?.id, tenantId: tenant?.id, documentId: doc?.id,
    templateId: tmpl?.id, profileId: src?.id, contractId: contract?.id, vaultId: vault?.id,
    foundationId: found?.id, spotlightId: topic?.id, proposalIdAlias: prop?.id,
  };
}

const results = [];
async function drive(page, url) {
  const rec = { url, status: null, landed: null, note: '', ok: false };
  const errs = [];
  const onErr = (e) => errs.push(String(e).slice(0, 130));
  const onCon = (m) => { if (m.type() === 'error' && /error boundary|TypeError|ReferenceError|Minified React error/i.test(m.text())) errs.push(m.text().slice(0, 130)); };
  page.on('pageerror', onErr);
  page.on('console', onCon);
  try {
    const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    rec.status = resp?.status() ?? null;
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1400);
    rec.landed = page.url().replace(BASE, '');
    const boundary = await page.locator(
      'text=/Application error|Unhandled Runtime Error|Something went wrong|failed to load|500 —|This page could not be found/i',
    ).count();
    rec.ok = (rec.status ?? 200) < 400 && boundary === 0 && errs.length === 0;
    if (boundary) rec.note = 'error boundary';
    if (errs.length) rec.note = (rec.note ? rec.note + ' — ' : '') + errs[0];
  } catch (e) {
    rec.note = String(e.message).slice(0, 90);
  } finally {
    page.off('pageerror', onErr);
    page.off('console', onCon);
  }
  results.push(rec);
  console.log(`  ${rec.ok ? '✓' : '✗'} ${url.padEnd(56)} ${String(rec.status ?? '—').padStart(3)}  ${rec.note}`);
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email);
  await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2600);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

const B = await bindings();
const bind = (route) => route.replace(/\[(\w+)\]/g, (_, k) => B[k] ?? '');
/**
 * A route is addressable only if EVERY dynamic segment resolved to something.
 *
 * The first version tested the bound string for a leftover `[`, which an EMPTY substitution passes
 * — `/admin/documents/[documentId]` with no binding became `/admin/documents/`, a different route
 * that happens to exist, and got reported as a clean pass for a page that was never driven. Test
 * the bindings, not the string.
 */
const addressable = (route) => (route.match(/\[(\w+)\]/g) ?? []).every((seg) => !!B[seg.slice(1, -1)]);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const V = { width: 1440, height: 900 };
const unbound = [];

try {
  for (const [label, email, pw, root, prefix] of [
    ['admin · master_admin', 'eric@rfppipeline.com', ADMIN_PW, path.join(APP, 'admin'), '/admin'],
    ['tenant · tenant_admin', 'kate.ulepic@foundation3dp.com', 'DemoPass123!', path.join(APP, 'portal/[tenantSlug]'), '/portal/[tenantSlug]'],
  ]) {
    console.log(`\n── ${label} ──`);
    const ctx = await browser.newContext({ viewport: V });
    const p = await login(ctx, email, pw);
    for (const r of routesUnder(root, prefix)) {
      if (!addressable(r)) { unbound.push(r); continue; }
      await drive(p, bind(r));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await sql.end();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length} surface(s) driven · ${results.length - bad.length} clean · ${bad.length} broken`);
if (unbound.length) {
  // NOT a silent skip: a route with no row to address it is a coverage gap, and saying so is the
  // difference between "all clean" and "all clean, of the ones I could reach".
  console.log(`\n${unbound.length} route(s) NOT driven — no row in the sandbox to address them:`);
  console.log(unbound.map((r) => `  · ${r}`).join('\n'));
}
if (bad.length) {
  console.log('\n✗ broken surfaces:');
  for (const r of bad) console.log(`  · ${r.url} — ${r.note || 'status ' + r.status}`);
  process.exit(1);
}
console.log('\n✓ every addressable surface renders clean for its actor — no boundary, no client throw.');
