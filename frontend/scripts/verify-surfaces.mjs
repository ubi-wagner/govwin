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
import { countErrorSurfaces } from './lib/error-surface.mjs';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// MUST be the database the SERVER under test is reading. This defaulted to the retired
// :5433/claude cluster long after the sandbox moved to :5432, so every dynamic route was addressed
// with an id bound from a DIFFERENT database than the app was serving: ids that happen to exist in
// both rendered 200 and the sweep reported "clean", while a :5433-only id 404'd and looked like a
// newly-broken page. The static routes were unaffected, which is exactly why it went unnoticed.
// The DSN is echoed at startup now — an audit that will not say what it measured cannot be trusted.
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
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

/**
 * Fill `[param]` segments from real rows — a route we cannot address is reported, not skipped.
 *
 * The first version guessed at table names, and the guesses were the coverage gap: it queried a
 * `documents` table that does not exist, and never looked for a page key or a content slug at all.
 * Five routes came back "no row in the sandbox to address them" when four of them had rows the
 * whole time. Every lookup below now targets what the PAGE itself reads.
 *
 * A binding that genuinely cannot be made carries a REASON, so the report distinguishes "the
 * sandbox has no such row" from "this route is addressed by something other than a table row".
 */
/**
 * Bind every dynamic segment to a REAL row — deterministically.
 *
 * Every LIMIT 1 here carries an explicit tiebreaker, and that is not pedantry. The seeded
 * `source_profiles` all share one `created_at`, so `ORDER BY created_at DESC LIMIT 1` returned a
 * different row run to run: one pass drove a profile that rendered, the next drove one that 404'd,
 * and the sweep reported a "new broken surface" that was nothing but the row lottery. A verification
 * tool whose results change without the code changing cannot be used to decide anything.
 */
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
  const [topic] = sol ? await sql`SELECT id FROM opportunities WHERE solicitation_id = ${sol.id} ORDER BY id ASC LIMIT 1` : [];
  const [portal] = await sql`
    SELECT pp.id FROM proposal_portals pp JOIN tenants t ON t.id = pp.tenant_id
    WHERE t.slug = 'foundation' ORDER BY pp.created_at DESC, pp.id ASC LIMIT 1`;
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  // A tenant document lives in `tenant_documents` — there is no `documents` table.
  const [tdoc] = await sql`
    SELECT d.id FROM tenant_documents d JOIN tenants t ON t.id = d.tenant_id
    WHERE t.slug = 'foundation' ORDER BY d.created_at DESC, d.id ASC LIMIT 1`.catch(() => [undefined]);
  // `/admin/site/[pageKey]` takes a SEED PAGE KEY, not a row id — the page redirects anything else.
  const [pageRow] = await sql`
    SELECT page_key FROM content_pages WHERE content_type = 'page' AND status = 'active'
    ORDER BY created_at DESC, id ASC LIMIT 1`.catch(() => [undefined]);
  // `/admin/site/docs/[type]/[slug]` is a content DOCUMENT — its type and its page_key.
  const [docPage] = await sql`
    SELECT content_type, page_key FROM content_pages
    WHERE content_type <> 'page' ORDER BY created_at DESC, id ASC LIMIT 1`.catch(() => [undefined]);
  const [tmpl] = await sql`SELECT id FROM document_templates ORDER BY created_at DESC, id ASC LIMIT 1`.catch(() => [undefined]);
  const [src] = await sql`SELECT id FROM source_profiles ORDER BY created_at DESC, id ASC LIMIT 1`.catch(() => [undefined]);
  // TENANT-SCOPED, like `found` below and for the same reason — see the note there. These four
  // bindings kept the un-scoped form long after that lesson was written down, and stayed harmless
  // only because the tables were empty or single-owner. The moment a second tenant owned a
  // contract, `ORDER BY created_at DESC LIMIT 1` picked ITS row, handed it to a route driven as
  // foundation's tenant_admin, and the lens reported the product's CORRECT refusal as
  //     ✗ /portal/foundation/contracts/<immobileyes-id> — error boundary
  // A cross-tenant probe getting the right answer, scored as a broken page. The same trap as the
  // library_atoms binding, in the opposite direction: there it manufactured a false pass, here a
  // false failure. Both come from binding an id without regard to the tenant being driven.
  const [contract] = await sql`
    SELECT c.id FROM contracts c JOIN tenants t ON t.id = c.tenant_id
    WHERE t.slug = 'foundation' ORDER BY c.created_at DESC, c.id ASC LIMIT 1`.catch(() => [undefined]);
  const [vault] = await sql`
    SELECT p.id FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE t.slug = 'foundation' AND p.archived_at IS NULL ORDER BY p.id ASC LIMIT 1`;
  // THE PAGE'S OWN PREDICATE, copied from its source, not a version of it I believe equivalent:
  //   WHERE id = $1 AND tenant_id = $2 AND grain = 'foundation'
  //
  // The previous binding was `SELECT id FROM library_atoms ORDER BY id ASC LIMIT 1` — no tenant,
  // no grain. On this fixture that is an **immobileyes primitive**, handed to a route driven as
  // foundation's tenant_admin. The product refused it correctly ("Not found — this item doesn't
  // exist, or you don't have access to it"), and the lens scored it a clean pass, because the
  // boundary matcher of the day did not recognise that text. So the lens was manufacturing a
  // cross-tenant probe, getting the RIGHT answer, and reporting it as a rendered page.
  //
  // Two rules broken at once: copy the predicate from the source, and bind ids from the tenant the
  // harness actually signs in as. A tenant route bound from another tenant's row tests isolation by
  // accident and coverage not at all.
  const [found] = await sql`
    SELECT a.id FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id
    WHERE t.slug = 'foundation' AND a.grain = 'foundation' AND a.archived_at IS NULL
    ORDER BY a.id ASC LIMIT 1`;
  return {
    tenantSlug: 'foundation', proposalId: prop?.id, sectionId: sect?.id, solId: sol?.id,
    topicId: topic?.id, portalId: portal?.id, tenantId: tenant?.id,
    documentId: tdoc?.id, pageKey: pageRow?.page_key,
    type: docPage?.content_type, slug: docPage?.page_key,
    templateId: tmpl?.id, profileId: src?.id, contractId: contract?.id, vaultId: vault?.id,
    foundationId: found?.id, spotlightId: topic?.id,
  };
}

/**
 * Why a segment could not be bound. Without this the report says "no row in the sandbox" for a
 * route that is not addressed by a row at all, which sends the next reader looking for a seed that
 * would not help.
 */
const UNBINDABLE_REASON = {
  contractId: 'the `contracts` table is empty — seed one to cover this route',
  foundationId: "the 'foundation' tenant holds no grain='foundation' atom — upload a document and "
    + 'atomize it to cover this route (a primitive or another tenant\'s atom is NOT a substitute: '
    + 'the page requires both, and binding one anyway drives a refusal and calls it a render)',
};

/**
 * Routes whose parameter is NOT a row id, so the shared per-name binding would address them with
 * something wrong and drive a page that legitimately errors.
 *
 * `/admin/documents/[documentId]` is backed by OBJECT STORAGE (`reference/documents/_index.json`),
 * not a table. Handing it a `tenant_documents.id` because both routes happen to call the segment
 * `documentId` would produce a red "not found" page and report it as a broken surface — a harness
 * inventing a failure is no better than one inventing a pass.
 */
const ROUTE_NOT_BY_ROW = {
  '/admin/documents/[documentId]':
    'addressed by the object-storage document index, not a table row — the sandbox store is empty',
};
const reasonFor = (route) => ROUTE_NOT_BY_ROW[route]
  ?? (route.match(/\[(\w+)\]/g) ?? [])
    .map((seg) => seg.slice(1, -1)).filter((k) => !B[k])
    .map((k) => UNBINDABLE_REASON[k] ?? `no value for [${k}]`).join('; ');

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
    // From the ONE shared definition (scripts/lib/error-surface.mjs). This lens and the guide
    // capture each kept a private copy, the copies drifted, and the guide's copy missed a bare
    // "Document not found" — shooting an error page into the admin guide as a working screen.
    const boundary = await countErrorSurfaces(page);
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

console.log(`· serving ${BASE} · binding ids from ${DB.replace(/:[^:@/]*@/, ':***@')}`);
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
const addressable = (route) => !ROUTE_NOT_BY_ROW[route]
  && (route.match(/\[(\w+)\]/g) ?? []).every((seg) => !!B[seg.slice(1, -1)]);

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
  console.log(`\n${unbound.length} route(s) NOT driven:`);
  console.log(unbound.map((r) => `  · ${r} — ${reasonFor(r)}`).join('\n'));
}
if (bad.length) {
  console.log('\n✗ broken surfaces:');
  for (const r of bad) console.log(`  · ${r.url} — ${r.note || 'status ' + r.status}`);
  process.exit(1);
}
console.log('\n✓ every addressable surface renders clean for its actor — no boundary, no client throw.');
