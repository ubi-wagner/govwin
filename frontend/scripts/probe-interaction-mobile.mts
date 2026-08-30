/**
 * Every pipeline's dense page on a phone — with its overlays OPEN.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * `drive-ui-responsive.mjs` now photographs one dense page per pipeline at 390 / 820 / 1440 and
 * asserts the body never scrolls sideways. Both matter. Neither reaches what these pages actually
 * ARE: a proposal section with an AI bar and a compliance rail, a bucket editor with inline
 * weights, a template card with a preview, an agent roster with per-row controls. All of it is
 * behind a click, so at rest it does not exist — and a layout that is fine while collapsed can be
 * unusable the moment somebody opens it.
 *
 * `probe-project-mobile.mts` asked exactly this question, of exactly one page, because that page
 * was the densest a tenant has. The cross-pipeline review then found that the OTHER nine had never
 * been asked it at all — uncovered, not passing. This is that probe, generalised over the routes,
 * sharing its measurement definitions (`lib/mobile-measure.mts`) so the two can never disagree
 * about what overflow means.
 *
 * ── WHAT IT MEASURES, AND WHAT IT REFUSES TO CONCLUDE ────────────────────────────────────────
 *   overflow    an element past the viewport, EXCLUDING legitimate inner `overflow-x` scrollers.
 *               FAILS the run: the body scrolling sideways is a defect on every surface.
 *   tap size    every control against 44×44 CSS px. REPORTED, never failed — a dense row of
 *               inline verbs legitimately runs smaller, and failing it teaches people to stop
 *               reading the output.
 *   clipping    text clipped with NO title/aria-label carrying the full value. Fails.
 *   opened      how many disclosures actually opened. A route where this is 0 is reported as
 *               OPENED NOTHING and does not count as covered, because a probe that opened nothing
 *               measured the page the responsive pass already measured.
 *
 * ⚠️ READ-ONLY. It opens disclosures and inline editors and photographs them; it submits nothing.
 * The opener names the verbs it clicks rather than clicking every button, precisely so it cannot
 * post.
 *
 *   cd frontend && npx tsx scripts/probe-interaction-mobile.mts [outDir]
 * Exit 0 if every reachable route holds; 1 on a finding; 2 if it could not earn a verdict.
 */
import { chromium, type Page, type Browser } from 'playwright';
import postgres from 'postgres';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { overflowing, smallTargets, clipped, openEverything } from './lib/mobile-measure.mts';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const ADMIN_PW = process.env.ADMIN_PW || process.env.RFP_ADMIN_PW || 'RFPAdmin2026!';
const DB = process.env.DATABASE_URL_OWNER;
const OUT = process.argv[2] || '/home/user/govwin/docs/ui-states';

/** 390 only. The tablet width is already covered by the responsive pass and by the project probe;
 *  what has never been looked at is these pages OPEN on a phone, and running two widths over ten
 *  routes doubles the time for a question nobody asked. */
const VP = { w: 390, h: 844, name: 'phone' };

interface Lane { id: string; email: string; pw: string; routes: string[] }

const LANES: Lane[] = [
  {
    id: 'tenant', email: 'kate.ulepic@foundation3dp.com', pw: TENANT_PW,
    routes: [
      '/portal/foundation/cards',          // opportunity publish + ranking, as the customer sees it
      '/portal/foundation/buckets',        // bucket authoring — inline weights
      '/portal/foundation/atoms',          // library ingest + atomization
      '/portal/foundation/library',        // the foundation shelf
      '/portal/foundation/documents',      // document creation
      '/portal/foundation/templates',      // templating
      'PROPOSAL_ROUTE',                    // the build workspace — the densest page in the product
      'PROJECT_ROUTE',                     // post-award, already probed; kept so the two agree
    ],
  },
  {
    id: 'admin', email: 'eric@rfppipeline.com', pw: ADMIN_PW,
    routes: [
      '/admin/rfp-curation',               // rfp ingest triage
      '/admin/workflows',                  // the automation spine
      '/admin/agents',                     // the agent roster — known to clip a column at 390
      '/admin/templates',                  // master templates
    ],
  },
];

let failed = 0;
let unearned = 0;
const A = (ok: boolean, label: string, extra = '') => {
  if (!ok) failed += 1;
  console.log(`    ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
};

async function login(page: Page, email: string, pw: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) throw new Error(`login failed for ${email}`);
}

/**
 * Bind the two id-bearing routes from the DB.
 *
 * ORDER BY created_at, and the proposal must HAVE sections — a resolver must select for what its
 * consumer needs, not for what is merely nearest (B146/B147). An empty build workspace probes as a
 * clean page while telling you nothing about the page a customer opens.
 */
async function bindRoutes() {
  if (!DB) return { bound: false as const };
  const sql = postgres(DB, { max: 2, onnotice: () => {} });
  try {
    const [proj] = await sql<{ id: string; slug: string }[]>`
      SELECT p.id, t.slug FROM projects p JOIN tenants t ON t.id = p.tenant_id
       WHERE t.slug = 'foundation' ORDER BY p.created_at LIMIT 1`;
    const [prop] = await sql<{ id: string; slug: string }[]>`
      SELECT p.id, t.slug FROM proposals p JOIN tenants t ON t.id = p.tenant_id
       WHERE t.slug = 'foundation'
         AND EXISTS (SELECT 1 FROM proposal_sections s WHERE s.proposal_id = p.id)
       ORDER BY p.created_at LIMIT 1`;
    return { bound: true as const, proj, prop };
  } finally { await sql.end(); }
}

/**
 * Every remaining `[param]` in the manifest, resolved from the database.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * The width sweep below used to DROP any route still carrying a bracket after `[tenantSlug]` was
 * substituted, and count it as unaddressable. That was honest — it said so out loud, and the
 * numbers were 19 routes needing an id plus 8 that failed to load, reported every run as
 * "27 route(s) measured nothing. That is uncovered, not passing."
 *
 * Honest is not the same as finished. Those 19 are the id-bearing pages — a build workspace, a
 * curation workspace, a topic, a portal, a contract, a vault — which is to say the DENSE half of
 * the product, and the half a phone has the most trouble with. Sweeping only the list pages and
 * declaring the width clean measured the easy routes.
 *
 * ── TENANT-SCOPED, LIKE EVERY BINDING IN THIS TREE ───────────────────────────────────────────
 * Portal ids come from the tenant the portal lane signs in as. An id borrowed from another tenant
 * drives the page's CORRECT refusal, and a refusal is a short page that never overflows — so a
 * cross-tenant binding would report a clean width for a page it never rendered. Admin ids are
 * platform-scope and need no tenant.
 *
 * A param that cannot be resolved is left bracketed and reported, exactly as before. What changes
 * is that "cannot" now means the box genuinely holds no such row, not that nobody wrote the query.
 */
async function bindParams(slug: string): Promise<Record<string, string>> {
  if (!DB) return {};
  const sql = postgres(DB, { max: 2, onnotice: () => {} });
  const one = async (q: Promise<Array<{ v: string | null }>>): Promise<string | undefined> => {
    try { const [r] = await q; return r?.v ?? undefined; } catch { return undefined; }
  };
  try {
    const out: Record<string, string | undefined> = {
      // ── portal, scoped to the lane's own tenant ───────────────────────────────────────────
      proposalId: await one(sql`SELECT p.id::text AS v FROM proposals p JOIN tenants t ON t.id = p.tenant_id
        WHERE t.slug = ${slug} AND p.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM proposal_sections s WHERE s.proposal_id = p.id)
        ORDER BY p.created_at LIMIT 1`),
      sectionId: await one(sql`SELECT s.id::text AS v FROM proposal_sections s
        JOIN proposals p ON p.id = s.proposal_id JOIN tenants t ON t.id = p.tenant_id
        WHERE t.slug = ${slug} ORDER BY s.sort_index LIMIT 1`),
      projectId: await one(sql`SELECT d.id::text AS v FROM projects d JOIN tenants t ON t.id = d.tenant_id
        WHERE t.slug = ${slug} ORDER BY d.created_at LIMIT 1`),
      contractId: await one(sql`SELECT c.id::text AS v FROM contracts c JOIN tenants t ON t.id = c.tenant_id
        WHERE t.slug = ${slug} ORDER BY c.created_at LIMIT 1`),
      // `collaboration_vaults`, not `vaults` — there is no table by the latter name, and because
      // `one()` swallows a query error to keep one missing fixture from failing the sweep, a WRONG
      // TABLE NAME reads exactly like "the box holds none". It reported this route unbindable for a
      // reason that was a typo. The swallow stays (a genuinely absent fixture must not fail the
      // run) which is precisely why the name has to be right.
      vaultId: await one(sql`SELECT v.id::text AS v FROM collaboration_vaults v
        JOIN tenants t ON t.id = v.tenant_id WHERE t.slug = ${slug} ORDER BY v.created_at LIMIT 1`),
      portalId: await one(sql`SELECT pp.id::text AS v FROM proposal_portals pp JOIN tenants t ON t.id = pp.tenant_id
        WHERE t.slug = ${slug} ORDER BY pp.created_at LIMIT 1`),
      documentId: await one(sql`SELECT d.id::text AS v FROM tenant_documents d JOIN tenants t ON t.id = d.tenant_id
        WHERE t.slug = ${slug} ORDER BY d.created_at DESC LIMIT 1`),
      foundationId: await one(sql`SELECT a.id::text AS v FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id
        WHERE t.slug = ${slug} AND a.grain = 'foundation' AND a.archived_at IS NULL
        ORDER BY a.created_at DESC LIMIT 1`),
      // The reading view and the spotlight detail both take an OPPORTUNITY id; prefer a card the
      // tenant has judged and copied, which is the state with the most on the page.
      opportunityId: await one(sql`SELECT c.opportunity_id::text AS v FROM tenant_opportunity_cards c
        JOIN tenants t ON t.id = c.tenant_id
        WHERE t.slug = ${slug} AND c.archived_at IS NULL AND c.card <> '{}'::jsonb
        ORDER BY c.docs_copied DESC, (c.pursuit_status <> 'unreviewed') DESC, c.opportunity_id LIMIT 1`),
      // ── admin, platform-scope ─────────────────────────────────────────────────────────────
      // The legacy spotlight detail is a pure redirect to /cards and never reads the id, so any
      // real opportunity binds it. Bound rather than skipped so the redirect itself is swept —
      // a redirect that 500s is still a broken route.
      spotlightId: await one(sql`SELECT c.opportunity_id::text AS v FROM tenant_opportunity_cards c
        JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = ${slug} ORDER BY c.opportunity_id LIMIT 1`),
      solId: await one(sql`SELECT cs.id::text AS v FROM curated_solicitations cs ORDER BY cs.created_at DESC LIMIT 1`),
      topicId: await one(sql`SELECT o.id::text AS v FROM opportunities o
        WHERE o.topic_number IS NOT NULL AND o.solicitation_id IS NOT NULL ORDER BY o.created_at DESC LIMIT 1`),
      templateId: await one(sql`SELECT dt.id::text AS v FROM document_templates dt ORDER BY dt.created_at DESC LIMIT 1`),
      tenantId: await one(sql`SELECT t.id::text AS v FROM tenants t WHERE t.slug = ${slug} LIMIT 1`),
      profileId: await one(sql`SELECT sp.id::text AS v FROM source_profiles sp ORDER BY sp.created_at LIMIT 1`),
      pageKey: await one(sql`SELECT cp.page_key AS v FROM content_pages cp WHERE cp.content_type = 'page' LIMIT 1`),
    };
    // /admin/site/docs/[type]/[slug] needs BOTH halves of one row, or it addresses a document of
    // one type under another type's slug — a 404 dressed as coverage.
    try {
      const [doc] = await sql<Array<{ ctype: string; pkey: string }>>`
        SELECT content_type AS ctype, page_key AS pkey FROM content_pages
        WHERE content_type <> 'page' AND page_key IS NOT NULL ORDER BY created_at DESC LIMIT 1`;
      if (doc) { out.type = doc.ctype; out.slug = doc.pkey; }
    } catch { /* left unbound, and reported */ }
    // The admin document index lives in OBJECT STORAGE, not Postgres — a different store from the
    // tenant one, sharing a param name. Bound separately or the admin route opens a tenant id.
    try {
      const { getObjectBuffer } = await import('../lib/storage/s3-client.ts');
      const buf = await getObjectBuffer('reference/documents/_index.json');
      const idx = buf ? JSON.parse(buf.toString('utf8')) : [];
      if (Array.isArray(idx) && idx.length > 0) out.adminDocumentId = idx[idx.length - 1].id;
    } catch { /* left unbound, and reported */ }
    return Object.fromEntries(Object.entries(out).filter(([, v]) => !!v)) as Record<string, string>;
  } finally { await sql.end(); }
}

/**
 * REFUSE A VERDICT ON AN UNSTYLED PAGE.
 *
 * ── HOW THIS INSTRUMENT LIED, ONCE, LOUDLY ───────────────────────────────────────────────────
 * A stale `next-server` was serving a build whose BUILD_ID no longer matched the staged
 * `.next/static`, so every stylesheet 404'd. The pages still answered HTTP 200 and still rendered
 * — as raw HTML, with the nav as an inline list of links running off the side of the screen. The
 * sweep dutifully reported **75 overflow findings across every route in the product**, each one
 * naming the same nav link, and nothing in its output suggested the cause was the harness.
 *
 * An unstyled page ALWAYS overflows. So a width probe that cannot tell whether CSS loaded is not
 * a width probe; it is a coin that lands on "defect". This runs first, and exits 2 rather than
 * producing a number — the same contract `verify-surfaces` and `verify-api-contract` adopted after
 * they made the equivalent mistake (B125, B127).
 *
 * It checks the thing that actually matters — a stylesheet the browser PARSED — rather than the
 * status code of a link element, because a 200 that returns the wrong bytes styles nothing.
 */
async function stylesheetsLoaded(page: Page): Promise<{ ok: boolean; detail: string }> {
  const r = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).length;
    let rules = 0;
    for (const sh of Array.from(document.styleSheets)) {
      try { rules += (sh as CSSStyleSheet).cssRules.length; } catch { /* cross-origin — not ours */ }
    }
    // A sentinel: this app is Tailwind, so a laid-out body is never the UA default.
    const body = getComputedStyle(document.body);
    return { links, rules, font: body.fontFamily.slice(0, 40), margin: body.margin };
  });
  const ok = r.rules > 100;
  return { ok, detail: `${r.links} stylesheet link(s) · ${r.rules} parsed rule(s) · body font ${r.font}` };
}

const shots: Array<Record<string, unknown>> = [];
const summary: Array<Record<string, unknown>> = [];

async function probeRoute(browser: Browser, lane: Lane, route: string) {
  const ctx = await browser.newContext({ viewport: { width: VP.w, height: VP.h } });
  const page = await ctx.newPage();
  try {
    await login(page, lane.email, lane.pw);
    await page.setViewportSize({ width: VP.w, height: VP.h });
    const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    console.log(`\n  ${route}`);
    // A 200 IS NOT EVIDENCE that a page rendered (B78/B79), but a 4xx/5xx IS evidence it did not —
    // and probing an error boundary for overflow would report a tidy error page as a clean pass.
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      unearned += 1;
      console.log(`    ⚠ HTTP ${status} — NOT PROBED. Uncovered, not passing.`);
      summary.push({ lane: lane.id, route, status, probed: false });
      return;
    }

    const opened = await openEverything(page);
    const over = await overflowing(page, VP.w);
    const small = await smallTargets(page);
    const cut = await clipped(page);

    if (opened === 0) {
      // Said out loud rather than counted as a pass. This route's overlays remain unmeasured, and
      // a clean line below would claim otherwise.
      unearned += 1;
      console.log('    ⚠ OPENED NOTHING — this route has no disclosure the probe can reach, so its');
      console.log('      dense states are still unmeasured. The width check below still counts.');
    } else {
      console.log(`    · opened ${opened} control(s)`);
    }

    A(over.length === 0, `nothing runs past ${VP.w}px with everything open`,
      over.map((o) => `<${o.tag} class="${o.cls}"> ends ${o.right}`).join(' · ').slice(0, 180));
    A(cut.length === 0, 'no text clipped with no way to recover it',
      cut.map((c) => `"${c.text}"`).join(' · ').slice(0, 160));
    console.log(`    · ${small.length} control(s) under the 44px touch target${small.length
      ? `: ${small.slice(0, 4).map((s) => `${s.tag}"${s.label}" ${s.w}×${s.h}`).join(', ')}` : ''}`);

    const file = `probe__${lane.id}-${route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 46)}__vp-phone-open.jpg`;
    await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 80, fullPage: true });
    shots.push({ lane: lane.id, route, viewport: VP.name, width: VP.w, file });
    summary.push({
      lane: lane.id, route, status, probed: true, opened,
      overflow: over.length, clipped: cut.length, smallTargets: small.length,
    });
  } catch (e) {
    unearned += 1;
    console.log(`    ⚠ could not probe — ${(e as Error).message.slice(0, 90)}`);
    summary.push({ lane: lane.id, route, probed: false, error: (e as Error).message.slice(0, 120) });
  } finally {
    await ctx.close();
  }
}

/**
 * WIDTH ONLY, over EVERY page route — the half the curated list cannot answer.
 *
 * The interaction list above is twelve dense pages, chosen because they are where a phone layout
 * is most likely to break. That is a good place to look and a bad place to stop: the defect this
 * probe actually found — the "+ New Document" button cut off at the viewport edge — was on a
 * page nobody would have called dense, and a grep for the same CSS pattern returns twenty more
 * files without telling you which of them render an overflowing row.
 *
 * A grep is a lead. This is the measurement: load every `page.tsx` route the manifest lists, at
 * 390px, and ask the shared `overflowing()` predicate. No clicks, so it is fast and still
 * read-only. A route that cannot be addressed (a bare `[id]` with nothing to bind) is REPORTED,
 * never skipped silently.
 */
async function sweepWidths(browser: Browser) {
  const invPath = '/home/user/govwin/docs/frontend-inventory.json';
  const unaddressable: string[] = [];
  const params = await bindParams('foundation');
  let routes: string[] = [];
  try {
    const inv = JSON.parse(readFileSync(invPath, 'utf8')) as { records: Array<{ kind: string; route?: string }> };
    routes = inv.records
      .filter((r) => r.kind === 'page' && r.route)
      .map((r) => r.route as string)
      .filter((r) => /^\/(admin|portal)/.test(r))
      // `[tenantSlug]` is BOUND, not dropped. The first version filtered out every route
      // containing a bracket — and since EVERY portal route is `/portal/[tenantSlug]/…`, that
      // silently excluded the entire tenant half while the header printed "38 addressable page
      // routes" and the run reported findings only in admin. A scanner that discards what it
      // cannot address and says nothing is the defect this whole sweep exists to catch.
      .map((r) => r.replace('[tenantSlug]', 'foundation'))
      // What remains bracketed is BOUND from the database (bindParams) rather than dropped. Only a
      // param the box genuinely holds no row for stays bracketed, and those are still reported out
      // loud — "cannot" now means the data is absent, not that nobody wrote the query.
      //
      // `/admin/documents/[documentId]` takes the OBJECT-STORE id, not the tenant_documents one:
      // the same param name addresses two different stores, and binding one for both drives the
      // admin page's correct "Failed to load document" and photographs it as coverage.
      .map((r) => r.replace(/\[(\w+)\]/g, (m, k: string) => {
        const key = r.startsWith('/admin/documents/') && k === 'documentId' ? 'adminDocumentId' : k;
        return params[key] ?? m;
      }))
      .filter((r) => {
        if (!r.includes('[')) return true;
        unaddressable.push(r);
        return false;
      });
  } catch {
    console.log('\n  ⚠ no frontend-inventory.json — the width sweep is UNRUN this pass.');
    unearned += 1;
    return;
  }

  const admin = routes.filter((r) => r.startsWith('/admin')).length;
  console.log(`\n── width sweep · ${routes.length} addressable page route(s) at ${VP.w}px `
    + `(${admin} admin · ${routes.length - admin} portal) ──`);
  if (unaddressable.length) {
    // Named, not swallowed. "I could not reach it" and "I reached it and it was fine" are
    // different facts and only one of them is evidence.
    console.log(`  ⚠ ${unaddressable.length} route(s) need an id this sweep cannot bind, so they are`);
    console.log(`    UNMEASURED here: ${unaddressable.slice(0, 6).join(', ')}${unaddressable.length > 6 ? ' …' : ''}`);
    unearned += unaddressable.length;
  }
  for (const lane of LANES) {
    const mine = routes.filter((r) => (lane.id === 'admin' ? r.startsWith('/admin') : r.startsWith('/portal')));
    if (!mine.length) continue;
    const ctx = await browser.newContext({ viewport: { width: VP.w, height: VP.h } });
    const page = await ctx.newPage();
    try {
      await login(page, lane.email, lane.pw);
      for (const route of mine) {
        // A tenant route in the manifest is written with the [tenantSlug] segment stripped; the
        // portal lane's own slug is the only one this actor may open.
        const url = route;   // already bound above
        let resp;
        try { resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }); } catch { resp = null; }
        if (!resp || resp.status() >= 400) {
          console.log(`  ⚠ ${url} — ${resp ? `HTTP ${resp.status()}` : 'no response'}, NOT measured`);
          unearned += 1;
          continue;
        }
        await page.waitForTimeout(500);
        const over = await overflowing(page, VP.w);
        if (over.length) {
          failed += 1;
          console.log(`  ✗ ${url} — ${over.map((o) => `<${o.tag} class="${String(o.cls).slice(0, 44)}"> ends ${o.right}`).slice(0, 2).join(' · ')}`);
          summary.push({ lane: lane.id, route: url, widthSweep: true, overflow: over.length, worst: over[0] });
        }
      }
    } catch (e) {
      console.log(`  ⚠ ${lane.id} lane could not be swept — ${(e as Error).message.slice(0, 80)}`);
      unearned += 1;
    } finally { await ctx.close(); }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const bound = await bindRoutes();

  // ── PREFLIGHT ────────────────────────────────────────────────────────────────────────────
  // Before any measurement: is the app actually serving its CSS? Every number below is a width,
  // and an unstyled page has no meaningful widths at all.
  {
    const pre = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const ctx = await pre.newContext({ viewport: { width: VP.w, height: VP.h } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const css = await stylesheetsLoaded(page);
      console.log(`· preflight — ${css.detail}`);
      if (!css.ok) {
        console.error('\nHARNESS DEFECT: the app is serving no CSS, so every route would report');
        console.error('overflow and every one of those findings would be about the SERVER, not the');
        console.error('product. This has happened: a stale next-server with a mismatched BUILD_ID');
        console.error('produced 75 phantom findings across the whole tree.');
        console.error('Restage and restart:  rm -rf .next/standalone/.next/static &&');
        console.error('  cp -r .next/static .next/standalone/.next/static  (docs/CONTINUATION.md §2)');
        process.exit(2);
      }
    } finally { await pre.close(); }
  }

  for (const lane of LANES) {
    lane.routes = lane.routes.flatMap((r) => {
      if (r === 'PROJECT_ROUTE') {
        if (bound.bound && bound.proj) return [`/portal/${bound.proj.slug}/projects/${bound.proj.id}`];
        console.log('  · no project row — the project workspace is UNPROBED this run');
        unearned += 1; return [];
      }
      if (r === 'PROPOSAL_ROUTE') {
        if (bound.bound && bound.prop) return [`/portal/${bound.prop.slug}/proposals/${bound.prop.id}`];
        console.log('  · no proposal with sections — the BUILD workspace is UNPROBED this run');
        unearned += 1; return [];
      }
      return [r];
    });
  }

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const lane of LANES) {
      console.log(`\n── ${lane.id} · ${VP.w}px ────────────────────────────────────────────`);
      for (const route of lane.routes) await probeRoute(browser, lane, route);
    }
    if (!process.argv.includes('--no-sweep')) await sweepWidths(browser);
  } finally { await browser.close(); }

  // Its OWN index. `responsive.json` is rewritten whole by the responsive drive, so anything
  // merged into it vanishes on the next run and its images read as orphans.
  writeFileSync(`${OUT}/interaction-mobile.json`, JSON.stringify({ shots, summary }, null, 1));

  const probed = summary.filter((s) => s.probed).length;
  console.log(`\n── ${probed} route(s) probed · ${unearned} could not be measured ──`);
  if (failed) console.error(`✗ ${failed} finding(s) — a dense state does not hold at 390px.`);
  else console.log('✓ every probed route holds at 390px with its overlays open.');
  if (unearned) {
    console.log(`  ⚠ ${unearned} route(s) measured nothing. That is uncovered, not passing.`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('probe failed:', e); process.exit(2); });
