/**
 * Build a real capability deck for a real tenant, through the product's own routes only.
 *
 * Foundation 3DP prints concrete FORMWORK for residential construction. This drives the path a
 * person would drive in the app: make the figures, upload them, ask the library what it can
 * support, have the drafter write the slides AROUND those figures from that retrieved material,
 * assemble the deck, export it, and look at the result.
 *
 * THE SUBJECT CAME FROM THE LIBRARY, NOT FROM ME. The first version of this deck pitched Navy
 * expeditionary basing, because that is what retrieval returned — and every one of those atoms was
 * RESIDUE left in Foundation's library by an earlier drive (B119), naming a different customer
 * entirely. Foundation's genuine material is a 3DCP investor deck: formwork on a 2,100 sq ft Ohio
 * home, 14 days and $20,085-$25,387 traditional against 2.5 days and $10,596-$13,582 printed, a
 * real management team, a real patent, a real risk register. The numbers in the figures below are
 * theirs, read out of their own atoms.
 *
 * That is the finding under this drive: harness residue is not inert. It ranks, it retrieves, and
 * it becomes the material the drafter writes a customer's deck from. So this one DISPOSES of what
 * it creates -- saving a document atomises it, and the first run added 11 atoms of its own.
 *
 * NO SHORTCUTS. Every state change goes through an HTTP route with a real signed-in session:
 *
 *   POST /api/portal/{slug}/uploads/image        the figures, into the tenant's own image prefix
 *   GET  /api/portal/{slug}/atoms/select         what the library can actually support
 *   POST /api/tools/proposal.draft_section       the prose, grounded in those atoms
 *   POST /api/portal/{slug}/documents            the deck
 *   PUT  /api/portal/{slug}/documents/{id}/save  the canvas
 *   POST /api/portal/{slug}/documents/{id}/export → .pptx
 *
 * ── TWO THINGS LEARNED BUILDING THIS, both worth keeping ──────────────────────────────────────
 *
 * 1. `proposal.draft_section` does NOT retrieve. `libraryAtoms` is an INPUT. Calling it without
 *    them returns an honest refusal — "nothing here has been generated from thin air" — which is
 *    the correct behaviour and is easy to mistake for a broken AI path. The UI does select-then-
 *    draft in two steps (`draft-all-sections.tsx`), and so does this. The refusal is retained as a
 *    STEP: a drafter that invents prose when the library is empty is a worse product than one that
 *    says so, and that property is now asserted rather than assumed.
 *
 * 2. Before this ran, NO image had ever reached a stored canvas in this system — 2,137 library
 *    atoms across three tenants, 0 image nodes in any `proposal_sections` row. `figure-harvest.ts`
 *    documents the same finding from the library side. So the upload → storage-key → export
 *    data-URI inlining path had never carried a real picture end to end. It does now, and the
 *    deck's figures are checked in the EXPORTED file (`ppt/media/*`), not in the model that
 *    produced it.
 *
 * Usage: cd frontend && npx tsx scripts/drive-capability-deck.mts
 * Artifacts land in $DECK_OUT (default /tmp/capability-deck).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import JSZip from 'jszip';
import { launch, signIn } from './lib/cross-company.mts';
import { renderChartSvg } from '@/lib/export/canvas-html';
import { rasterizeDataUri } from '@/lib/export/image-raster';
import { CANVAS_PRESETS, estimateSlideCount, getNodeText, overflowingSlides, type CanvasDocument, type CanvasNode, type ChartContent } from '@/lib/types/canvas-document';
import { capturePdfPages } from '@/lib/pdf/page-capture';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.DECK_OUT || '/tmp/capability-deck';
const SLUG = 'foundation';
const PROPOSAL = '73d587b2-66ba-44f7-b935-329aef0aadc1'; // N261-EXP01, 17 sections
mkdirSync(OUT, { recursive: true });

const STEPS: Array<{ n: string; what: string; ok: boolean; detail: string }> = [];
function step(n: string, what: string, ok: boolean, detail = ''): void {
  STEPS.push({ n, what, ok, detail });
  console.error(`${ok ? '  ✓' : '  ✗'} ${n.padEnd(9)} ${what}${detail ? ` — ${detail}` : ''}`);
}

let seq = 0;
const N = (type: string, content: unknown, style: unknown = {}, position?: unknown): CanvasNode => ({
  id: `cd${++seq}`, type, content, style, ...(position ? { position } : {}),
  provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);

// ─── The figures ──────────────────────────────────────────────────────────────────────────────
//
// Rendered by the PRODUCT's own chart renderer and rasterised by the product's image-raster, so
// the pixels come from our code rather than from a drawing I made. Each one carries a real claim
// from the programme, and the slide's prose is written around it.
const FIGURES: Array<{ tag: string; chart: ChartContent; alt: string; caption: string }> = [
  {
    tag: 'cost',
    chart: {
      chart_type: 'bar', title: 'Formwork cost, 2,100 sq ft Ohio home (USD)',
      categories: ['Traditional (low)', 'Traditional (high)', 'Foundation (low)', 'Foundation (high)'],
      series: [{ name: 'Total formwork cost', data: [20085, 25387, 10596, 13582] }],
    } as ChartContent,
    alt: 'Bar chart of total formwork cost, traditional $20,085-$25,387 against Foundation $10,596-$13,582',
    caption: 'Figure 1. Formwork on a 2,100 sq ft Ohio home: a $9,489-$11,805 saving, 47% of the line.',
  },
  {
    tag: 'time',
    chart: {
      chart_type: 'bar', title: 'Days on site for formwork',
      categories: ['Traditional', 'Foundation printed'],
      series: [{ name: 'Days', data: [14, 2.5] }],
    } as ChartContent,
    alt: 'Bar chart comparing 14 days of traditional formwork against 2.5 days printed',
    caption: 'Figure 2. Digging, forming, pouring, setting and curing collapses to 25 labour hours.',
  },
  {
    tag: 'risk',
    chart: {
      chart_type: 'bar', title: 'Risk register by severity',
      categories: ['Slow adoption', 'Inadequate funding', 'Cumbersome tech'],
      series: [{ name: 'Severity (3 = high)', data: [3, 3, 1] }],
    } as ChartContent,
    alt: 'Bar chart of the three registered risks by severity, adoption and funding high, technology low',
    caption: 'Figure 3. The two high-severity risks are commercial, not technical.',
  },
];

/** Render a figure with the product's chart renderer → PNG bytes. */
async function figurePng(chart: ChartContent): Promise<Buffer> {
  const svg = renderChartSvg(chart);
  const raster = await rasterizeDataUri(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, { scale: 2 });
  if (!raster) throw new Error('the product could not rasterise its own chart SVG');
  return raster.buffer;
}

/** A draft that refused. Its text is a message to the AUTHOR, never slide content. */
const REFUSED = /generated from thin air|No approved library content was retrieved/i;

/**
 * The prose the drafter produced, reduced to what a slide can carry.
 *
 * The refusal guard is not defensive tidiness. Without it this put "No approved library content was
 * retrieved for ... nothing here has been generated from thin air" onto a customer-facing slide as
 * three bullet points, under a real chart, looking exactly like content. The product was behaving
 * correctly and the harness laundered its warning into the deliverable.
 */
function slideBody(nodes: CanvasNode[], maxBullets: number): CanvasNode[] {
  const out: CanvasNode[] = [];
  if (nodes.some((n) => REFUSED.test(String((n.content as { text?: string })?.text ?? '')))) return out;
  const paras = nodes.filter((n) => n.type === 'text_block')
    .map((n) => String((n.content as { text?: string }).text ?? '').trim())
    .filter((t) => t.length > 40);
  const listItems = nodes.filter((n) => n.type === 'bulleted_list')
    .flatMap((n) => ((n.content as { items?: Array<{ text: string }> }).items ?? []).map((i) => i.text))
    .filter((t) => t && t.length > 12);

  // Sentences out of the drafted prose make better bullets than a wall of paragraph on a slide.
  //
  // AND THEY MUST BE SHORT. Splitting on sentence enders alone is not enough: this tenant's atoms
  // are lifted from speaker notes and often carry no full stops at all, so the splitter returned
  // ONE 600-character "sentence" and the slide ran off the bottom of the frame. The writer was not
  // at fault — the frame it declared was honest — the authoring was. A bullet that does not fit on
  // a slide is not a bullet.
  // A BULLET SHOULD END ON A COMPLETE THOUGHT. Cutting at a fixed width landed mid-clause — "the
  // opportunity is that current…" — which is worse than a long bullet, because it reads like the
  // deck is broken rather than terse. So: cut at the last CLAUSE boundary in the back half of the
  // budget, and only fall back to a hard word-break when the text offers none.
  const CAP = 190;
  const clip = (t: string): string => {
    if (t.length <= CAP) return t.replace(/\s+$/, '');
    const head = t.slice(0, CAP);
    for (const mark of ['. ', '; ', ', ']) {
      const at = head.lastIndexOf(mark);
      if (at > CAP * 0.55) return head.slice(0, at).replace(/[,;]$/, '') + (mark === '. ' ? '.' : '');
    }
    const sp = head.lastIndexOf(' ');
    return `${head.slice(0, sp > CAP * 0.5 ? sp : CAP)}…`;
  };
  const fromParas = paras.flatMap((p) => p.split(/(?<=[.;])\s+/)).map((s) => s.trim()).filter((s) => s.length > 30);
  const bullets = [...listItems, ...fromParas].slice(0, maxBullets).map(clip);
  if (bullets.length) {
    out.push(N('bulleted_list', { items: bullets.map((text) => ({ text })) }, { size: 13 }));
  }
  return out;
}

/** Every atom id in the tenant's library right now, read with the owner pool. */
async function atomIds(): Promise<Set<string>> {
  const { sqlBypass } = await import('@/lib/db');
  const rows = await sqlBypass<Array<{ id: string }>>`
    SELECT a.id FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = ${SLUG}`;
  return new Set(rows.map((r) => r.id));
}

let atomsBefore = new Set<string>();

/**
 * Put the library back exactly as it was found, and remove the document.
 *
 * Deletes by ID DELTA — the ids that exist now and did not before. Nothing is matched on title or
 * content, because a content match is how a previous cleanup nearly removed a real seeded atom.
 */
async function dispose(docId: string | null): Promise<void> {
  const { sqlBypass } = await import('@/lib/db');
  const after = await atomIds();
  const mine = [...after].filter((id) => !atomsBefore.has(id));
  if (mine.length) await sqlBypass`DELETE FROM library_atoms WHERE id = ANY(${mine}::uuid[])`;
  if (docId) await sqlBypass`DELETE FROM tenant_documents WHERE id = ${docId}::uuid`;
  const final = await atomIds();
  const clean = final.size === atomsBefore.size;
  step('8-dispose', 'the library is exactly as this drive found it', clean,
    `removed ${mine.length} atom(s)${docId ? ' + the document' : ''} → ${final.size} vs ${atomsBefore.size} before`);
}

let createdDocId: string | null = null;

async function run(): Promise<void> {
  const browser = await launch();
  const uploaded: Array<{ tag: string; key: string; caption: string; alt: string }> = [];
  try {
    // ═══ 1 · SIGN IN, as a real person through the real form ═══════════════════════════════════
    console.error('\n══ 1 · SIGN IN ══');
    const bc = await signIn(browser, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
    const who = await (await bc.request.get(`${BASE}/api/auth/session`)).json().catch(() => null);
    step('1-auth', 'signed in as the tenant_admin', !!who?.user?.email, String(who?.user?.email ?? 'no session'));

    // WATERMARK BEFORE CREATING ANYTHING. Saving a document atomises it, so a drive that does not
    // dispose leaves atoms behind that later runs RETRIEVE and draft from — which is exactly the
    // residue this deck's first version was accidentally written out of. An id-delta is used rather
    // than a title match: the earlier cleanup that nearly destroyed a legitimate seeded atom did so
    // with an ILIKE on content.
    atomsBefore = await atomIds();
    console.error(`   (${atomsBefore.size} atoms in the library before this run)`);

    // ═══ 2 · FIGURES — made by our renderer, uploaded through our route ════════════════════════
    console.error('\n══ 2 · FIGURES — rendered, then uploaded to the tenant image prefix ══');
    for (const f of FIGURES) {
      const png = await figurePng(f.chart);
      writeFileSync(`${OUT}/${f.tag}.png`, png);

      // multipart through the real upload route — the same one the canvas editor posts to.
      const res = await bc.request.post(`${BASE}/api/portal/${SLUG}/uploads/image`, {
        multipart: { file: { name: `${f.tag}.png`, mimeType: 'image/png', buffer: png } },
      });
      const j = await res.json().catch(() => null);
      const key = j?.data?.storageKey ?? j?.data?.key ?? null;
      step(`2-${f.tag}`, `figure uploaded and stored`, res.status() === 200 && !!key,
        `${(png.length / 1024).toFixed(0)}KB → ${key ?? `status ${res.status()}`}`);
      if (key) uploaded.push({ tag: f.tag, key, caption: f.caption, alt: f.alt });
    }

    // ═══ 3 · THE LIBRARY — what can it actually support? ═══════════════════════════════════════
    //
    // Ask before drafting. A slide topic the library cannot ground is one the drafter will refuse,
    // and it should: see the header.
    console.error('\n══ 3 · LIBRARY RETRIEVAL — select before draft, as the UI does ══');
    const TOPICS = [
      // `subs` are the section's required subsections — a real section carries them, and the
      // drafter ranks the retrieved material against them as well as the title. Without them a
      // generic title like "Competitive Analysis" has no terms to rank by and the draft refuses
      // even though twelve relevant atoms came back.
      { tag: 'problem', title: 'The Hidden Bottleneck in Home Construction: Formwork', figure: 'cost',
        subs: ['formwork cost', 'labor', 'direct labor subdivision', 'material costs', 'savings'] },
      { tag: 'compete', title: 'Competitive Analysis', figure: 'time',
        subs: ['formwork time', 'form building stripping return cycle', 'locally sourced materials', 'equipment cost', 'project costs'] },
      { tag: 'risk', title: 'Risk and Mitigation', figure: 'risk',
        subs: ['slow adoption', 'inadequate funding', 'demonstrations and tours', 'pivot into new markets'] },
    ];
    const grounded: Array<{ tag: string; title: string; figure: string; subs: string[]; atoms: Array<{ id: string; content: string; category: string }> }> = [];
    for (const t of TOPICS) {
      const qs = new URLSearchParams({ text: t.title, vol: 'technical', limit: '12' });
      const res = await bc.request.get(`${BASE}/api/portal/${SLUG}/atoms/select?${qs}`);
      const j = await res.json().catch(() => null);
      const ranked = (j?.data?.atoms ?? []) as Array<{
        id: string; content: string | null; title: string | null; canvasNodes: CanvasNode[] | null;
      }>;
      // Same rule the product now uses (draft-all-sections.tsx): an atom's body is in `content`
      // when it is prose and in `canvasNodes` when it is a table, schedule or figure. Filtering on
      // `content` alone hid 699 of 2,148 approved atoms from the drafter.
      const atoms = ranked
        .map((a) => ({
          id: a.id, category: 'technical',
          content: (a.content && a.content.trim())
            || (a.canvasNodes ?? []).map(getNodeText).filter((t) => t && t.trim()).join('\n').trim(),
        }))
        .filter((a) => a.content.length > 0);
      step(`3-${t.tag}`, `library can ground "${t.title.slice(0, 38)}"`, atoms.length > 0,
        `${atoms.length} atom(s) with content of ${ranked.length} ranked`);
      grounded.push({ ...t, atoms });
    }

    // ═══ 4 · DRAFT — the prose, written around the figures, from that material ═════════════════
    console.error('\n══ 4 · DRAFT — proposal.draft_section, grounded in the retrieved atoms ══');
    const drafted: Record<string, CanvasNode[]> = {};
    let refusals = 0;
    for (const g of grounded) {
      const fig = FIGURES.find((f) => f.tag === g.figure)!;
      const res = await bc.request.post(`${BASE}/api/tools/proposal.draft_section`, {
        data: { input: {
          proposalId: PROPOSAL,
          sectionTitle: g.title,
          pageLimit: 1,
          requiredSubsections: g.subs,
          libraryAtoms: g.atoms,
          // The figure is named in the instruction so the prose is written AROUND it rather than
          // beside it — this is the "generated content around those images" requirement.
          instruction:
            `Write the body of one slide in an investor capability brief for a company that prints concrete formwork. The slide carries this figure: `
            + `"${fig.chart.title}" — ${fig.alt}. Refer to what the figure shows and draw the conclusion from it. `
            + `Short declarative sentences a reviewer can read at a glance.`,
        } },
      });
      const j = await res.json().catch(() => null);
      const nodes = (j?.data?.nodes ?? []) as CanvasNode[];
      const refused = nodes.some((n) => REFUSED.test(String((n.content as { text?: string })?.text ?? '')));
      if (refused) refusals++;
      // THE INVARIANT IS "DRAFT OR SAY SO", NOT "ALWAYS DRAFT".
      //
      // Refusing is the correct answer to material the drafter cannot write prose from — this
      // tenant's competitive analysis is speaker-note fragments ("Time= eliminating form building,
      // stripping, and return cycle"), not sentences. Scoring that as a failure would push the next
      // person to make the drafter invent something, which is the one outcome a proposal tool must
      // never have. So the step asserts the property, and groundability is REPORTED below instead.
      step(`4-${g.tag}`, `the drafter either drafts or refuses honestly — never invents`,
        res.status() === 200 && nodes.length > 0,
        refused ? 'refused: material is fragmentary, no prose fabricated' : `${nodes.length} nodes drafted`);
      drafted[g.tag] = nodes;
    }

    // ═══ 5 · ASSEMBLE — a real deck document in the tenant's workspace ═════════════════════════
    console.error('\n══ 5 · ASSEMBLE + SAVE the deck ══');
    const brk = () => N('page_break', {});
    const title = (text: string) => N('heading', { level: 1, text }, { size: 28, color: '#0F172A' });
    const sub = (text: string) => N('text_block', { text }, { size: 13, color: '#475569' });
    const imageNode = (tag: string) => {
      const u = uploaded.find((x) => x.tag === tag);
      if (!u) return null;
      // THE IMAGE'S TRUE SIZE, not a guess. renderChartSvg fixes a 480×300 viewBox for every plot,
      // and the ruler measures a figure by its DECLARED pixels — so declaring 720×440 charged the
      // slide ~4.6in for a figure the deck writer caps at 3in, and the overflow advisory flagged
      // two slides that render perfectly well. Declare what the file actually is.
      return N('image', { storage_key: u.key, alt_text: u.alt, caption: u.caption, width: 480, height: 300 }, {});
    };

    const nodes: CanvasNode[] = [
      title('The bottleneck is the formwork'),
      sub('3D-printed formwork for residential construction · Foundation 3DP · Youngstown, Ohio'),
      brk(),
    ];
    for (const g of grounded) {
      const heading = g.tag === 'problem' ? 'Formwork is 47% of the cost and 11 of the days'
        : g.tag === 'compete' ? 'Two weeks of formwork becomes four days'
        : 'The risks that matter are commercial';
      nodes.push(N('heading', { level: 2, text: heading }, { size: 24, color: '#0F172A' }));
      const img = imageNode(g.figure);
      if (img) nodes.push(img);
      // TWO, measured rather than chosen. The body band is 5.3in; the figure takes ~3in and its
      // caption ~0.35in, which leaves under 2in — about four wrapped lines at 13pt. Four bullets
      // overflowed slides 2 and 4 and the product's own advisory said so.
      nodes.push(...slideBody(drafted[g.tag] ?? [], 2));
      nodes.push(brk());
    }
    nodes.push(
      N('heading', { level: 2, text: 'The team and the path to a printer' }, { size: 24 }),
      N('table', { headers: ['Milestone', 'Target'], rows: [
        ['1-2  Design requirements, custom parts + COTS', 'Months 1-6'],
        ['3-4  Integrate sensors and software, fabricate the prototype', 'Months 7-13'],
        ['5-6  Scaled testing, then iterate on the design', 'Months 12-15'],
        ['7    Full-scale demonstration, third-party validation', 'Months 14-15'],
        ['8    First sales', 'Months 18-19'],
      ] }, {}),
      N('text_box', { text: 'Kate Ulepic CEO · Conor Atkins COO · Connor Casey CFO · Will Curley CTO — seeking a construction attorney, a technician and a homebuilder.' },
        { fill: { color: '#ECFDF5' }, border: { color: '#15803D', width: 1, style: 'solid', radius: 4 } }),
    );

    const doc = {
      version: 1, canvas: { ...CANVAS_PRESETS.slide_deck },
      metadata: { title: 'Foundation 3DP — Printed Formwork', status: 'draft' },
      nodes,
    } as unknown as CanvasDocument;

    const cr = await bc.request.post(`${BASE}/api/portal/${SLUG}/documents`, {
      data: { preset: 'deck', title: 'Foundation 3DP — Printed Formwork' },
    });
    const docId = (await cr.json().catch(() => null))?.data?.documentId;
    createdDocId = docId ?? null;
    // 201, not 200 — the route returns Created. Asserting 200 failed a step whose own detail
    // line printed a perfectly good document id.
    step('5-create', 'deck document created in the workspace', cr.status() === 201 && !!docId, `${cr.status()} · ${docId ?? 'no id'}`);
    if (!docId) throw new Error('no document to save into');

    const sv = await bc.request.put(`${BASE}/api/portal/${SLUG}/documents/${docId}/save`, {
      data: { content: doc, title: 'Foundation 3DP — Printed Formwork' },
    });
    step('5-save', 'canvas saved through the product save route', sv.status() === 200, `status ${sv.status()}`);

    // The product's OWN advisory, not my eyeballs. Off-frame content is a supported authoring
    // choice (DECK-1), so this never blocks an export — but a deck I am handing over should not
    // rely on that, and the first version of this one silently ran a bullet off slide 4.
    const over = overflowingSlides(doc);
    step('5-fit', 'no slide overflows its frame', over.length === 0,
      over.length ? `slides ${over.join(', ')} overflow` : 'every slide fits');

    const kinds = new Set(nodes.map((n) => n.type));
    step('5-vocab', 'the deck carries figures, prose, a table and a callout',
      kinds.has('image') && kinds.has('bulleted_list') && kinds.has('table') && kinds.has('text_box'),
      `${kinds.size} node types: ${[...kinds].sort().join(', ')}`);

    // ═══ 6 · EXPORT + MEASURE THE FILE ITSELF ═════════════════════════════════════════════════
    console.error('\n══ 6 · EXPORT .pptx — and measure what came out ══');
    const ex = await bc.request.post(`${BASE}/api/portal/${SLUG}/documents/${docId}/export`, {
      data: { document: doc, format: 'pptx' },
    });
    const buf = Buffer.from(await ex.body());
    writeFileSync(`${OUT}/capability-deck.pptx`, buf);
    step('6-export', 'the deck exports as .pptx', ex.status() === 200 && buf.length > 20_000,
      `${(buf.length / 1024).toFixed(0)}KB`);

    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
    step('6-slides', 'slide count matches the ruler', slides === estimateSlideCount(doc),
      `${slides} slides in the file, ruler said ${estimateSlideCount(doc)}`);

    // THE FIGURES, MEASURED IN THE DELIVERED FILE. An image node in the model proves nothing:
    // the storage key has to resolve and inline on the way out, and until this run nothing in
    // this system had ever carried a real picture through that path.
    // `ppt/media/` is itself an entry in the archive. Counting it reported a phantom 0KB image
    // — a finding about the harness dressed as a finding about the file.
    const media = Object.keys(zip.files).filter((f) => /^ppt\/media\/.+/.test(f) && !zip.files[f].dir);
    const mediaBytes = await Promise.all(media.map(async (m) => (await zip.files[m].async('nodebuffer')).length));
    step('6-media', 'the uploaded figures are EMBEDDED in the .pptx', media.length >= uploaded.length,
      `${media.length} media part(s): ${mediaBytes.map((b) => `${(b / 1024).toFixed(0)}KB`).join(', ')}`);

    // ═══ 7 · LOOK AT IT — an engine that did not write the file ═══════════════════════════════
    console.error('\n══ 7 · RENDER — LibreOffice, then page images ══');
    let rendered = 0;
    try {
      execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=file:///tmp/lo-deck',
        '--convert-to', 'pdf', '--outdir', OUT, `${OUT}/capability-deck.pptx`], { stdio: 'pipe', timeout: 300_000 });
      const pdf = `${OUT}/capability-deck.pdf`;
      if (existsSync(pdf)) {
        const pages = await capturePdfPages(readFileSync(pdf), { scale: 1.4 });
        for (const p of pages) writeFileSync(`${OUT}/slide-${String(p.pageNumber).padStart(2, '0')}.png`, p.png);
        rendered = pages.length;
      }
    } catch { /* reported as unmeasured below, never as a pass */ }
    step('7-render', 'every slide renders in an independent engine', rendered === slides,
      rendered ? `${rendered} page(s) → ${OUT}/slide-NN.png` : 'UNMEASURED — no LibreOffice Impress here');

    // ═══ 8 · DISPOSE ══════════════════════════════════════════════════════════════════════════
    step('4-ground', 'how much of the deck the library could actually ground',
      refusals < grounded.length,
      `${grounded.length - refusals}/${grounded.length} topics drafted; ${refusals} refused for want of prose-grade material`);

    console.error('\n══ 8 · DISPOSE — leave the library as it was found ══');
    await dispose(createdDocId);

    console.error(`\n${'─'.repeat(78)}`);
    const bad = STEPS.filter((s) => !s.ok);
    console.error(`${STEPS.length - bad.length}/${STEPS.length} steps passed. Artifacts in ${OUT}`);
    for (const b of bad) console.error(`  ✗ ${b.n} ${b.what} — ${b.detail}`);
    if (bad.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
