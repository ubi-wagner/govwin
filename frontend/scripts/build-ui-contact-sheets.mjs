#!/usr/bin/env node
/**
 * build-ui-contact-sheets.mjs — turn 150 screenshots into something a person can actually LOOK at.
 *
 * WHY. `capture-ui-atlas.mjs` proves each page answered, rendered, and carried no error surface.
 * None of that is *looking*. A page can pass every one of those checks and still be visibly wrong:
 * unstyled because a stylesheet 404'd, empty because a query returned nothing, showing the wrong
 * tenant's name, or laid out on top of itself. Those defects have exactly one instrument — a human
 * (or a model) with eyes — and 150 separate images is a review nobody finishes.
 *
 * So: contact sheets. Each lane becomes a labelled grid of thumbnails, one image per sheet, at a
 * size where "this one is blank" and "this one is unstyled" are obvious at a glance. Anything that
 * looks wrong gets opened at full resolution from `docs/ui-atlas/`.
 *
 * The label under each thumbnail carries the facts you cannot see in a picture — the route, the
 * rendered text length, and the live button/link/input counts — so the sheet is a reviewable
 * document rather than a mood board. A page that LOOKS full but reports 0 buttons is the
 * interesting case, and the caption is what surfaces it.
 *
 * Built as HTML and photographed with Chromium, rather than composited with an image library,
 * because the labels are the point and text rendering is what browsers are for.
 *
 *   cd frontend && node scripts/build-ui-contact-sheets.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/home/user/govwin';
const OUT = path.join(REPO, 'docs/ui-atlas');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const COLS = 4;
const PER_SHEET = 16;

/**
 * Two sources, one sheet format.
 *
 *   docs/ui-atlas/index.json    one shot per ROUTE, grouped by actor lane
 *   docs/ui-states/index.json   one shot per STATE, grouped by KIND — every "validation" together,
 *                               every "confirm" together — because that is how they are reviewed.
 *                               Scanning 20 validation messages side by side is what makes the
 *                               inconsistent one obvious; scattering them by route hides it.
 *
 *   node scripts/build-ui-contact-sheets.mjs           # routes
 *   node scripts/build-ui-contact-sheets.mjs --states  # modal / form / toast / confirm states
 */
const STATES = process.argv.includes('--states');
const SRC = STATES ? path.join(REPO, 'docs/ui-states') : OUT;
const index = JSON.parse(fs.readFileSync(path.join(SRC, 'index.json'), 'utf8'));
const byLane = {};
for (const s of index.shots) (byLane[STATES ? (s.kind || 'other') : s.lane] ??= []).push(s);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sheetHtml(lane, shots, part, parts) {
  const cards = shots.map((s) => {
    const img = path.join(SRC, s.file);
    const b64 = fs.existsSync(img) ? fs.readFileSync(img).toString('base64') : '';
    const r = s.rendered ?? {};
    // A thumbnail is cropped to the top of a full-page shot: below-the-fold content is in the
    // file, not on the sheet. The caption's char count is what says how much more there is.
    return `<figure>
      <div class="shot">${b64 ? `<img src="data:image/png;base64,${b64}">` : '<div class="missing">no image</div>'}</div>
      <figcaption>
        <b>${esc(s.route)}</b>
        ${STATES
          ? `<span class="redir">${esc(s.lane)} · ${esc(s.kind || '')}</span>
             <span class="meta">${esc(s.trigger ? '“' + s.trigger + '”' : '')}${s.fields ? ` · ${s.fields} field(s) filled` : ''}</span>
             ${s.message ? `<span class="h1">${esc(String(s.message).slice(0, 90))}</span>` : ''}`
          : `${s.redirected ? `<span class="redir">→ ${esc(s.finalUrl)}</span>` : ''}
             <span class="meta">${s.status} · ${r.text ?? 0}ch · b${r.buttons ?? 0} l${r.links ?? 0} i${r.inputs ?? 0} f${r.forms ?? 0}</span>
             ${r.h1 ? `<span class="h1">“${esc(r.h1)}”</span>` : '<span class="h1 none">no heading</span>'}`}
      </figcaption>
    </figure>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0f172a;color:#e2e8f0;font:13px/1.4 ui-sans-serif,system-ui,sans-serif}
    h1{margin:16px 20px 4px;font-size:19px;color:#f1f5f9}
    .sub{margin:0 20px 14px;color:#94a3b8;font-size:12px}
    .grid{display:grid;grid-template-columns:repeat(${COLS},1fr);gap:14px;padding:0 20px 24px}
    figure{margin:0;background:#1e293b;border:1px solid #334155;border-radius:8px;overflow:hidden}
    .shot{height:300px;overflow:hidden;background:#fff;border-bottom:1px solid #334155}
    .shot img{width:100%;display:block}
    .missing{height:100%;display:flex;align-items:center;justify-content:center;color:#ef4444;background:#1e293b}
    figcaption{padding:8px 10px;display:flex;flex-direction:column;gap:2px}
    figcaption b{color:#f8fafc;font-weight:600;word-break:break-all;font-size:12px}
    .redir{color:#fbbf24;font-size:11px}
    .meta{color:#7dd3fc;font-size:11px;font-variant-numeric:tabular-nums}
    .h1{color:#94a3b8;font-size:11px;font-style:italic}
    .h1.none{color:#f87171}
  </style>
  <h1>UI ${STATES ? 'states' : 'atlas'} · ${esc(lane)} · sheet ${part} of ${parts}</h1>
  <div class="sub">${shots.length} ${STATES ? 'state(s). Caption: route · lane · kind · the trigger that produced it.' : 'route(s). Caption: HTTP · rendered text length · b=buttons l=links i=inputs f=forms, counted in the LIVE dom. Amber = redirected. Red heading = no h1/h2 found.'}</div>
  <div class="grid">${cards}</div>`;
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
const sheets = [];
for (const [lane, shots] of Object.entries(byLane)) {
  shots.sort((a, b) => a.route.localeCompare(b.route));
  const parts = Math.ceil(shots.length / PER_SHEET);
  for (let i = 0; i < parts; i++) {
    const slice = shots.slice(i * PER_SHEET, (i + 1) * PER_SHEET);
    const file = `${STATES ? 'states' : 'sheet'}-${lane}-${i + 1}.png`;
    await page.setContent(sheetHtml(lane, slice, i + 1, parts), { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SRC, file), fullPage: true });
    sheets.push({ lane, part: i + 1, parts, file, routes: slice.map((s) => s.route) });
    console.log(`  ✓ ${file} — ${slice.length} route(s)`);
  }
}
await browser.close();
fs.writeFileSync(path.join(SRC, 'sheets.json'), JSON.stringify(sheets, null, 1));
console.log(`\n${sheets.length} contact sheet(s) in ${path.relative(REPO, SRC)}/`);
