/**
 * Build the illustrated "Creating documents" guide: resize the session screenshots into the
 * repo's docs/user-guides/img/ (committed) AND embed them as data URIs in a self-contained
 * HTML page (for publishing as an artifact). Run: node scripts/build-doc-guide.mjs
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const SRC = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const IMGDIR = '/home/user/govwin/docs/user-guides/img';
const PUBDIR = '/home/user/govwin/frontend/public/guides';
const OUT = `${SRC}/creating-documents-guide.html`;          // artifact body (no doc wrapper)
const PUBOUT = `${PUBDIR}/creating-documents.html`;          // in-app help (full standalone doc)
mkdirSync(IMGDIR, { recursive: true });
mkdirSync(PUBDIR, { recursive: true });

const IMAGES = {
  fluid:      { src: `${SRC}/f1-shots/f1-02-document-fluid.png`,    repo: 'doc-view-fluid' },
  atomize:    { src: `${SRC}/f1-shots/f1-04-selection-toolbar.png`, repo: 'doc-view-atomize' },
  annotate:   { src: `${SRC}/f2-shots/f2-02-annotated.png`,          repo: 'doc-view-annotate' },
  slidesframe:{ src: `${SRC}/slides-shots/slides-02-4x3.png`,        repo: 'slides-frame' },
  slidesbg:   { src: `${SRC}/slides-shots/slides-03-background.png`, repo: 'slides-background' },
  sheetnum:   { src: `${SRC}/sheet-shots/sheet-02-formatted.png`,    repo: 'sheet-numbers' },
  sheetstyle: { src: `${SRC}/sheet-shots/sheet-03-style-media.png`,  repo: 'sheet-style-media' },
};

const uri = {};
for (const [k, { src, repo }] of Object.entries(IMAGES)) {
  const buf = readFileSync(src);
  await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(`${IMGDIR}/${repo}.png`);
  const jpg = await sharp(buf).resize({ width: 1180, withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer();
  uri[k] = `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

const fig = (key, cap) => `<figure><img loading="lazy" alt="${cap.replace(/"/g, '&quot;')}" src="${uri[key]}"><figcaption>${cap}</figcaption></figure>`;

const html = `<title>Creating documents in RFP Pipeline</title>
<style>
:root{
  --ground:#F3F5F8; --surface:#FFFFFF; --surface-2:#EAEFF4; --ink:#1B2530; --muted:#586573;
  --faint:#8593A2; --line:#DCE3EA; --navy:#1F4E79; --navy-2:#2E6BA6; --link:#1D4ED8;
  --gold:#8F6410; --gold-bg:#FAF2E0; --gold-line:#E6CE99; --code-bg:#EDF1F6; --shadow:rgba(27,37,48,.10);
}
:root:not([data-theme="light"]) { color-scheme: light dark; }
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --ground:#0E141B; --surface:#151D26; --surface-2:#1C2732; --ink:#E7EDF4; --muted:#9EACBB;
  --faint:#69788A; --line:#25313D; --navy:#79ADDD; --navy-2:#96C1EC; --link:#7CA8F7;
  --gold:#E2A94E; --gold-bg:#221B0F; --gold-line:#463920; --code-bg:#1B2530; --shadow:rgba(0,0,0,.4);
}}
:root[data-theme="dark"]{
  --ground:#0E141B; --surface:#151D26; --surface-2:#1C2732; --ink:#E7EDF4; --muted:#9EACBB;
  --faint:#69788A; --line:#25313D; --navy:#79ADDD; --navy-2:#96C1EC; --link:#7CA8F7;
  --gold:#E2A94E; --gold-bg:#221B0F; --gold-line:#463920; --code-bg:#1B2530; --shadow:rgba(0,0,0,.4);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; font-size:16.5px; line-height:1.62;
  -webkit-font-smoothing:antialiased;
}
.serif{font-family:Palatino,"Palatino Linotype","Iowan Old Style","Book Antiqua",Georgia,serif}
.mono{font-family:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace}

.shell{max-width:1180px;margin:0 auto;padding:0 24px}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:52px;align-items:start}
@media (max-width:900px){.layout{grid-template-columns:1fr;gap:0}}

/* ── Hero ── */
header.hero{border-bottom:1px solid var(--line);background:
  radial-gradient(120% 130% at 88% -10%, color-mix(in srgb, var(--navy) 12%, transparent), transparent 60%);}
.hero .shell{padding-top:56px;padding-bottom:40px}
.eyebrow{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--navy);font-weight:650}
.hero h1{font-size:clamp(30px,4.4vw,46px);line-height:1.08;margin:.34em 0 .28em;text-wrap:balance;font-weight:650;letter-spacing:-.01em}
.hero p.lede{font-size:19px;color:var(--muted);max-width:64ch;margin:.2em 0 1.4em}
.chairs{display:flex;gap:10px;flex-wrap:wrap}
.chair{display:inline-flex;align-items:center;gap:9px;padding:8px 13px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:14px}
.chair b{font-weight:640}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.dot.navy{background:var(--navy)} .dot.gold{background:var(--gold)}

/* ── TOC ── */
nav.toc{position:sticky;top:22px;font-size:14px;padding-top:8px}
@media (max-width:900px){nav.toc{position:static;border-bottom:1px solid var(--line);padding:14px 0 6px;margin-bottom:8px}}
nav.toc .lbl{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:0 0 10px;font-weight:650}
nav.toc ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
@media (max-width:900px){nav.toc ol{flex-flow:row wrap;gap:6px 14px}}
nav.toc a{display:block;color:var(--muted);text-decoration:none;padding:4px 0;border-left:2px solid transparent;padding-left:12px;margin-left:-14px}
nav.toc a:hover{color:var(--ink)}
nav.toc a.on{color:var(--navy);border-color:var(--navy);font-weight:600}
@media (max-width:900px){nav.toc a{border-left:0;padding-left:0;margin-left:0}}

main{padding:44px 0 90px;max-width:none}
section{scroll-margin-top:20px}
section+section{margin-top:46px}
h2{font-size:26px;line-height:1.16;margin:0 0 .5em;font-weight:640;letter-spacing:-.01em;text-wrap:balance}
h2 .num{color:var(--navy);font-variant-numeric:tabular-nums;margin-right:.5em;font-weight:640}
h3{font-size:18px;margin:1.7em 0 .5em;font-weight:640}
p{margin:.7em 0;max-width:68ch}
main a{color:var(--link);text-decoration-thickness:1px;text-underline-offset:2px}
strong{font-weight:640}
code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.86em;background:var(--code-bg);padding:.12em .42em;border-radius:5px}
ul,ol{padding-left:1.25em;max-width:68ch}
li{margin:.34em 0}
li::marker{color:var(--navy)}
hr{border:0;border-top:1px solid var(--line);margin:2.4em 0}

/* figures */
figure{margin:1.6em 0;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px var(--shadow)}
figure img{display:block;width:100%;height:auto}
figcaption{font-size:13.5px;color:var(--muted);padding:11px 15px;border-top:1px solid var(--line);background:var(--surface-2)}

/* agent callout */
.agent{border:1px solid var(--gold-line);background:var(--gold-bg);border-radius:12px;padding:15px 18px 15px 17px;margin:1.5em 0;position:relative}
.agent .tag{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);font-weight:700;margin-bottom:5px}
.agent p{margin:.25em 0;max-width:64ch}
.agent .tag svg{width:14px;height:14px}

/* tables */
.tw{overflow-x:auto;margin:1.5em 0;border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:14.5px;min-width:520px}
th,td{text-align:left;padding:11px 15px;border-bottom:1px solid var(--line);vertical-align:top}
thead th{background:var(--surface-2);font-weight:640;color:var(--ink);border-bottom:1px solid var(--line)}
tbody tr:last-child td{border-bottom:0}
td .mono,th .mono{font-size:.88em}

/* chips */
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:1em 0}
.chip{font-size:13px;padding:5px 11px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted)}
.chip b{color:var(--ink);font-weight:620}

/* persona rule row */
.rule{font-size:14px;color:var(--muted);border-top:1px solid var(--line);padding-top:20px;margin-top:44px}
.foot a{color:var(--link);text-decoration:none}
.foot a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--navy);outline-offset:2px;border-radius:4px}
</style>

<header class="hero"><div class="shell">
  <div class="eyebrow">RFP Pipeline · Working guide</div>
  <h1 class="serif">Creating documents,<br>agents at your elbow</h1>
  <p class="lede">One canvas, four surfaces — a narrative document, a slide deck, a cost workbook — seen from two chairs: the RFP&nbsp;Pipeline admin who authors the master side, and the tenant admin who builds the proposal with the agent workforce drafting alongside.</p>
  <div class="chairs">
    <span class="chair"><span class="dot navy"></span><b>RFP&nbsp;Pipeline admin</b> — master &amp; compliance</span>
    <span class="chair"><span class="dot gold"></span><b>Tenant admin</b> — proposals, with agents</span>
  </div>
</div></header>

<div class="shell"><div class="layout">
<nav class="toc" aria-label="Contents">
  <p class="lbl">On this page</p>
  <ol>
    <li><a href="#chairs">The two chairs</a></li>
    <li><a href="#surfaces">1 · The four surfaces</a></li>
    <li><a href="#build">2 · Build a proposal</a></li>
    <li><a href="#slides">3 · Slide decks</a></li>
    <li><a href="#sheets">4 · Cost workbooks</a></li>
    <li><a href="#admin">5 · The admin side</a></li>
    <li><a href="#agents">6 · Agents &amp; safety</a></li>
    <li><a href="#export">7 · Export</a></li>
  </ol>
</nav>

<main>

<section id="chairs">
  <h2 class="serif">The two chairs</h2>
  <p>The canvas is one object seen from two vantage points. This guide follows the tenant admin — the busier chair — and calls out where the RFP admin's flow differs.</p>
  <div class="tw"><table>
    <thead><tr><th></th><th>RFP&nbsp;Pipeline admin</th><th>Tenant admin (+ agents)</th></tr></thead>
    <tbody>
      <tr><td><b>You author</b></td><td>the master solicitation, compliance matrix, section molds, templates</td><td>proposal volumes for your opportunity, and standalone documents</td></tr>
      <tr><td><b>You start from</b></td><td><span class="mono">/admin</span> → curation workspace</td><td>your portal → an opportunity card, or <b>Documents → + New</b></td></tr>
      <tr><td><b>Agents help</b></td><td>ingest assessment, molds, compliance shells</td><td>full-draft (Studio), per-section drafting, review, atomize-to-library</td></tr>
      <tr><td><b>You hand off</b></td><td>a released, unlocked build with matrix + molds</td><td>a locked, submission-ready package</td></tr>
    </tbody>
  </table></div>
  <div class="agent">
    <span class="tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v3M6.4 6.4l2.1 2.1M3 12h3M18 12h3M12 18v3M7 21h10M9 12a3 3 0 0 1 6 0v3a3 3 0 0 1-6 0Z"/></svg>The one rule that makes it trustworthy</span>
    <p><b>What you see is what exports.</b> Every background, shape, image, number format, and border you set in the editor is carried into the <code>.docx</code> / <code>.pdf</code> / <code>.pptx</code> / <code>.xlsx</code>. And every agent is <b>advisory</b> — it drafts into a review lane you accept or discard; it never silently overwrites your work.</p>
  </div>
</section>

<section id="surfaces">
  <h2 class="serif"><span class="num">1</span>The canvas, and its four surfaces</h2>
  <p>Every document — a proposal section, a flier, a deck, a budget — is a <b>canvas</b>: a typed tree of blocks (headings, text, lists, tables, images, shapes, charts, callouts) on a page frame with margins, a header/footer, and a size budget. One model, four modalities:</p>
  <div class="tw"><table>
    <thead><tr><th>Surface</th><th>Format</th><th>Editor</th><th>Exports to</th></tr></thead>
    <tbody>
      <tr><td><b>Narrative document</b></td><td>letter / custom</td><td>flowing page + the fluid Document view</td><td class="mono">.docx · .pdf</td></tr>
      <tr><td><b>Slide deck</b></td><td>16:9 / 4:3</td><td>slide editor (thumbnails + one slide)</td><td class="mono">.pptx</td></tr>
      <tr><td><b>Cost workbook</b></td><td>spreadsheet</td><td>sheet editor (grid + tabs)</td><td class="mono">.xlsx</td></tr>
    </tbody>
  </table></div>
  <p>You pick the surface when you create the document (<b>Documents → + New</b>: One-page flier, Blank document, Slide deck, Workbook), or it's set for you when a proposal volume is provisioned from the master solicitation.</p>
</section>

<section id="build">
  <h2 class="serif"><span class="num">2</span>Build a proposal, agents at your elbow</h2>
  <h3>Let the Studio draft the whole thing</h3>
  <p>The <b>Proposal Studio</b> runs the agent workforce over your build in three gated loops — <b>Draft → Refine → Compliance</b> — each landing in a review you steer:</p>
  <ol>
    <li><b>Start — Draft loop.</b> The workforce plans and drafts every section from your <b>library atoms</b>. It lands as a draft on the page.</li>
    <li><b>Review the gate.</b> Read it, then either <b>comment + regenerate</b> (your comments thread in as guidance for the next pass) or <b>approve → next</b>.</li>
    <li><b>Refine</b>, then <b>Compliance</b> repeat the pattern — restyle to one house voice + the cost volume, then requirement coverage + continuity + a redaction scan.</li>
  </ol>
  <p>Prefer hands-off? <b>Run all 3 automatically</b> chains the loops end to end and still lands everything in review. Nothing locks or submits on its own.</p>

  <h3>Read the whole proposal as one document</h3>
  <p>Section cards are good for <em>assigning</em> work; they're poor for <em>reading</em>. Open the <b>Document</b> tab to see the whole proposal as one continuous, fluid document — every section inline, in the real page frame, with a left <b>outline rail</b> that tracks where you are as you scroll.</p>
  ${fig('fluid', 'The Document tab: the whole proposal as one continuous document, with the section outline rail on the left.')}

  <h3>Highlight a span → act on it</h3>
  <p>In the Document view — and in any section editor — <b>selection is the verb.</b> Highlight any run of text (even across sections) and a floating toolbar offers:</p>
  <div class="chips">
    <span class="chip"><b>⬡ Atomize</b> — save it to your library, with lineage</span>
    <span class="chip"><b>✎ Annotate</b> — note it on the owning section</span>
    <span class="chip"><b>↻ Regenerate</b> — AI re-draft, land as a reviewable revision</span>
  </div>
  ${fig('atomize', 'Highlighting a paragraph pops the selection toolbar — Atomize saves the span to your library as a reusable atom.')}
  ${fig('annotate', 'Annotate attaches a note to the owning section (here, the Abstract), quoting the highlighted span for your teammates.')}
</section>

<section id="slides">
  <h2 class="serif"><span class="num">3</span>Slide decks <span style="color:var(--faint);font-weight:400">(PowerPoint)</span></h2>
  <p>A deck isn't a scroll — it's discrete slides. The slide editor gives you thumbnails on the left, one slide in the center, and a <b>Slide frame</b> bar for the things a deck actually needs: <b>size · ratio · count · background.</b></p>
  <ul>
    <li><b>Aspect ratio</b> — switch <b>16:9 ↔ 4:3</b>; the surface and thumbnails reflow instantly.</li>
    <li><b>Slides</b> — the count (and your limit, if the RFP sets one) with <b>+ Slide</b>.</li>
    <li><b>Background</b> — one click sets the deck background; it renders on every slide <b>and exports to the .pptx</b>.</li>
  </ul>
  ${fig('slidesframe', 'The Slide frame bar — 16:9 / 4:3, slide count, and a background swatch — with the element palette above.')}
  <p>Everything else is styling and primitives, from the toolbar above the slide:</p>
  <ul>
    <li><b>Shapes</b> — rectangle, ellipse, arrow, line, star… each with fill, border, opacity, rotation, shadow, and free placement (drag, or set X/Y/W/H in Arrange).</li>
    <li><b>Images</b> — upload a logo or figure; position, border, and rotate it. It exports placed exactly as shown — not force-centered.</li>
    <li><b>Text, tables, charts, callouts</b> — the same block palette as documents, sized for slides.</li>
  </ul>
  ${fig('slidesbg', 'A deck background set to dark navy — the editor and the exported .pptx match.')}
</section>

<section id="sheets">
  <h2 class="serif"><span class="num">4</span>Cost workbooks <span style="color:var(--faint);font-weight:400">(Excel)</span></h2>
  <p>A workbook is a <b>fancy table.</b> The sheet editor is a real grid — cell references, a formula bar (<code>fx</code>), multiple sheet tabs, add/delete rows and columns — plus the styling a cost volume needs.</p>
  <h3>Cells and numbers</h3>
  <ul>
    <li><b>Formulas</b> — type <code>=D2+D3+D4</code>; it stays a live formula and exports as one Excel computes on open.</li>
    <li><b>Number format</b> — per cell: Currency / Percent / Thousands. <code>59200</code> shows as <b>$59,200</b>, <code>0.32</code> as <b>32%</b> — while the formula bar still shows the raw value you edit. The same format code drives the <code>.xlsx</code>, so display and export never disagree.</li>
  </ul>
  ${fig('sheetnum', 'Per-cell number formats — Direct Cost as currency, Fringe as percent — with the =D2+D3+D4 formula row intact.')}
  <h3>Simple styling &amp; media</h3>
  <p>From the format bar: <b>bold</b>, <b>alignment</b>, <b>fill</b> (cell background), <b>text color</b>, and a per-cell <b>border</b> (none / thin / thick — e.g. a bordered total row). Every one is honored in the exported <code>.xlsx</code>. Need a logo or figure? The <b>Media</b> strip above the grid adds an <b>image</b> (uploaded) or a <b>shape</b>, previewed in place and exported as a floating picture in the workbook.</p>
  ${fig('sheetstyle', 'Cell text color (red), a thick-bordered total row, and the Media strip with an added shape and the Image / Shape buttons.')}
</section>

<section id="admin">
  <h2 class="serif"><span class="num">5</span>The admin side — authoring the master</h2>
  <p>The RFP Pipeline admin uses the same canvas, aimed upstream:</p>
  <ol>
    <li><b>Curate the solicitation.</b> In <span class="mono">/admin</span>, work the ingested opportunity. <b>Assess ingest readiness</b> has the <span class="mono">rfp_ingest_manager</span> agent read the ingest state and recommend which specialists to run next — advisory, never descending into a tenant.</li>
    <li><b>Author the compliance shell + molds.</b> Define the volumes, required items, and page budgets. Each becomes a <b>mold</b> the tenant's build is provisioned from.</li>
    <li><b>Templates.</b> Author reusable document templates; publish a Studio-built document to the shared library so tenants can start from it.</li>
    <li><b>Release.</b> Approving fans the opportunity onto every tenant's board and, on purchase, provisions the tenant's build unlocked with the matrix + molds in place.</li>
  </ol>
  <div class="agent">
    <span class="tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8h12M6 12h12M6 16h8"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>The doorbell</span>
    <p>The admin can ring the <b>Proposal Auto-Drive doorbell</b> from <span class="mono">/admin/agents</span> to run a tenant's full draft from up top — the same advisory, land-in-review flow, just triggered by the platform rather than the customer.</p>
  </div>
</section>

<section id="agents">
  <h2 class="serif"><span class="num">6</span>Agents, and the safety contract</h2>
  <p>The workforce (36 archetypes) shows up as helpers, never as a hand on your keyboard:</p>
  <div class="chips">
    <span class="chip"><b>Section drafter</b> — a section from your atoms</span>
    <span class="chip"><b>Proposal Studio</b> — plan · draft · refine · compliance</span>
    <span class="chip"><b>Compliance / color-team reviewers</b> — critique, never advance</span>
    <span class="chip"><b>Librarian</b> — accepted spans → library atoms</span>
  </div>
  <p>Three invariants hold for every one of them:</p>
  <ul>
    <li><b>Advisory → review → land.</b> Output arrives in a review lane. <em>You</em> accept it onto the page.</li>
    <li><b>Tenant-bound.</b> A tenant's agents act only inside that tenant; they never see another's.</li>
    <li><b>Fenced &amp; bounded.</b> Your content is quoted safely to the model, and runs are capped so nothing runs away or dead-ends a workflow.</li>
  </ul>
</section>

<section id="export">
  <h2 class="serif"><span class="num">7</span>Export, and the compliance floor</h2>
  <p>Lock or complete a section, then download the document or the whole proposal package:</p>
  <div class="tw"><table>
    <thead><tr><th>Surface</th><th>Formats</th></tr></thead>
    <tbody>
      <tr><td>Narrative document / proposal</td><td class="mono">.docx · .pdf · .json · .zip</td></tr>
      <tr><td>Slide deck</td><td class="mono">.pptx</td></tr>
      <tr><td>Cost workbook</td><td class="mono">.xlsx</td></tr>
    </tbody>
  </table></div>
  <p>The <b>compliance floor</b> checks the size ruler as you work and again at export — font, page/slide counts, per-section page budgets, images, header/footer — against what the RFP requires. The gauge in the editor and the export gate share one engine, so they can't disagree; over-budget reads red before you ever hit download. And because the editor and the exporters share one model, the file you download carries every background, shape, image, number format, and border you set — exactly as you saw it.</p>
  <p class="rule foot">Related: <a href="#build">Build a proposal</a> · the in-product guides cover <b>Documents</b>, <b>Proposal build</b>, <b>Library atoms</b>, and <b>Getting started</b>.</p>
</section>

</main>
</div></div>

<script>
(function(){
  var links=[].slice.call(document.querySelectorAll('nav.toc a'));
  var map={}; links.forEach(function(a){var id=a.getAttribute('href').slice(1);var s=document.getElementById(id);if(s)map[id]=a;});
  var obs=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ links.forEach(function(a){a.classList.remove('on')}); var a=map[e.target.id]; if(a)a.classList.add('on'); } });
  },{rootMargin:'-15% 0px -75% 0px'});
  Object.keys(map).forEach(function(id){var s=document.getElementById(id);if(s)obs.observe(s);});
})();
</script>`;

writeFileSync(OUT, html);

// In-app help: wrap the same title+style+body in a full standalone HTML document, served
// from public/ at /guides/creating-documents.html (CSP allows inline style/script + data: img).
const splitAt = html.indexOf('<header class="hero">');
const headPart = html.slice(0, splitAt);   // <title> + <style>
const bodyPart = html.slice(splitAt);      // <header>…<script>
const standalone = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${headPart}</head><body>${bodyPart}</body></html>`;
writeFileSync(PUBOUT, standalone);

console.log(`wrote ${OUT} — ${(html.length/1024).toFixed(0)} KB`);
console.log(`wrote ${PUBOUT} — ${(standalone.length/1024).toFixed(0)} KB (in-app help)`);
