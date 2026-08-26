/**
 * The two front-door guides, captured against the build that is actually running.
 *
 * `docs/CUSTOMER_ONBOARDING_GUIDE.md` and `docs/RFP_ADMIN_OPERATIONS_GUIDE.md` are the first thing
 * a founding-cohort customer and a new RFP admin read, and until now neither contained a single
 * screenshot — 968 lines of prose describing screens nobody had looked at while writing them. The
 * illustrated material (docs/manuals, docs/user-guides) is a different, generated family; these two
 * are hand-written and had drifted with nothing to catch it.
 *
 * So this is not only a capture. Every target is VISITED as the real actor through the real login,
 * and each one records what the browser actually got: the final URL (a redirect is a finding — the
 * guide naming a route the product moved is exactly the drift a screenshot pass is for), an HTTP
 * status, any uncaught client error, and whether the page rendered an error boundary. A target that
 * fails is reported, never silently skipped — the failure IS the result.
 *
 *   cd frontend && node scripts/capture-guides.mjs [--only customer|admin]
 *
 * Writes docs/assets/guides/{customer,admin}/*.png and prints a per-target table.
 * Exit 0 if every target rendered; 1 if any failed, so it can gate.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { countErrorSurfaces } from './lib/error-surface.mjs';

// Both defaults previously pointed at a rig that no longer exists — :3001 and the retired
// /tmp :5433 box (task #187 moved the sandbox to :5432). A default that names a dead address
// fails as a connection error, which reads like an environment problem rather than rot, so it
// survives. These now name the rig docs/CONTINUATION.md §2 actually brings up.
const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// The OWNER connection on purpose: this script's own bookkeeping (which section is unlocked, which
// document is a deck) is a legitimate cross-tenant read, and the SCOPED role is what the app under
// test uses. Mixing them up is B86 — a harness that sees nothing reports a clean, empty box.
const DB = process.env.GUIDE_DB || process.env.DATABASE_URL_OWNER
  || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const ROOT = '/home/user/govwin';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1]
  || (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '');

const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/**
 * The IDs are LOOKED UP, never hardcoded. Every prior capture script in this repo pins a UUID at
 * the top and silently produces a 404 screenshot the day that row is reseeded — which is how a
 * guide ends up illustrated with an error page. If a lookup finds nothing the target is dropped
 * with a reason, which is visible in the report.
 */
async function ids() {
  // AN IN-FLIGHT BUILD FIRST, then the richest one.
  //
  // These guides illustrate the surface a customer WORKS in, and the working surface of a locked,
  // submitted build is not the working surface — "My Sections" has no editable section to open, so
  // the tab never resolves and the capture times out. Ordering purely by section count picked the
  // biggest build, which on a mature fixture is always a finished one.
  //
  // Unlocked first (a real in-flight build), richest within that, so the screenshots show the
  // editor as a reader will meet it. Falls back to a locked build when nothing is in flight — the
  // capture still runs and the failing target reports itself, which is the honest outcome.
  const [rich] = await sql`
    SELECT p.id, p.tenant_id, t.slug
    FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.archived_at IS NULL AND t.slug = 'foundation'
    ORDER BY COALESCE(p.is_locked, false) ASC,
             (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC
    LIMIT 1`;
  // AN UNLOCKED SECTION WITH REAL CONTENT, for the same reason the build above is unlocked.
  //
  // A locked section renders READ-ONLY: no toolbox, no insert palette, no format drawer, no
  // selection verbs. Every canvas capture below would be a screenshot of the view-only surface
  // labelled as the editing one — a guide that shows the reader controls they will not find.
  // Content length matters too: the selection toolbar reads a live text selection back to the
  // model, and an empty node has nothing to select.
  const [sect] = rich ? await sql`
    SELECT id FROM proposal_sections WHERE proposal_id = ${rich.id}
    ORDER BY COALESCE(is_locked, false) ASC, length(COALESCE(content, '')) DESC,
             sort_index ASC NULLS LAST, section_number ASC
    LIMIT 1` : [];
  // A "topic" is an `opportunities` row hanging off the solicitation — there is no
  // `solicitation_topics` table, and assuming one is how a capture script ends up shooting a 404.
  // This mirrors the predicate the topic PAGE itself runs, so a row found here is a row it renders.
  const [sol] = await sql`
    SELECT cs.id
    FROM curated_solicitations cs
    WHERE cs.solicitation_title IS NOT NULL
    ORDER BY (SELECT count(*) FROM opportunities o WHERE o.solicitation_id = cs.id) DESC,
             cs.created_at DESC
    LIMIT 1`;
  const [topic] = sol ? await sql`
    SELECT id FROM opportunities WHERE solicitation_id = ${sol.id} ORDER BY created_at LIMIT 1` : [];
  const [portal] = await sql`
    SELECT pp.id, t.slug FROM proposal_portals pp JOIN tenants t ON t.id = pp.tenant_id
    ORDER BY pp.created_at DESC LIMIT 1`;
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  // The admin-side canvas: a master template with an actual body, because an empty skeleton opens
  // the editor on a blank page and a guide illustrated with one teaches nothing.
  const [tpl] = await sql`
    SELECT id FROM document_templates
    WHERE canvas_document IS NOT NULL
    ORDER BY jsonb_array_length(COALESCE(canvas_document->'nodes', '[]'::jsonb)) DESC,
             created_at DESC
    LIMIT 1`;
  const [adminDoc] = await sql`
    SELECT id FROM tenant_documents ORDER BY node_count DESC NULLS LAST, created_at DESC LIMIT 1`;
  return {
    proposalId: rich?.id, sectionId: sect?.id, solId: sol?.id, topicId: topic?.id,
    portalId: portal?.id, portalSlug: portal?.slug, tenantId: tenant?.id,
    templateId: tpl?.id, adminDocId: adminDoc?.id,
    ...(await canvasDocIds(tenant?.id)),
  };
}

/**
 * The three canvas SURFACES need three canvas FORMATS, and the fixture only had one.
 *
 * `canvas.format` is what forks the editor: `letter`/`custom` → CanvasRenderer (fluid pages),
 * `slide_16_9`/`slide_4_3` → SlideEditor (discrete section-per-slide), `spreadsheet` → SheetEditor
 * (grid + chart + ribbon). Every one of the 78 stored proposal sections is `letter`, and both
 * standalone documents were `letter` too — so two of the three surfaces the guides must document
 * existed only in code. Prose describing a screen nobody has looked at is exactly the drift this
 * capture pass exists to kill.
 *
 * Looked up rather than created when one already exists, so repeated runs do not silt the tenant's
 * document list up with a new deck every time. When one is missing the run creates it through the
 * product's OWN chooser (below) — not by inserting a row, because a row I hand-write proves the
 * editor renders my JSON, not that the product's own starter does.
 */
async function canvasDocIds(tenantId) {
  if (!tenantId) return { deckDocId: null, sheetDocId: null };
  const pick = async (formats) => {
    const [r] = await sql`
      SELECT id FROM tenant_documents
      WHERE tenant_id = ${tenantId}
        AND canvas->'canvas'->>'format' = ANY(${formats})
      -- Richest first. A blank starter of the right FORMAT satisfies a naive "is there one?" and
      -- puts an empty editor in the guide; the reader concludes the surface is broken.
      ORDER BY COALESCE(node_count, 0) DESC, created_at DESC LIMIT 1`;
    return r?.id ?? null;
  };
  return {
    deckDocId: await pick(['slide_16_9', 'slide_4_3']),
    sheetDocId: await pick(['spreadsheet']),
  };
}

/**
 * The overlay chips' `title` strings, copied verbatim from `components/canvas/canvas-overlays.tsx`.
 * The label ("Sections") is a substring of half the outline rail; the hint is unique. Copied rather
 * than paraphrased — verification rule 3: the predicate comes from the source, not from a version
 * of it I believe to be equivalent.
 */
const OVERLAY_HINTS = [
  'Dotted boundary + label at each section start',
  'Dotted outline on every content primitive',
  'Source gutter — AI · Library · Reuse',
];

const results = [];
async function settle(p, ms = 1800) {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(ms);
}

/**
 * One target: go there, record what came back, shoot it.
 *
 * `expect` is the route as the GUIDE names it. When the product redirects elsewhere the row is
 * marked REDIRECT rather than passed — a guide that sends a reader to a route the product retired
 * is broken even though the screenshot looks fine.
 */
async function target(page, outDir, { name, url, expect, full = true, before, viewport, shoot = true }) {
  const rec = { name, url, status: null, landed: null, note: '', ok: false };
  const clientErrs = page.__errs ?? (page.__errs = watchErrors(page));
  const errsBefore = clientErrs.length;
  try {
    if (viewport) await page.setViewportSize(viewport);
    const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    rec.status = resp?.status() ?? null;
    await settle(page);
    if (before) await before(page).catch((e) => { rec.note = 'setup: ' + String(e.message).slice(0, 50); });
    await settle(page, 700);
    rec.landed = page.url().replace(BASE, '');
    // EVERY error surface the product can render — from the ONE shared definition.
    //
    // Next returns 200 for a client-side boundary and the throw never reaches the server log, so
    // the RENDERED TEXT is the only evidence there is (B78). This harness kept its own copy of the
    // list, that copy missed a bare "Document not found", and an error page was captured into the
    // admin guide as a working screen. `scripts/lib/error-surface.mjs` is now the single source.
    // Client `pageerror`s are collected too: a page that renders but throws is a broken page that
    // a status code calls fine.
    const errored = await countErrorSurfaces(page);
    // `expect` defaults to the route ITSELF, and the compare is exact. The first version defaulted
    // to a prefix (`/portal/foundation`) that every portal route satisfies, so three retired
    // library routes redirected to /atoms, produced three byte-identical screenshots, and reported
    // a clean pass — the guide would have been illustrated at routes the product no longer serves.
    const want = expect ?? url;
    const redirected = rec.landed.split('?')[0] !== want.split('?')[0];
    if (shoot) await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: full });
    const thrown = clientErrs.slice(errsBefore);
    rec.ok = (rec.status ?? 200) < 400 && errored === 0 && thrown.length === 0;
    if (errored) rec.note = 'error boundary rendered' + (thrown[0] ? ` — ${thrown[0]}` : '');
    else if (thrown.length) rec.note = `client threw — ${thrown[0]}`;
    else if (redirected) rec.note = `redirected to ${rec.landed}`;
  } catch (e) {
    rec.note = String(e.message).slice(0, 70);
  }
  results.push(rec);
  console.log(`  ${rec.ok ? '✓' : '✗'} ${name.padEnd(30)} ${String(rec.status ?? '—').padStart(3)}  ${rec.note}`);
  return rec.ok;
}

/** Click a named tab on a tabbed surface, then shoot it. The unified library is tabs, not routes. */
async function tabShot(page, outDir, name, label, full = true) {
  const rec = { name, url: page.url().replace(BASE, '') + ` [tab: ${label}]`, status: 200, landed: null, note: '', ok: false };
  try {
    const tab = page.locator(`button:has-text("${label}"), [role="tab"]:has-text("${label}")`).first();
    if (await tab.count() === 0) throw new Error(`no tab labelled "${label}"`);
    await tab.click();
    await settle(page, 1600);
    rec.landed = page.url().replace(BASE, '');
    await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: full });
    rec.ok = true;
  } catch (e) {
    rec.note = String(e.message).slice(0, 70);
  }
  results.push(rec);
  console.log(`  ${rec.ok ? '✓' : '✗'} ${name.padEnd(30)} tab  ${rec.note}`);
  return rec.ok;
}

/**
 * One INTERACTION, shot. The canvas is not a set of routes — every surface below the section
 * editor is a state you reach by acting: toggling an overlay chip, selecting a run of text,
 * clicking a node, opening a toolbox card. `target()` cannot express any of that.
 *
 * `prove` is what makes the row an assertion rather than a click. Without it a shot of a panel
 * that silently failed to open is a screenshot of the page behind it, captioned as the panel —
 * the same class of lie as a 200 standing in for a render (B78). The step fails loudly instead.
 */
async function act(page, outDir, { name, run, prove, full = false, settleMs = 900 }) {
  const rec = { name, url: page.url().replace(BASE, ''), status: 200, landed: null, note: '', ok: false };
  const clientErrs = page.__errs ?? (page.__errs = watchErrors(page));
  const errsBefore = clientErrs.length;
  try {
    await run(page);
    await settle(page, settleMs);
    // Same error-surface gate as `target()`. An interaction can navigate — `reopen`, the template
    // "Use this template" click — and land on a broken page, and a `prove` selector that happens
    // to match would pass it. Checked first, so "the page is broken" beats "the panel opened".
    if (await countErrorSurfaces(page) > 0) throw new Error('error surface rendered');
    if (prove) {
      const seen = await page.locator(prove).count();
      if (seen === 0) throw new Error(`nothing matched "${prove}" — the surface did not open`);
    }
    rec.landed = page.url().replace(BASE, '');
    await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: full });
    const thrown = clientErrs.slice(errsBefore);
    if (thrown.length) rec.note = `client threw — ${thrown[0]}`;
    rec.ok = thrown.length === 0;
  } catch (e) {
    rec.note = String(e.message).slice(0, 90);
  }
  results.push(rec);
  console.log(`  ${rec.ok ? '✓' : '✗'} ${name.padEnd(30)} act  ${rec.note}`);
  return rec.ok;
}

/**
 * A surface this pass TRIED to capture and could not. A failing row: the guide documents it, the
 * run went for it, and it did not come back — that is a finding, not a footnote.
 */
function notCaptured(name, url, why) {
  results.push({ name, url, status: null, landed: null, ok: false, note: `${why} — surface NOT captured` });
  console.log(`  ✗ ${name.padEnd(30)}  —   ${why}`);
}

/**
 * A route that is KNOWN not to be addressable on this fixture, with the reason. Reported in its own
 * section of the summary and does NOT fail the run.
 *
 * The distinction matters both ways. Failing on it forever would make the gate permanent noise, and
 * noise is what teaches a reader to skim the section where a real regression appears. Staying
 * silent about it would let an uncaptured surface pass for a covered one — which is how a
 * "Document not found" page ended up in the admin guide captioned as a working canvas.
 */
const unaddressable = [];
function notAddressable(route, why) {
  unaddressable.push({ route, why });
  console.log(`  ·  ${route.padEnd(38)} not addressable — ${why}`);
}

/** Attach the client-error collector — a page that throws is not a page that rendered. */
function watchErrors(p) {
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error' && /error boundary|TypeError|ReferenceError/i.test(m.text())) errs.push(m.text().slice(0, 120)); });
  return errs;
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email);
  await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await settle(p, 2600);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email} → ${p.url()}`);
  return p;
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const V = { width: 1440, height: 900 };
const ID = await ids();
console.log('resolved ids:', JSON.stringify(ID, null, 0), '\n');

try {
  // ─────────────────────────── CUSTOMER (tenant_admin) ───────────────────────────
  if (!only || only === 'customer') {
    const OUT = path.join(ROOT, 'docs/assets/guides/customer');
    fs.mkdirSync(OUT, { recursive: true });
    console.log('── customer · kate.ulepic@foundation3dp.com (tenant_admin, foundation) ──');

    // Step 2 is the login form itself, which has to be shot BEFORE anyone is signed in.
    {
      const ctx = await browser.newContext({ viewport: V });
      const p = await ctx.newPage();
      await target(p, OUT, { name: '02-login', url: '/login', expect: '/login', full: false });
      await ctx.close();
    }

    const ctx = await browser.newContext({ viewport: V });
    const p = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
    const S = '/portal/foundation';
    await target(p, OUT, { name: '03-dashboard', url: `${S}/dashboard` });
    await target(p, OUT, { name: '03b-command-center', url: `${S}/command` });

    // The three routes the guide names for the library are all RETIRED redirects onto the one
    // unified `/atoms` surface, where upload / review / browse are TABS. Probed (not shot) so the
    // redirect is on the record; the tabs below are what a reader is actually looking at.
    // The three retired library routes. Upload, review and browse are TABS on `/atoms` now, and
    // CUSTOMER_ONBOARDING_GUIDE.md §"Route correction" already tells the reader so.
    //
    // These carry `expect` for the same reason the spotlights probe below does: without it a
    // documented, deliberate redirect reports as "did not land where the guide says" on every run —
    // three permanent lines of noise that train a reader to skim the drift section, which is where
    // the REAL drift will appear. With `expect` they become assertions: the day one of these stops
    // redirecting, or lands somewhere new, that is a finding rather than more of the usual.
    const ATOMS = `${S}/atoms`;
    await target(p, OUT, { name: '04-library-upload(probe)', url: `${S}/library/upload`, expect: ATOMS, shoot: false });
    await target(p, OUT, { name: '05-library-review(probe)', url: `${S}/library/review`, expect: ATOMS, shoot: false });
    await target(p, OUT, { name: '06-library(probe)', url: `${S}/library`, expect: ATOMS, shoot: false });
    await target(p, OUT, { name: '06-library', url: `${S}/atoms` });
    await tabShot(p, OUT, '04-library-upload', 'Upload package');
    await tabShot(p, OUT, '04b-library-atomize', 'Atomize');
    await tabShot(p, OUT, '05-library-review', 'Review');

    await target(p, OUT, { name: '07-cards', url: `${S}/cards` });
    await target(p, OUT, { name: '07b-buckets', url: `${S}/buckets` });
    // The guide tells the reader `/spotlights` redirects to `/cards`. That claim is a live
    // assertion, not prose — probe where it actually lands.
    await target(p, OUT, { name: '07c-spotlights(probe)', url: `${S}/spotlights`, expect: `${S}/cards`, shoot: false });
    await target(p, OUT, { name: '08-portals', url: `${S}/portals` });
    if (ID.portalId && ID.portalSlug === 'foundation') {
      await target(p, OUT, { name: '08b-workflow-setup', url: `${S}/portals/${ID.portalId}` });
    }
    if (ID.proposalId) {
      // Viewport, not fullPage: the workspace OPENS on the Document tab, so a full-page shot here
      // and the `09b` tab shot below were byte-for-byte identical — two guide figures showing one
      // screen. This one is the head of the page (header · readiness · Studio · the tab row); 09b
      // is the whole assembled canvas underneath it.
      await target(p, OUT, { name: '09-proposal-workspace', url: `${S}/proposals/${ID.proposalId}`, full: false });
      // THE SURFACE THE PRODUCT ACTUALLY OPENS ON, which the guides did not illustrate.
      //
      // `proposal-workspace.tsx:177` opens a tenant-wide member on the `document` tab — the fluid,
      // whole-proposal canvas — and scopes a non-tenant-wide collaborator to `my-sections`. The
      // canvas review (docs/CANVAS_ARCHITECTURE.md §2, re-verified 2026-08-23) found the guides
      // describing the per-section editor as *the* working surface, which is the tab a reader
      // reaches second. Capture the default, with its overlay bar and its four selection verbs.
      await tabShot(p, OUT, '09b-fluid-document', 'Document');

      // ── THE INTERACTION LAYER, on the surface it was built for ───────────────────────────
      //
      // Overlays, the scope ladder and the selection verbs are STATES, not routes. Nothing in a
      // route-driven capture pass can reach them, which is why 968 lines of guide described the
      // canvas as "the editor" and stopped. Each is driven the way a reader drives it.
      await act(p, OUT, {
        name: '09d-fluid-overlays',
        // Structure-as-overlay: off by default (a clean document until a chip is summoned), so
        // the guide has to show the reader BOTH states or the chips read as decoration.
        // Addressed by the chip's own TITLE, not its label. `:has-text("Sections")` also matches
        // any outline-rail entry whose section title contains the word — a substring match that
        // would toggle a section jump and shoot the wrong screen while reporting success.
        run: async (pg) => {
          for (const hint of OVERLAY_HINTS) {
            const chip = pg.locator(`button[title="${hint}"]`).first();
            if (await chip.count()) await chip.click();
          }
        },
        prove: '.cv-ov.ov-sections',
      });
      await act(p, OUT, {
        name: '09e-fluid-layers',
        // Compliance + budget are the same summonable-layer idea over REAL data — the coverage
        // count and the page estimate the export gate reads.
        run: async (pg) => {
          for (const label of ['Compliance', 'Budget']) {
            const chip = pg.locator(`button[title*="${label === 'Budget' ? 'Page budget' : 'Compliance coverage'}"]`).first();
            if (await chip.count()) await chip.click();
          }
        },
        prove: 'text=/Budget:|Compliance:/',
      });
      await act(p, OUT, {
        name: '09f-fluid-scope',
        // Click a block → the ladder re-focuses on it. The rungs (Element ‹ Section ‹ Document)
        // and the Blocks/Pages/Characters read-out are the whole point: the same numbers the
        // compliance gate and the character budget use.
        run: async (pg) => {
          // `\w` excludes spaces, so the first version of this filter (`/\w{40,}/`) demanded 40
          // consecutive word characters — a run no English prose contains. It matched nothing on a
          // document full of prose and timed out. Match a long stretch of PROSE instead.
          const node = pg.locator('[data-node-id]').filter({ hasText: /[A-Za-z][\s\S]{80,}/ }).first();
          await node.scrollIntoViewIfNeeded();
          await node.click({ position: { x: 12, y: 8 } });
        },
        prove: 'text=Scope',
      });
      await act(p, OUT, {
        name: '09g-fluid-selection',
        // "Selection is the verb." A real triple-click, because the toolbar reads a live
        // window.getSelection() back to the model through the [data-node-id] anchors — a
        // programmatic selection would prove the component renders, not that a person can raise it.
        //
        // RELOADED FIRST, and that is not tidiness. The preceding step left a block SELECTED, and
        // a triple-click inside an already-selected block does not raise the toolbar — the run
        // failed exactly there while the same gesture on a fresh page worked. Which is also the
        // truthful order for a guide: a reader selects a phrase to act on it, they have not
        // necessarily clicked the block first.
        run: async (pg) => {
          await pg.reload({ waitUntil: 'domcontentloaded' });
          await settle(pg, 2200);
          const doc = pg.locator('button:has-text("Document")').first();
          if (await doc.count()) { await doc.click(); await settle(pg, 1600); }
          // `\w` excludes spaces, so the first version of this filter (`/\w{40,}/`) demanded 40
          // consecutive word characters — a run no English prose contains. It matched nothing on a
          // document full of prose and timed out. Match a long stretch of PROSE instead.
          const node = pg.locator('[data-node-id]').filter({ hasText: /[A-Za-z][\s\S]{80,}/ }).first();
          await node.scrollIntoViewIfNeeded();
          await node.click({ clickCount: 3 });
        },
        prove: 'button:has-text("Atomize")',
      });

      await tabShot(p, OUT, '09c-my-sections', 'My Sections');

      if (ID.sectionId) {
        const SEC = `${S}/proposals/${ID.proposalId}/sections/${ID.sectionId}`;
        // The canvas is a fixed-viewport surface: a fullPage shot of a paginated editor is a
        // 12,000px strip nobody can read in a guide.
        await target(p, OUT, { name: '10-canvas-editor', url: SEC, full: false });

        // ── THE SECTION EDITOR'S OWN DEPTH ─────────────────────────────────────────────────
        //
        // Everything here hangs off the toolbox — the role×context card list whose cards route to
        // sidebar tabs. Driven BY CARD TITLE, which is what a reader sees and what the guide will
        // name, so a renamed card breaks this run rather than silently mis-illustrating the guide.
        //
        // EXACT on the title span, not `has-text` on the button: "Insert" is a substring of
        // "Insert from Library", so a substring match would open the library panel and shoot it
        // captioned as the insert palette — a passing row illustrating the wrong screen.
        const card = (title) => async (pg) => {
          const b = pg.locator('button').filter({ has: pg.locator(`span:text-is("${title}")`) }).first();
          await b.scrollIntoViewIfNeeded();
          await b.click();
        };
        const reopen = async (pg) => { await pg.goto(BASE + SEC, { waitUntil: 'domcontentloaded' }); await settle(pg, 1400); };

        await act(p, OUT, { name: '14-canvas-insert', run: card('Insert'), prove: 'text=Paragraph' });
        await act(p, OUT, {
          name: '15-canvas-format',
          // Format acts on a SELECTED block, so select one first — otherwise the tab renders its
          // "Select" empty state and the guide shows an empty drawer captioned as the ribbon.
          run: async (pg) => {
            const node = pg.locator('[data-node-id]').first();
            await node.scrollIntoViewIfNeeded();
            await node.click();
            await settle(pg, 500);
            await card('Format')(pg);
          },
          prove: 'text=/Style|Text|Emphasis/',
        });
        await act(p, OUT, { name: '16-canvas-ai', run: card('AI Assist'), prove: 'text=/Custom instruction|Revis/i' });
        await act(p, OUT, { name: '17-canvas-compliance', run: card('Compliance & Status'), prove: 'text=Document Status' });
        await act(p, OUT, { name: '18-canvas-floorplan', run: card('Floorplan'), prove: 'text=/Margin|Header|Page/i' });
        await act(p, OUT, { name: '19-canvas-library', run: card('Insert from Library'), prove: 'text=Insert from Library' });
        await act(p, OUT, {
          name: '20-canvas-overlays',
          // The SAME chip bar as the fluid view — one OverlayLayer over all four surfaces — which
          // is the point the guide has to make: the dotted structure is not a per-screen gimmick.
          run: async (pg) => {
            await reopen(pg);
            await pg.locator(`button[title="${OVERLAY_HINTS[1]}"]`).first().click();
          },
          prove: '.cv-ov.ov-atoms',
        });
        await act(p, OUT, {
          name: '21-canvas-preview',
          run: async (pg) => { await reopen(pg); await card('Preview')(pg); },
          prove: '[role="dialog"], .fixed.inset-0',
        });
      }
    }

    // ── THE OTHER TWO CANVAS SURFACES ────────────────────────────────────────────────────────
    //
    // `canvas.format` forks the editor three ways, and until this run the fixture could only
    // illustrate one of them. Created through the product's own chooser, not by inserting a row:
    // a row I hand-write proves the editor renders MY json, not that the product's starter does.
    await target(p, OUT, { name: '22-documents-new', url: `${S}/documents/new` });
    await target(p, OUT, { name: '22b-templates-gallery', url: `${S}/templates` });

    // THE DECK, from a real template rather than the blank preset.
    //
    // "Slide deck" under Start blank produces a deck with ZERO nodes, and a screenshot of an empty
    // slide editor teaches a reader nothing about the surface — it looks broken. The gallery is
    // the path the chooser itself points at ("Browse the template library →"), and it yields a
    // populated deck. Reused across runs; instantiated only when the tenant has none.
    if (!ID.deckDocId) {
      await act(p, OUT, {
        name: '23-canvas-slides-create',
        run: async (pg) => {
          await pg.goto(BASE + `${S}/templates`, { waitUntil: 'domcontentloaded' });
          await settle(pg, 1600);
          // FILTER FIRST, which is what the gallery's own search box is for and what a reader does.
          //
          // The first version located the card by an ancestor `div` containing the title text and
          // took `.first()` "Use this template" inside it. Every enclosing div contains that title,
          // including the gallery root — so it matched the root and clicked the FIRST button on the
          // page, instantiating "Commercialization Plan" and then reporting success. The row was
          // green and the deck did not exist. Filtering to one card removes the ambiguity entirely.
          await pg.locator('input[placeholder="Filter templates…"]').fill('Technology Overview');
          await settle(pg, 900);
          const uses = pg.locator('button:has-text("Use this template")');
          if (await uses.count() !== 1) throw new Error(`filter left ${await uses.count()} cards, need exactly 1`);
          await uses.click();
          await pg.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 30000 });
        },
        prove: '[data-node-id]',
        settleMs: 2000,
      });
      ID.deckDocId = (await canvasDocIds(ID.tenantId)).deckDocId;
    }
    if (ID.deckDocId) await target(p, OUT, { name: '23-canvas-slides', url: `${S}/documents/${ID.deckDocId}`, full: false });
    else notCaptured('23-canvas-slides', `${S}/templates`, 'no slide_16_9 document could be obtained');

    // THE GRID. Unlike the deck there is no populated spreadsheet anywhere in the product's
    // catalog — every cost template is a `letter` canvas carrying spreadsheet-flavoured TABLE
    // nodes, because an agency cost form is a page, not a workbook (see docs/COST_VOLUME_FORMS.md).
    // So the grid surface is reached only through the blank Workbook preset, and the guide has to
    // show it doing something. Typed in through the real editor: double-click a cell, type, Enter.
    if (!ID.sheetDocId) {
      await act(p, OUT, {
        name: '24-canvas-sheet-create',
        run: async (pg) => {
          await pg.goto(BASE + `${S}/documents/new`, { waitUntil: 'domcontentloaded' });
          await settle(pg, 1200);
          await pg.locator('button:has-text("Workbook")').first().click();
          await pg.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 30000 });
        },
        prove: 'input[placeholder="Select a cell"]',
        settleMs: 1800,
      });
      ID.sheetDocId = (await canvasDocIds(ID.tenantId)).sheetDocId;
    }
    if (ID.sheetDocId) {
      await act(p, OUT, {
        name: '24-canvas-sheet',
        run: async (pg) => {
          await pg.goto(BASE + `${S}/documents/${ID.sheetDocId}`, { waitUntil: 'domcontentloaded' });
          await settle(pg, 1600);
          const ROWS = [
            ['Direct labor', '184500', '61%'], ['Fringe @ 31.4%', '57933', '19%'],
            ['Materials', '22000', '7%'], ['Subcontract - university', '18000', '6%'],
            ['Indirect @ 42%', '20067', '7%'],
          ];
          // CLICK THE CELL, THEN TYPE — the spreadsheet gesture, and the only one that works.
          //
          // The obvious `dblclick` targets the cell's inner <span>, whose double-click handler
          // starts the edit. On an EMPTY cell that span has no content, so it has no box, so it
          // is not actionable and the click times out — which is exactly how the first attempt
          // failed on a blank workbook. `<td onClick>` sets the active cell and `handleCellKeyDown`
          // opens the editor on the first printable key, seeding it with that character.
          const body = pg.locator('tbody tr');
          if (await body.count() === 0) throw new Error('the grid rendered no rows');
          for (let r = 0; r < ROWS.length; r++) {
            for (let c = 0; c < ROWS[r].length; c++) {
              // +1: the first <td> of each row is the row-number gutter, not a cell.
              const cell = body.nth(r).locator('td').nth(c + 1);
              if (await cell.count() === 0) break;
              await cell.click();
              await pg.keyboard.type(ROWS[r][c], { delay: 30 });
              await pg.keyboard.press('Tab');
            }
          }
          await pg.keyboard.press('Escape');
          // SAVED, not just typed. The first version stopped at the last keystroke and reported
          // success on `text=Direct labor` — which the grid renders from LOCAL state. The document
          // in the database still had `nodes: []`, so the guide's workbook existed only inside that
          // one browser tab and the next run started from an empty grid again. The sheet surface
          // has an explicit Save; a capture that never presses it has not exercised the surface.
          const save = pg.locator('button:has-text("Save")').first();
          if (await save.count()) { await save.click(); await settle(pg, 1200); }
        },
        // EXACT, not substring. `text=Direct labor` also matches "DDirect labor", which is what
        // the grid actually rendered before the doubled-keystroke fix (sheet-editor.tsx) — a
        // substring assertion would have photographed the bug and called it a pass.
        prove: 'span:text-is("Direct labor")',
        settleMs: 1400,
      });
    } else {
      notCaptured('24-canvas-sheet', `${S}/documents/new`, 'no spreadsheet document could be obtained');
    }
    await target(p, OUT, { name: '11-todos', url: `${S}/todos` });
    await target(p, OUT, { name: '12-team', url: `${S}/team` });
    await target(p, OUT, { name: '13-documents', url: `${S}/documents` });
    await ctx.close();
  }

  // ───────────────────────────── ADMIN (master_admin) ─────────────────────────────
  if (!only || only === 'admin') {
    const OUT = path.join(ROOT, 'docs/assets/guides/admin');
    fs.mkdirSync(OUT, { recursive: true });
    console.log('\n── admin · eric@rfppipeline.com (master_admin) ──');
    const ctx = await browser.newContext({ viewport: V });
    const p = await login(ctx, 'eric@rfppipeline.com', ADMIN_PW);
    await target(p, OUT, { name: '01-dashboard', url: '/admin/dashboard' });
    await target(p, OUT, { name: '01b-command-center', url: '/admin/command' });
    await target(p, OUT, { name: '02-applications', url: '/admin/applications' });
    await target(p, OUT, { name: '03-upload-rfp', url: '/admin/rfp-curation/upload' });
    await target(p, OUT, { name: '04-triage-queue', url: '/admin/rfp-curation' });
    if (ID.solId) {
      await target(p, OUT, { name: '05-curation-workspace', url: `/admin/rfp-curation/${ID.solId}` });
      if (ID.topicId) {
        await target(p, OUT, {
          name: '05c-topic-volumes', url: `/admin/rfp-curation/${ID.solId}/topic/${ID.topicId}`,
        });
      }
    }
    await target(p, OUT, { name: '06-opportunities', url: '/admin/opportunities' });
    await target(p, OUT, { name: '07-tenants', url: '/admin/tenants' });
    if (ID.tenantId) {
      await target(p, OUT, { name: '07b-tenant-detail', url: `/admin/tenants/${ID.tenantId}` });
    }
    await target(p, OUT, { name: '08-purchases', url: '/admin/purchases' });
    await target(p, OUT, { name: '08b-provisioning', url: '/admin/provisioning' });
    if (ID.portalId) {
      await target(p, OUT, { name: '08c-provisioning-cockpit', url: `/admin/provisioning/${ID.portalId}` });
    }
    await target(p, OUT, { name: '09-workflows', url: '/admin/workflows' });
    await target(p, OUT, { name: '09b-agents', url: '/admin/agents' });
    await target(p, OUT, { name: '10-events', url: '/admin/events' });
    await target(p, OUT, { name: '10b-scouts', url: '/admin/scouts' });
    await target(p, OUT, { name: '10c-system-state', url: '/admin/system-state' });
    await target(p, OUT, { name: '10d-site-content', url: '/admin/site' });

    // ── THE ADMIN SIDE OF THE CANVAS ─────────────────────────────────────────────────────────
    //
    // The same CanvasDocument, one plane up: the master templates that fan forward onto tenant
    // template cards, the required-item molds a build is provisioned from, and the platform's own
    // standalone documents. The admin guide described the ingest→curate→push spine and stopped at
    // the point where an admin actually AUTHORS the thing a customer will fill in.
    await target(p, OUT, { name: '11-templates', url: '/admin/templates' });
    if (ID.templateId) {
      await target(p, OUT, {
        name: '11b-template-canvas', url: `/admin/templates/${ID.templateId}/edit`, full: false,
      });
    }
    await target(p, OUT, { name: '11c-template-stable', url: '/admin/template-stable' });
    await target(p, OUT, { name: '12-admin-documents', url: '/admin/documents' });
    // `/admin/documents/[documentId]` is backed by the OBJECT-STORAGE document index
    // (`reference/documents/_index.json`), NOT by `tenant_documents` — the two routes just happen
    // to name the segment the same thing. Handing it a table id renders "Document not found", and
    // that is exactly what the first version of this pass did: it shot the error page and reported
    // it green, and the picture went into the admin guide as a working canvas. `verify-surfaces`
    // had already recorded this route as not-by-row with the reason; the fix was to believe it.
    //
    // Reported as NOT captured rather than skipped, because that is the truth on this fixture:
    // the sandbox's admin document store is empty, so the surface is uncovered.
    notAddressable('/admin/documents/[documentId]',
      'object-storage-backed (reference/documents/_index.json), and the sandbox store is empty — '
      + 'a tenant_documents id renders "Document not found"');
    await target(p, OUT, { name: '13-admin-proposals', url: '/admin/proposals' });
    await target(p, OUT, { name: '14-intake', url: '/admin/intake' });
    await target(p, OUT, { name: '14b-sources', url: '/admin/sources' });
    await target(p, OUT, { name: '15-automation-policy', url: '/admin/automation' });
    await ctx.close();
  }
} finally {
  await browser.close();
  await sql.end();
}

const bad = results.filter((r) => !r.ok);
const redir = results.filter((r) => r.ok && r.note.startsWith('redirected'));
console.log(`\n${results.length} target(s) · ${results.length - bad.length} rendered · ${bad.length} failed`);
if (unaddressable.length) {
  console.log(`\n${unaddressable.length} route(s) NOT addressable on this fixture — uncovered, not passing:`);
  for (const u of unaddressable) console.log(`  · ${u.route} — ${u.why}`);
}
if (redir.length) {
  console.log(`\n${redir.length} target(s) did not land where the guide says (a guide correction, not a capture bug):`);
  for (const r of redir) console.log(`  · ${r.name}: ${r.url} → ${r.landed}`);
}
if (bad.length) {
  console.log('\n✗ failed targets — these surfaces are NOT capturable and must not be illustrated as if they were:');
  for (const r of bad) console.log(`  · ${r.name} (${r.url}) — ${r.note || 'status ' + r.status}`);
  process.exit(1);
}
console.log('\n✓ every documented surface rendered for its real actor.');
