#!/usr/bin/env node
/**
 * capture-ui-atlas.mjs — drive and PHOTOGRAPH every addressable UI path, as the actor who owns it.
 *
 * WHY THIS AND NOT `verify-surfaces`. That lens drives `app/admin` and `app/portal/[tenantSlug]`
 * and asks one question: did this render, or is it an error surface. It is deliberately narrow, and
 * on this tree it reaches 78 of 116 routes — the whole marketing site, the auth flow, the partner
 * console, the collaborator vault surface and the dispatchers are outside it. Nobody had ever
 * *looked* at those, and a page can be perfectly free of error text while being empty, unstyled, or
 * showing a different actor's data.
 *
 * So this captures the whole set, and records what a person would actually see:
 *
 *   · the SCREENSHOT (full page, so nothing below the fold is assumed)
 *   · the FINAL url — a redirect route is documented by where it lands, not by its own name
 *   · the rendered INTERACTION COUNTS (buttons, links, inputs, forms present in the live DOM)
 *   · error surfaces, via the one shared definition, and any client-side throw
 *
 * The interaction counts are the point of pairing this with `catalog-ui.mjs`. The catalog says what
 * the SOURCE declares; this says what the BROWSER built. A page whose code defines nine buttons and
 * renders one is not caught by any status code, any envelope check, or any error-text match.
 *
 * COVERAGE IS RECONCILED, not asserted: every route in the catalog ends up captured, redirected,
 * unbindable or lane-less, and the totals must add up or the run exits 2 as a harness defect.
 *
 *   cd frontend && node scripts/capture-ui-atlas.mjs
 *   node scripts/capture-ui-atlas.mjs --lane admin      # one lane only
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { countErrorSurfaces } from './lib/error-surface.mjs';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const REPO = '/home/user/govwin';
const OUT = path.join(REPO, 'docs/ui-atlas');
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

fs.mkdirSync(OUT, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/ui-catalog.json'), 'utf8'));

/**
 * THE CATALOG IS GENERATED, AND NOTHING FORCES IT TO BE CURRENT.
 *
 * This whole sweep photographs the routes `docs/ui-catalog.json` lists. That is the right design —
 * the catalog is the manifest of what a person can DO — but it makes every screenshot only as fresh
 * as the last `catalog-ui.mjs` run, and nobody adding a page thinks to run it first.
 *
 * It has already happened: two project pages were added, this atlas ran, wrote 111 screenshots and
 * reported them all clean — and photographed NEITHER of the new pages, because a day-old catalog
 * did not contain them. The only reason it surfaced at all is the accounting check at the bottom of
 * this file, which noticed its own arithmetic was off.
 *
 * A visual sweep that cannot see a page does not report it missing. It reports 111 clean shots.
 *
 * So: count the page files on disk, compare, and exit 2 as a HARNESS DEFECT rather than
 * photographing an out-of-date product. Same rule `verify-api-contract`, `verify-surfaces` and
 * `reconcile-capability` follow.
 */
{
  const walkPages = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p2 = path.join(dir, e.name);
      if (e.isDirectory()) walkPages(p2, out);
      else if (e.name === 'page.tsx') out.push(p2.replace(path.join(REPO, 'frontend') + '/', ''));
    }
    return out;
  };
  const onDisk = walkPages(path.join(REPO, 'frontend', 'app'));
  const inCatalog = new Set(catalog.records.filter((r) => r.kind === 'page').map((r) => r.file));
  const missing = onDisk.filter((f) => !inCatalog.has(f));
  if (missing.length) {
    console.error(`✗ HARNESS DEFECT — ${missing.length} page(s) exist on disk and are ABSENT from`);
    console.error('  docs/ui-catalog.json, which is where this sweep gets its route list. They would');
    console.error('  simply not be photographed, and the run would report every other page clean.');
    console.error('  Regenerate first:  node frontend/scripts/catalog-ui.mjs');
    for (const f of missing.slice(0, 10)) console.error(`    · ${f}`);
    process.exit(2);
  }
}
const ROUTES = catalog.records.filter((r) => r.kind === 'page').map((r) => ({ route: r.route, file: r.file, declared: { buttons: r.buttons, inputs: r.inputs, links: r.links, forms: r.forms, handlers: r.handlers.length } }));

/**
 * Which actor owns each route. Mirrors middleware's PUBLIC_PATHS + PATH_MIN_ROLE, plus the two
 * surfaces that live OUTSIDE the portal: `/vaults` is for a collaborator who holds no tenant
 * membership at all (resolveVaultAccess, not verifyTenantAccess), and `/partner` is the owner-scoped
 * EconDev console. Driving either as an admin would photograph a different product.
 */
const PUBLIC = ['/', '/login', '/about', '/apply', '/blog', '/features', '/pricing', '/engine', '/how-it-works',
  '/infosec', '/resources', '/security', '/team', '/the-expert', '/customers', '/get-started', '/value', '/legal',
  '/forgot-password', '/reset-password', '/invite'];
function laneFor(route) {
  if (PUBLIC.some((p) => route === p || route.startsWith(p + '/'))) return 'anon';
  if (route.startsWith('/admin')) return 'admin';
  if (route.startsWith('/partner')) return 'partner';
  if (route.startsWith('/vaults')) return 'collab';
  if (route.startsWith('/portal')) return 'tenant';
  return 'tenant'; // /dashboard, /go, /select-company, /change-password — any session reaches them
}

const LANES = {
  anon: { label: 'public · no session', email: null },
  tenant: { label: 'tenant_admin @ foundation', email: 'kate.ulepic@foundation3dp.com', pw: TENANT_PW, slug: 'foundation' },
  // A SECOND tenant, because the fixture's data is not all in one place: the only collaboration
  // vault and the only grain='foundation' atoms live here, so three portal routes are addressable
  // as immobileyes and unaddressable as foundation. Capturing both is also the only way to SEE that
  // two tenants get the same chrome and different data.
  tenant2: { label: 'tenant_admin @ immobileyes', email: 'admin@immobileyes.test', pw: TENANT_PW, slug: 'immobileyes' },
  admin: { label: 'master_admin', email: 'eric@rfppipeline.com', pw: ADMIN_PW },
  partner: { label: 'partner_admin @ entrepreneurs-center', email: 'pjackson@ecinnovates.com', pw: ADMIN_PW },
  // The collaborator keeps its SEEDED password, and it is COLLAB_PW — not TENANT_PW (which the
  // reset script never applies to lighthouse) and not LIGHTHOUSE_PW (which belongs to
  // eric@lighthouse.com, a different account). Two wrong constants in a row cost this lane twice.
  collab: { label: 'partner_user (collaborator)', email: 'collab@lighthouse.com', pw: process.env.COLLAB_PW || 'CollabPass1' },
};

/**
 * Real ids for the dynamic segments, bound from the tenant the lane SIGNS IN AS — never from
 * whichever tenant happens to own a row.
 *
 * This is B91's lesson and it changes the answer here. On this fixture the only collaboration vault
 * belongs to **immobileyes**, and the only `grain='foundation'` atoms belong to immobileyes,
 * rfp-pipeline and entrepreneurs-center — **foundation has neither**. Binding those ids and driving
 * them as foundation's tenant_admin would photograph a correct REFUSAL and file it as a rendered
 * page. So the portal tree is captured once per tenant, each bound from its own data, and a route
 * that no captured tenant can address is REPORTED with the reason.
 */
async function bindings(slug) {
  const [prop] = await sql`
    SELECT p.id, p.opportunity_id FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE t.slug=${slug} AND p.archived_at IS NULL
    ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id=p.id) DESC LIMIT 1`;
  const [sect] = prop ? await sql`SELECT id FROM proposal_sections WHERE proposal_id=${prop.id} ORDER BY sort_index NULLS LAST LIMIT 1` : [];
  const [sol] = await sql`SELECT id FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`;
  const [topic] = sol ? await sql`SELECT id FROM opportunities WHERE solicitation_id=${sol.id} LIMIT 1` : [];
  // TENANT-SCOPED, and the omission was not hypothetical. This query had no `WHERE tenant_id`, so
  // the immobileyes lane was handed FOUNDATION's portal id and drove
  // /portal/immobileyes/portals/<foundation-portal>. The product refused it exactly as it should,
  // and this harness photographed the refusal and reported the page BROKEN — the single red in a
  // 150-shot run, and it was mine.
  //
  // The note directly above `bindings()` warns about precisely this (B91), and was written in the
  // same sitting as the bug. Which is the argument for the rule rather than against it: knowing it
  // is not enough, so every id here is scoped by the lane's own tenant unless it is genuinely
  // platform-scope (solicitations, opportunities, templates, source profiles).
  const [portal] = await sql`
    SELECT p.id FROM proposal_portals p JOIN tenants t ON t.id = p.tenant_id
    WHERE t.slug=${slug} ORDER BY p.created_at DESC LIMIT 1`;
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug=${slug}`;
  const [tmpl] = await sql`SELECT id FROM document_templates LIMIT 1`;
  const [src] = await sql`SELECT id FROM source_profiles LIMIT 1`;
  const [contract] = await sql`SELECT c.id FROM contracts c JOIN tenants t ON t.id=c.tenant_id WHERE t.slug=${slug} LIMIT 1`;
  const [vault] = await sql`SELECT v.id FROM collaboration_vaults v JOIN tenants t ON t.id=v.tenant_id WHERE t.slug=${slug} LIMIT 1`;
  const [tdoc] = await sql`SELECT d.id FROM tenant_documents d JOIN tenants t ON t.id=d.tenant_id WHERE t.slug=${slug} LIMIT 1`;
  const [found] = await sql`SELECT a.id FROM library_atoms a JOIN tenants t ON t.id=a.tenant_id WHERE t.slug=${slug} AND a.grain='foundation' AND a.archived_at IS NULL LIMIT 1`;
  const [pageRow] = await sql`SELECT page_key FROM content_pages WHERE content_type='page' LIMIT 1`;
  const [docPage] = await sql`SELECT page_key, content_type FROM content_pages WHERE content_type <> 'page' LIMIT 1`;
  const [post] = await sql`SELECT page_key FROM content_pages WHERE content_type='blog_post' LIMIT 1`;
  const [res] = await sql`SELECT page_key FROM content_pages WHERE content_type='resource' LIMIT 1`;
  const [collab] = await sql`SELECT id FROM proposal_collaborators LIMIT 1`;
  // Delivery (migration 216). Scoped to the lane's own tenant like every binding here — a project
  // from another tenant drives the page's correct 404 and photographs a not-found as the feature.
  const [project] = await sql`SELECT d.id FROM projects d JOIN tenants t ON t.id=d.tenant_id WHERE t.slug=${slug} ORDER BY d.created_at DESC LIMIT 1`;
  return {
    tenantSlug: slug, proposalId: prop?.id, sectionId: sect?.id, opportunityId: prop?.opportunity_id,
    solId: sol?.id, topicId: topic?.id, spotlightId: topic?.id, portalId: portal?.id, tenantId: tenant?.id,
    templateId: tmpl?.id, profileId: src?.id, contractId: contract?.id, vaultId: vault?.id,
    documentId: tdoc?.id, foundationId: found?.id, pageKey: pageRow?.page_key,
    slug: post?.page_key ?? res?.page_key ?? docPage?.page_key, type: docPage?.content_type,
    token: collab?.id, projectId: project?.id,
  };
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2400);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

const slugify = (s) => s.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
const shots = [];

async function capture(page, lane, route, url, declared) {
  const rec = { lane, route, url, file: `${lane}__${slugify(route)}.png` };
  const errs = [];
  const onErr = (e) => errs.push(`pageerror: ${String(e.message).slice(0, 120)}`);
  const onCon = (m) => { if (m.type() === 'error' && /TypeError|ReferenceError|Minified React error/i.test(m.text())) errs.push(m.text().slice(0, 120)); };
  page.on('pageerror', onErr); page.on('console', onCon);
  try {
    const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    rec.status = resp?.status() ?? null;
    await page.waitForTimeout(2200);
    rec.finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    rec.redirected = rec.finalUrl !== url;
    rec.boundary = await countErrorSurfaces(page);
    // What the BROWSER built, against what the SOURCE declared. A page whose code defines nine
    // buttons and renders one passes every status, envelope and error-text check there is.
    rec.rendered = await page.evaluate(() => ({
      buttons: document.querySelectorAll('button').length,
      links: document.querySelectorAll('a[href]').length,
      inputs: document.querySelectorAll('input,textarea,select').length,
      forms: document.querySelectorAll('form').length,
      text: (document.body?.innerText ?? '').length,
      h1: (document.querySelector('h1,h2')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70),
    }));
    rec.declared = declared;
    await page.screenshot({ path: path.join(OUT, rec.file), fullPage: true });
    rec.ok = (rec.status ?? 200) < 400 && rec.boundary === 0 && errs.length === 0;
    rec.errors = errs.slice(0, 2);
  } catch (e) {
    rec.ok = false; rec.errors = [String(e.message).slice(0, 120)];
  } finally {
    page.off('pageerror', onErr); page.off('console', onCon);
  }
  shots.push(rec);
  const mark = rec.ok ? '✓' : '✗';
  const redir = rec.redirected ? ` → ${rec.finalUrl}` : '';
  console.log(`  ${mark} ${route.padEnd(52)} ${String(rec.status ?? '—').padStart(3)}  ${String(rec.rendered?.text ?? 0).padStart(6)}ch  b${rec.rendered?.buttons ?? 0}/l${rec.rendered?.links ?? 0}/i${rec.rendered?.inputs ?? 0}${redir}${rec.errors?.length ? `  ${rec.errors[0]}` : ''}`);
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`· serving ${BASE} · ${ROUTES.length} route(s) in the catalog`);
const onlyLane = process.argv.includes('--lane') ? process.argv[process.argv.indexOf('--lane') + 1] : null;

// A route can belong to more than one lane: the portal tree is captured as BOTH tenants, which is
// what makes the three immobileyes-only routes addressable at all, and is the only way to see the
// same chrome carrying different data.
const lanesFor = (route) => {
  const primary = laneFor(route);
  return primary === 'tenant' ? ['tenant', 'tenant2'] : [primary];
};

const unbound = new Map();  // route → [reason per lane]
const noLane = [];
const capturedRoutes = new Set();

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  /*
   * The admin document index lives in OBJECT STORAGE, not Postgres, so it cannot be bound by the
   * SQL block above. Read through the product's own helper — the same one the route uses — so the
   * id is real or the route is honestly reported unbound.
   */
  let adminDocId;
  try {
    const { getObjectBuffer } = await import('../lib/storage/s3-client.ts');
    const buf = await getObjectBuffer('reference/documents/_index.json');
    const idx = buf ? JSON.parse(buf.toString('utf8')) : [];
    adminDocId = Array.isArray(idx) && idx.length > 0 ? idx[idx.length - 1].id : undefined;
  } catch (e) {
    console.log(`  · admin document index unreadable (${String(e.message).slice(0, 50)}) — that route will report as unbound`);
  }

  for (const [laneId, lane] of Object.entries(LANES)) {
    if (onlyLane && onlyLane !== laneId) continue;
    const mine = ROUTES.filter((r) => lanesFor(r.route).includes(laneId));
    if (!mine.length) continue;
    // Bindings are per LANE, from the tenant that lane signs in as — see the note on bindings().
    const B = await bindings(lane.slug ?? 'foundation');
    /*
     * ⚠️ ONE PARAM NAME, TWO STORES.
     *
     * `[documentId]` means a `tenant_documents` ROW under /portal, and an OBJECT-STORAGE index
     * entry (reference/documents/_index.json) under /admin. They are different stores with
     * different ids, and this file bound one value for both — so /admin/documents/[documentId] was
     * driven with a tenant document's id, got the page's perfectly correct "Failed to load
     * document", and was filed as BROKEN on every run.
     *
     * The sibling lens already knew: verify-surfaces declines that route with "addressed by the
     * object-storage document index, not a table row". The knowledge never reached here, and the
     * atlas has been reporting a false failure ever since.
     *
     * Resolved per ROUTE, not per param, because the collision is real and no single value is
     * right for both.
     */
    const PER_ROUTE = { '/admin/documents/[documentId]': { documentId: adminDocId } };
    const bindFor = (r, k) => PER_ROUTE[r]?.[k] ?? B[k];
    const bind = (r) => r.replace(/\[(\.\.\.)?(\w+)\]/g, (_, __, k) => bindFor(r, k) ?? `[${k}]`);
    const addressable = (r) => (r.match(/\[(\w+)\]/g) ?? []).every((s) => !!bindFor(r, s.slice(1, -1)));

    console.log(`\n── ${laneId} · ${lane.label} · ${mine.length} route(s) ──`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    let page;
    try {
      page = lane.email ? await login(ctx, lane.email, lane.pw) : await ctx.newPage();
    } catch (e) {
      console.log(`  ✗ lane unavailable — ${String(e.message).slice(0, 70)}`);
      for (const r of mine) noLane.push(`${r.route} (${laneId}: ${String(e.message).slice(0, 40)})`);
      await ctx.close(); continue;
    }
    for (const r of mine) {
      if (!addressable(r.route)) {
        const missing = (r.route.match(/\[(\w+)\]/g) ?? []).filter((s) => !B[s.slice(1, -1)]).join(' ');
        if (!unbound.has(r.route)) unbound.set(r.route, []);
        unbound.get(r.route).push(`${laneId}: no ${missing}`);
        continue;
      }
      await capture(page, laneId, r.route, bind(r.route), r.declared);
      capturedRoutes.add(r.route);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await sql.end();
}

// ── reconcile ────────────────────────────────────────────────────────────────
// A route counts as covered if ANY lane reached it. Only a route no lane could bind is a gap —
// counting per-lane misses would report the immobileyes-only routes as uncovered when they were
// photographed, which is the sort of pessimism that hides the real gaps in noise.
const considered = onlyLane ? ROUTES.filter((r) => lanesFor(r.route).includes(onlyLane)).length : ROUTES.length;
const trulyUnbound = [...unbound.keys()].filter((r) => !capturedRoutes.has(r));
const noLaneRoutes = [...new Set(noLane.map((s) => s.split(' (')[0]))].filter((r) => !capturedRoutes.has(r));
const accounted = capturedRoutes.size + trulyUnbound.length + noLaneRoutes.length;
const broken = shots.filter((s) => !s.ok);
const redirects = shots.filter((s) => s.redirected);

console.log(`\n${shots.length} screenshot(s) · ${shots.length - broken.length} clean · ${broken.length} broken`);
console.log(`coverage: ${considered} route(s) considered · ${capturedRoutes.size} reached · ${trulyUnbound.length} unbindable · ${noLaneRoutes.length} no actor`);
if (trulyUnbound.length) {
  console.log(`\n${trulyUnbound.length} route(s) NO lane could bind:`);
  for (const r of trulyUnbound) console.log(`  · ${r} — ${unbound.get(r).join(' · ')}`);
}
if (noLaneRoutes.length) { console.log(`\n${noLaneRoutes.length} NOT captured — no actor for their lane:`); for (const r of noLane) console.log(`  · ${r}`); }
if (redirects.length) {
  console.log(`\n${redirects.length} route(s) REDIRECT (documented by where they land, not by their name):`);
  for (const s of redirects) console.log(`  · ${s.route} → ${s.finalUrl}`);
}
if (broken.length) { console.log('\n✗ broken:'); for (const s of broken) console.log(`  · ${s.route} — ${s.errors?.join(' | ') || 'boundary'}`); }

/**
 * ── A `--lane` CAPTURE MERGES INTO THE INDEX; IT DOES NOT REPLACE IT ─────────────────────────
 * `index.json` is not just this run's report — `drive-ui-states.mjs` reads it to decide what to
 * drive. A lane-scoped capture that overwrote it silently narrowed that drive's scope to one lane,
 * and the drive then reported a clean run over 29 routes while five lanes went unvisited. Nothing
 * failed; the coverage simply shrank, which is the shape of every defect this repo's guards exist
 * to stop.
 *
 * So a lane run replaces ONLY its own lane's shots and keeps the rest. The index always describes
 * every lane, and `partialLanes` records which ones this run actually refreshed.
 */
const indexPath = path.join(OUT, 'index.json');
let merged = shots;
let carried = 0;
// `considered`/`reached` describe the WHOLE catalog. A lane run considers only its own lane's
// routes, so writing its numbers into the merged index would say "1 route considered" next to 153
// shots — a coverage claim three orders of magnitude wrong, in the file every consumer reads.
// Carry the full-run scalars and record the lane run's own under `laneRun`.
let scalars = { considered, reached: capturedRoutes.size };
let laneRun;
if (onlyLane) {
  try {
    const prev = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const others = (prev.shots ?? []).filter((s) => s.lane !== onlyLane);
    carried = others.length;
    merged = [...others, ...shots];
    if (carried) {
      laneRun = { lane: onlyLane, considered, reached: capturedRoutes.size };
      scalars = { considered: prev.considered ?? considered, reached: prev.reached ?? capturedRoutes.size };
    }
  } catch { /* no prior index — this run is all there is */ }
}
fs.writeFileSync(indexPath, JSON.stringify({
  base: BASE, ...scalars, shots: merged,
  unbound: Object.fromEntries(unbound), noLane,
  ...(onlyLane ? { partialLanes: [onlyLane], ...(laneRun ? { laneRun } : {}) } : {}),
}, null, 1));
console.log(`\nwrote ${shots.length} screenshot(s) + index.json to docs/ui-atlas/`
  + (onlyLane ? ` (lane '${onlyLane}' refreshed; ${carried} shot(s) from other lanes carried forward)` : ''));

if (accounted !== considered) {
  console.log(`\n✗ HARNESS DEFECT — ${considered - accounted} route(s) neither captured nor reported.`);
  process.exit(2);
}
process.exit(broken.length ? 1 : 0);
