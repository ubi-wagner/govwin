#!/usr/bin/env node
/**
 * drive-canvas-overlays.mjs — the canvas OverlayLayer, every layer, on every surface.
 *
 * WHY. The canvas is the densest state surface in the product and every sweep so far has
 * photographed it exactly once: at rest, overlays off, nothing selected. That is the one state an
 * author almost never looks at. The structure they actually work against is painted by five
 * togglable layers, and none of them had ever been captured:
 *
 *   sections    dotted boundary + label at each section start
 *   atoms       dotted outline on every content primitive
 *   groups      runs from one library atom — solid rail = moves as one block
 *   provenance  source gutter: AI · Library · Reuse
 *   grid        measurement grid in points — inch lines, margin box, page ruler
 *
 * `groups` is offered only when the document HAS groups (`overlaysFor`), which is itself a claim
 * worth photographing: a toggle that provably paints nothing is worse than an absent one.
 *
 * ALL THREE SURFACES, and two of them had to be created. `canvas.format` forks into
 * CanvasRenderer / SlideEditor / SheetEditor, and this fixture stores only `letter` — so a deck and
 * a sheet do not exist to be opened. They are authored here through the product's own
 * `POST /documents` (preset `deck` / `sheet` / `flier`), photographed, and removed. Building the
 * scenario and taking it away is the established pattern; the alternative is a baseline that
 * silently covers one surface of three.
 *
 * STATE IS VERIFIED, NOT ASSUMED. Each chip is `<button aria-pressed>`, so the driver toggles and
 * then READS the attribute back before shooting. "I clicked it" is not "it took" (B96), and a
 * screenshot captioned `atoms=on` that was actually off is worse than no screenshot.
 *
 *   cd frontend && node scripts/drive-canvas-overlays.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const REPO = '/home/user/govwin';
const OUT = path.join(REPO, 'docs/ui-canvas');
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });
fs.mkdirSync(OUT, { recursive: true });

/**
 * The five dotted structure layers, plus the two DATA layers that sit beside them on the fluid
 * document view and are summoned the same way (`fluid-document-view.tsx`: "Compliance + Budget
 * layers (real data), summonable like the dotted layers"). They are `aria-pressed` buttons in the
 * same bar, so they belong in the same walk — leaving them out would photograph five of seven
 * togglable layers and call the overlay layer covered.
 */
const OVERLAY_LABELS = ['Sections', 'Atoms', 'Groups', 'Provenance', 'Grid', 'Compliance', 'Budget'];
const shots = [];
const findings = [];
const created = [];
let n = 0;

const slug = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

/**
 * SCROLL TO THE CANVAS BEFORE SHOOTING, or the picture is of the wrong thing.
 *
 * On the proposal workspace the overlay bar sits ~900px down, under the Studio card, the stage rail
 * and the outcome panel. A viewport screenshot therefore captured the chrome and left the painted
 * layers below the fold — ten shots of a page whose overlay state was correctly toggled and
 * entirely invisible. The chip bar is the anchor: scroll it to the top of the viewport and the
 * canvas it controls is the rest of the frame.
 */
async function focusCanvas(page) {
  await page.evaluate(() => {
    const bar = [...document.querySelectorAll('div')].find((d) => /^OVERLAYS/.test((d.textContent || '').trim()));
    const target = bar ?? document.querySelector('[data-node-id]')?.closest('div');
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, Math.max(0, document.body.scrollHeight * 0.35));
  });
  await page.waitForTimeout(450);
}

async function shoot(page, surface, label, meta = {}) {
  const file = `${slug(surface)}__${String(++n).padStart(3, '0')}-${slug(label)}.jpg`;
  await focusCanvas(page);
  await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 82 }).catch(() => {});
  shots.push({ surface, label, file, ...meta });
  return file;
}

/**
 * What the canvas actually CONTAINS — the prerequisite for judging "this layer painted nothing".
 *
 * A blank deck has no nodes, so the Atoms layer has no primitives to outline and draws nothing.
 * That is the layer working. Reporting it as a defect buried the one real case in eleven false
 * ones on the first run. The overlays are painted off data attributes every node wrapper carries
 * (`data-node-id`, `data-node-source`), so the same DOM says whether there was anything to draw:
 *
 *   Atoms       needs ≥1 [data-node-id]
 *   Provenance  needs ≥1 [data-node-source] — a document of hand-typed nodes has no gutter to show
 *   Sections/Groups  need the structure the chip filter already gates on
 *   Grid        needs NOTHING. It is page geometry: margins, inch lines, a page ruler. A doc
 *               surface that draws no grid is unwired, and that is the bug this found.
 */
async function canvasContents(page) {
  return page.evaluate(() => ({
    nodes: document.querySelectorAll('[data-node-id]').length,
    // ONLY the sources the CSS actually paints. `app/globals.css` draws a provenance gutter for
    // `ai_draft`, `library` and `imported` — and deliberately not for `manual`, because hand-typed
    // content has no provenance worth a rail. Counting every `[data-node-source]` therefore asked
    // the wrong question: the Foundation section carries two nodes, both `manual`, so the layer
    // correctly drew nothing and was reported as broken. Match the prerequisite to what the
    // stylesheet keys on, or the check measures a rule the product does not have.
    sourced: document.querySelectorAll(
      '[data-node-source="ai_draft"],[data-node-source="library"],[data-node-source="imported"]',
    ).length,
  }));
}

/** Which chips this document offers, and whether each is currently on. */
async function chipState(page) {
  return page.evaluate((labels) => {
    const out = {};
    for (const b of document.querySelectorAll('button[aria-pressed]')) {
      const t = (b.textContent || '').trim();
      const hit = labels.find((l) => t === l || t.endsWith(l));
      if (hit) out[hit] = b.getAttribute('aria-pressed') === 'true';
    }
    return out;
  }, OVERLAY_LABELS);
}

/** Set one chip to `want`, then READ IT BACK. Returns the observed state. */
async function setChip(page, label, want) {
  const before = await chipState(page);
  if (!(label in before)) return { offered: false };
  if (before[label] !== want) {
    await page.evaluate(([l, labels]) => {
      for (const b of document.querySelectorAll('button[aria-pressed]')) {
        const t = (b.textContent || '').trim();
        if (t === l || t.endsWith(l)) { b.click(); return; }
      }
    }, [label, OVERLAY_LABELS]);
    await page.waitForTimeout(350);
  }
  const after = await chipState(page);
  return { offered: true, is: after[label], took: after[label] === want };
}

/**
 * DID IT ACTUALLY PAINT?
 *
 * `aria-pressed="true"` proves the chip toggled. It says nothing about whether the layer drew
 * anything, and those are different questions with different answers: the Grid chip on the fluid
 * document view reported pressed and painted NOTHING, because the view never passed `grid` to
 * `CanvasRenderer` and no CSS rule backs `ov-grid` either. The chip's own colour change is ~0.1% of
 * the frame; a layer that genuinely draws moves 2% or more. So compare the frame against the
 * all-off baseline and call anything at or below the chip's own footprint what it is.
 *
 * This is the check that turns 38 screenshots from a gallery into a measurement. Without it the
 * captions would have read `overlay-Grid` over a picture of a document with no grid on it, and the
 * file would have looked like evidence.
 */
/**
 * EXCLUDE THE CHIP BAR, then any difference at all is paint.
 *
 * The first version compared whole frames against a 0.35% floor, and that floor was wrong in both
 * directions. A 1px dotted outline around three nodes is a vanishing fraction of a 1600×1000 frame:
 * the Atoms layer paints beautifully — verified by eye, teal dotted boxes around the heading, the
 * italic note and the body — and measures **0.21%**. It was being reported as painting nothing.
 * Meanwhile the chip's own colour change measures 0.09–0.17%, so no threshold cleanly separates
 * "the pill turned blue" from "a hairline outline appeared".
 *
 * Cropping the bar out removes the confound instead of trying to out-guess it. `focusCanvas`
 * scrolls the chip bar to the top of the viewport, so everything above BAR_H is chrome; below it is
 * the canvas the layer draws on. A layer that paints nothing then diffs at ~0.00% and one that
 * paints a hairline still registers.
 */
const BAR_H = 70;          // px of chip bar at the top of the focused viewport
const PAINT_FLOOR = 0.02;  // % of the canvas region; below this nothing was drawn
async function paintedPct(baseFile, file) {
  try {
    const meta = await sharp(path.join(OUT, baseFile)).metadata();
    const region = { left: 0, top: BAR_H, width: meta.width, height: Math.max(1, meta.height - BAR_H) };
    const [a, b] = await Promise.all([
      sharp(path.join(OUT, baseFile)).extract(region).greyscale().raw().toBuffer(),
      sharp(path.join(OUT, file)).extract(region).greyscale().raw().toBuffer(),
    ]);
    if (a.length !== b.length) return null;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) d++;
    return (d / a.length) * 100;
  } catch { return null; }
}

async function allOff(page) {
  for (const l of OVERLAY_LABELS) await setChip(page, l, false);
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2200);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

/**
 * Walk one canvas surface through the overlay state space.
 *
 * Not all 32 combinations: five layers individually plus all-on is what tells you what each one
 * PAINTS and whether they compose, and the remaining 26 combinations are the same information with
 * more files to review. The individually-off baseline is captured first so every later shot has
 * something to be different from.
 */
async function driveSurface(page, surface, url) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2600);

  const offered = await chipState(page);
  const names = Object.keys(offered);
  if (!names.length) {
    findings.push({ surface, what: 'no overlay chips found — the OverlayLayer did not mount on this surface' });
    await shoot(page, surface, 'NO-CHIPS', { chips: 0 });
    return;
  }
  const contents = await canvasContents(page);
  console.log(`\n── ${surface} — chips: ${names.join(', ')} · ${contents.nodes} node(s), ${contents.sourced} with a source`);

  await allOff(page);
  const baseFile = await shoot(page, surface, 'baseline-all-off', { chips: names.length, active: [] });

  for (const label of names) {
    await allOff(page);
    const r = await setChip(page, label, true);
    if (!r.took) {
      findings.push({ surface, what: `chip "${label}" did not take: aria-pressed stayed ${r.is}` });
      continue;
    }
    await page.waitForTimeout(300);
    const f = await shoot(page, surface, `overlay-${label}`, { active: [label] });
    const pct = await paintedPct(baseFile, f);
    if (pct != null) {
      shots[shots.length - 1].paintedPct = Number(pct.toFixed(2));
      // Only a defect when the layer HAD something to draw. `Grid` is the exception: it is page
      // geometry and needs no content at all, so a doc surface that draws none is unwired.
      const prereq = label === 'Atoms' ? contents.nodes > 0
        : label === 'Provenance' ? contents.sourced > 0
          : label === 'Grid' ? true
            : contents.nodes > 0;
      if (pct < PAINT_FLOOR) {
        if (prereq) {
          findings.push({ surface, what: `overlay "${label}" is OFFERED and had content to draw on, but painted nothing — ${pct.toFixed(3)}% of the CANVAS changed` });
        } else {
          shots[shots.length - 1].note = 'nothing to draw (empty canvas / no sourced nodes) — the layer is not at fault';
        }
      }
    }
  }

  // All layers together — the composition is its own question: do the rails, gutters and grid
  // collide, or do they read as one drawing?
  for (const label of names) await setChip(page, label, true);
  await page.waitForTimeout(400);
  await shoot(page, surface, 'overlay-ALL', { active: names });
  await allOff(page);

  // SELECTION — the other half of the interaction layer. Clicking a node should raise the
  // selection toolbar / ActOnSelection verbs; that is a state, not a page.
  const picked = await page.evaluate(() => {
    const el = document.querySelector('[data-node-id]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    (el).click();
    return el.getAttribute('data-node-id');
  });
  if (picked) {
    await page.waitForTimeout(700);
    await shoot(page, surface, 'node-selected', { nodeId: picked });
    // …and with the structure layers on, which is how an author actually inspects a selection.
    await setChip(page, 'Atoms', true);
    await setChip(page, 'Sections', true);
    await page.waitForTimeout(400);
    await shoot(page, surface, 'node-selected-with-structure', { nodeId: picked, active: ['Atoms', 'Sections'] });
    await allOff(page);
  } else {
    findings.push({ surface, what: 'no [data-node-id] element — selection could not be exercised (an empty canvas?)' });
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
const [tenant] = await sql`SELECT slug FROM tenants WHERE slug = 'foundation'`;
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
console.log(`· serving ${BASE} · overlay layers: ${OVERLAY_LABELS.join(' · ')}`);

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await login(ctx, 'kate.ulepic@foundation3dp.com', TENANT_PW);

  // 1 — THE FLUID DOCUMENT: the assembled whole proposal, and the only surface that offers
  // `Sections` and `Groups`. The per-section editor deliberately omits `sections` ("this surface IS
  // one section"), so a walk that saw only the section editor would report 3 of 7 layers and look
  // complete. It is the DEFAULT tab of the proposal workspace.
  const [prop] = await sql`
    SELECT p.id FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE t.slug = 'foundation' AND p.archived_at IS NULL
    ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC LIMIT 1`;
  if (prop) {
    await driveSurface(page, 'fluid-document', `/portal/${tenant.slug}/proposals/${prop.id}`);
  } else {
    findings.push({ surface: 'fluid-document', what: 'no proposal to open' });
  }

  // 2 — the REAL content surface: a proposal section with authored nodes, provenance and history.
  const [sect] = await sql`
    SELECT s.id, p.id AS proposal_id FROM proposal_sections s
    JOIN proposals p ON p.id = s.proposal_id JOIN tenants t ON t.id = p.tenant_id
    WHERE t.slug = 'foundation' AND p.archived_at IS NULL
    ORDER BY s.sort_index NULLS LAST LIMIT 1`;
  if (sect) {
    await driveSurface(page, 'proposal-section', `/portal/${tenant.slug}/proposals/${sect.proposal_id}/sections/${sect.id}`);
  } else {
    findings.push({ surface: 'proposal-section', what: 'no section to open' });
  }

  // 3 — one blank canvas per PRESET, so all three renderer forks are covered. This fixture stores
  // only `letter`, so the deck and the sheet must be authored to exist at all.
  for (const preset of ['letter', 'deck', 'sheet', 'flier']) {
    const res = await ctx.request.post(`${BASE}/api/portal/${tenant.slug}/documents`, {
      data: { preset, title: `ZZ overlay probe — ${preset}` },
    });
    const body = await res.json().catch(() => ({}));
    const id = body?.data?.documentId;
    if (!res.ok() || !id) {
      findings.push({ surface: `blank-${preset}`, what: `could not author (HTTP ${res.status()})` });
      continue;
    }
    created.push(id);
    await driveSurface(page, `blank-${preset}`, `/portal/${tenant.slug}/documents/${id}`);
  }
  await ctx.close();
} finally {
  await browser.close();
  // Take away exactly what this probe built.
  for (const id of created) await sql`DELETE FROM tenant_documents WHERE id = ${id}::uuid`.catch(() => {});
  if (created.length) console.log(`\n  · removed ${created.length} scratch document(s)`);
  await sql.end();
}

const bySurface = {};
for (const s of shots) bySurface[s.surface] = (bySurface[s.surface] ?? 0) + 1;
console.log(`\n${shots.length} canvas state(s) captured`);
for (const [k, v] of Object.entries(bySurface)) console.log(`  ${String(v).padStart(4)}  ${k}`);
if (findings.length) {
  console.log(`\n✗ ${findings.length} finding(s):`);
  for (const f of findings) console.log(`  · [${f.surface}] ${f.what}`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ shots, findings }, null, 1));
console.log(`\nwrote ${shots.length} screenshot(s) + index.json to docs/ui-canvas/`);
process.exit(findings.length ? 1 : 0);
