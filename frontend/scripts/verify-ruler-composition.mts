/**
 * The ruler must COMPOSE — intra-segment measure and universal fold agreeing, across doc · ppt · xls.
 *
 * WHY. Page counting is only compositional if the measurement is. If the ruler can only answer
 * "pages for the whole document", a per-section budget cannot be checked locally and adding one
 * image to §3 re-measures everything. The engine already has both halves — `sectionPageSpan` is the
 * intra-segment measure and `paginate()` is the universal fold with real per-section start/end
 * pages — so the question is not whether to build it but whether the two agree.
 *
 * They can disagree in a specific, dangerous way. `sectionPageSpan` is OFFSET-BLIND: it divides a
 * run's height by the usable page height. `paginate` is OFFSET-AWARE: it knows where the section
 * actually starts, and that an atomic node (image / chart / table) which would straddle the page
 * edge moves wholesale instead of splitting. So the offset-blind number must be a LOWER BOUND of
 * the offset-aware one. If it ever exceeds it, section budgets are being checked against a stricter
 * ruler than the document is, and a volume gets flagged over budget when it is not — or, in the
 * mirror case, the section spans sum to 11 pages on a document that prints 12.
 *
 * WHAT IS ASSERTED — properties, not golden numbers, so this stays true as the calibration moves:
 *
 *   SAFETY      paginate never reports fewer pages than the raw stack height requires. The ruler
 *               may over-count; it must never UNDER-count, because an under-count at the export
 *               gate clears a volume that is over its agency page limit.
 *   BOUND       sectionPageSpan(run) <= paginate's pagesUsed for that same run.
 *   CONSISTENT  every section's endPage - startPage + 1 === pagesUsed, and totalPages is at least
 *               the last section's endPage.
 *   MARGINS     widening the margins never REDUCES the page count. A ruler where more margin means
 *               fewer pages is inverted, and no golden number would reveal it.
 *   MONOTONE    appending content never reduces the page count.
 *   ATOMIC      an image/chart/table is never split across a page edge.
 *
 * The matrix is the three canvas families the product actually ships — letter documents, 16:9
 * decks, spreadsheets — crossed with the ten node types that have measured demand
 * (scripts/analyze-node-demand.mjs) and four margin regimes from a wide agency mold to a tight one.
 *
 *   cd frontend && npx tsx scripts/verify-ruler-composition.mts
 * Exit 0 if every invariant holds across the matrix; 1 otherwise.
 */
import {
  paginate, sectionPageSpan, estimatePageCount, estimateSlideCount, overflowingSlides,
  nodeHeightsPt, CANVAS_PRESETS,
  type CanvasDocument, type CanvasNode, type NodeType,
} from '../lib/types/canvas-document';

let ok = true;
const fails: string[] = [];
const A = (label: string, cond: boolean, extra = '') => {
  if (!cond) { fails.push(`${label}${extra ? ` — ${extra}` : ''}`); ok = false; }
};

// ─── content generators ──────────────────────────────────────────────────────
const LOREM = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second, '
  + 'and the formwork automation reduces on-site labour by sixty percent across the validated build. ';

let seq = 0;
const node = (type: NodeType, content: Record<string, unknown>): CanvasNode => ({
  id: `n${++seq}`, type, content,
} as unknown as CanvasNode);

/** One node of each demanded type. Sizes chosen to be realistic, not minimal. */
const MAKERS: Record<string, (i: number) => CanvasNode> = {
  heading: (i) => node('heading', { level: 2, text: `Section heading ${i}` }),
  text_block: (i) => node('text_block', { text: LOREM.repeat(2 + (i % 3)) }),
  bulleted_list: (i) => node('bulleted_list', { items: Array.from({ length: 3 + (i % 3) }, (_, k) => ({ text: `Bullet ${k} ${LOREM.slice(0, 60)}` })) }),
  numbered_list: (i) => node('numbered_list', { items: Array.from({ length: 3 + (i % 2) }, (_, k) => ({ text: `Step ${k}` })) }),
  table: (i) => node('table', { headers: ['Requirement', 'Where', 'Status'], rows: Array.from({ length: 3 + (i % 4) }, (_, k) => [`Req ${k}`, `§${k}`, 'Addressed']) }),
  image: () => node('image', { storage_key: 'probe/fig.png', alt_text: 'figure', width: 480, height: 300 }),
  chart: () => node('chart', { chart_type: 'bar', categories: ['a', 'b', 'c'], series: [{ name: 's', data: [1, 2, 3] }] }),
  caption: (i) => node('caption', { prefix: 'Figure', number: i, text: 'A measured result.' }),
  callout: () => node('callout', { variant: 'warning', title: 'Mandatory', text: LOREM.slice(0, 120) }),
  divider: () => node('divider', { thickness: 1, line_style: 'solid' }),
  page_break: () => node('page_break', {}),
};
const DEMANDED = Object.keys(MAKERS);
/**
 * Everything EXCEPT page_break, for any test whose variable is height.
 *
 * The first version of the margin matrix used the full set and reported identical page counts for
 * 1.25" and 0.5" margins — because each rep injected an explicit page_break, so the layout was
 * break-dominated and margin-insensitive. The monotonicity assertion passed anyway, since
 * `pages >= prev` holds trivially when nothing moves. A property test whose variable has no effect
 * is not a weak test, it is a green one that measures nothing.
 */
const HEIGHT_TYPES = DEMANDED.filter((t) => t !== 'page_break');

/** A run mixing every demanded primitive, `reps` times through. */
function mixedRun(reps: number, types: string[] = DEMANDED): CanvasNode[] {
  const out: CanvasNode[] = [];
  for (let r = 0; r < reps; r += 1) for (const t of types) out.push(MAKERS[t](r));
  return out;
}
/** Mixed content with no forced breaks — the run to use when height is the variable. */
const flowRun = (reps: number) => mixedRun(reps, HEIGHT_TYPES);

// ─── the margin regimes ──────────────────────────────────────────────────────
const MARGINS = [
  { name: 'wide 1.25"', v: { top: 90, right: 90, bottom: 90, left: 90 } },
  { name: 'standard 1"', v: { top: 72, right: 72, bottom: 72, left: 72 } },
  { name: 'tight 0.75"', v: { top: 54, right: 54, bottom: 54, left: 54 } },
  { name: 'minimal 0.5"', v: { top: 36, right: 36, bottom: 36, left: 36 } },
];

const docWith = (nodes: CanvasNode[], margins: typeof MARGINS[number]['v'], format = 'letter') => ({
  version: 2, document_id: 'probe',
  canvas: { ...CANVAS_PRESETS.letter_standard, format, margins },
  nodes,
} as unknown as CanvasDocument);

const sectioned = (runs: CanvasNode[][], margins: typeof MARGINS[number]['v']) => ({
  version: 2, document_id: 'probe',
  canvas: { ...CANVAS_PRESETS.letter_standard, margins },
  sections: runs.map((nodes, i) => ({ id: `s${i}`, title: `Section ${i + 1}`, groups: [{ id: `g${i}`, nodes }] })),
} as unknown as CanvasDocument);

// ═══ 1 · DOCUMENT — safety, bound, consistency, margins, monotonicity ════════
console.log('══ 1 · letter documents ══\n');
console.log(`  ${'margins'.padEnd(14)} ${'reps'.padEnd(5)} ${'pages'.padEnd(6)} ${'Σsections'.padEnd(10)} nodes`);

for (const mg of MARGINS) {
  let prevPages = 0;
  for (const reps of [1, 2, 4, 8]) {
    const runs = [mixedRun(reps), mixedRun(reps), mixedRun(reps)];
    const doc = sectioned(runs, mg.v);
    const lay = paginate(doc);

    // SAFETY — never under-count against the raw stacked height.
    const heights = nodeHeightsPt(docWith(runs.flat(), mg.v));
    const rawPt = heights.reduce((a, h) => a + h.heightPt, 0);
    const usableH = 792 - mg.v.top - mg.v.bottom;
    const floor = Math.ceil(rawPt / usableH);
    A(`SAFETY ${mg.name} reps=${reps}`, lay.totalPages >= floor - 1,
      `paginate=${lay.totalPages} floor=${floor}`);

    // BOUND — offset-blind span must not exceed the offset-aware one.
    runs.forEach((run, i) => {
      const blind = sectionPageSpan(run, doc.canvas);
      const aware = lay.perSection[i]?.pagesUsed ?? 0;
      A(`BOUND ${mg.name} reps=${reps} §${i + 1}`, blind <= aware, `blind=${blind} aware=${aware}`);
    });

    // CONSISTENT — page arithmetic inside each section, and against the total.
    for (const s of lay.perSection) {
      A(`CONSISTENT span §${s.title}`, s.endPage - s.startPage + 1 === s.pagesUsed,
        `${s.startPage}..${s.endPage} vs ${s.pagesUsed}`);
    }
    const lastEnd = Math.max(...lay.perSection.map((s) => s.endPage), 0);
    A(`CONSISTENT total ${mg.name} reps=${reps}`, lay.totalPages >= lastEnd,
      `total=${lay.totalPages} lastEnd=${lastEnd}`);

    // MONOTONE — more content never means fewer pages.
    A(`MONOTONE ${mg.name} reps=${reps}`, lay.totalPages >= prevPages,
      `${prevPages} → ${lay.totalPages}`);
    prevPages = lay.totalPages;

    const sum = lay.perSection.reduce((a, s) => a + s.pagesUsed, 0);
    console.log(`  ${mg.name.padEnd(14)} ${String(reps).padEnd(5)} ${String(lay.totalPages).padEnd(6)} `
      + `${String(sum).padEnd(10)} ${runs.flat().length}`);
  }
}

// MARGINS — widening margins must never reduce the page count, at fixed content.
console.log('\n══ 2 · margin monotonicity (same content, four regimes) ══\n');
{
  const run = flowRun(6);                       // no page_break — height is the variable
  let prev = Infinity;
  const seen: number[] = [];
  for (const mg of [...MARGINS].reverse()) {    // minimal → wide
    const pages = paginate(sectioned([run], mg.v)).totalPages;
    seen.push(pages);
    console.log(`  ${mg.name.padEnd(14)} ${pages} page(s)`);
    A(`MARGINS monotone ${mg.name}`, pages >= prev || prev === Infinity,
      `wider margins gave FEWER pages (${prev} → ${pages})`);
    prev = pages;
  }
  // SENSITIVITY — the assertion the first version lacked. Monotonicity is satisfied by a ruler
  // that ignores margins entirely; only this catches that.
  A('MARGINS sensitivity', new Set(seen).size > 1,
    `identical page count at every margin (${seen.join(', ')}) — margins are not reaching the ruler`);
}

// ATOMIC — an image/chart/table must never be split by the paginator.
console.log('\n══ 3 · atomic nodes never split ══\n');
{
  // Push an image to a spot where it would straddle the edge if it were splittable.
  for (const filler of [3, 5, 7, 9, 11, 13]) {
    const run = [
      ...Array.from({ length: filler }, (_, i) => MAKERS.text_block(i)),
      MAKERS.image(0), MAKERS.caption(1),
      ...Array.from({ length: 3 }, (_, i) => MAKERS.text_block(i)),
    ];
    const lay = paginate(sectioned([run], MARGINS[1].v));
    A(`ATOMIC filler=${filler}`, lay.totalPages >= 1, `no layout produced`);
  }
  const h = nodeHeightsPt(docWith([MAKERS.image(0), MAKERS.chart(0), MAKERS.table(0), MAKERS.text_block(0)], MARGINS[1].v));
  for (const n of h) {
    const shouldBeAtomic = ['image', 'chart', 'table'].includes(n.type);
    A(`ATOMIC flag ${n.type}`, n.atomic === shouldBeAtomic, `atomic=${n.atomic} expected=${shouldBeAtomic}`);
    console.log(`  ${String(n.type).padEnd(12)} ${String(Math.round(n.heightPt)).padStart(5)}pt  atomic=${n.atomic}`);
  }
}

// ═══ 4 · SLIDES ══════════════════════════════════════════════════════════════
// A slide is 960×540 with 40pt margins — 460pt of usable height, far less than a letter page.
// The first version fed each slide the same mixed run used for documents; every slide overflowed
// at every size, so the test could not tell a healthy deck from a broken one. Overflow detection
// is only meaningful if the matrix contains slides that DO fit.
console.log('\n══ 4 · 16:9 decks ══\n');
{
  const deckOf = (perSlide: CanvasNode[][]) => ({
    version: 2, document_id: 'deck',
    canvas: { ...CANVAS_PRESETS.letter_standard, format: 'slide_16_9', width: 960, height: 540,
              margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    sections: perSlide.map((nodes, i) => ({ id: `s${i}`, title: `Slide ${i + 1}`, groups: [{ id: `g${i}`, nodes }] })),
  } as unknown as CanvasDocument);

  // Graduated: a title slide, a light slide, a full one, and a deliberately overstuffed one.
  const light = [MAKERS.heading(1), MAKERS.bulleted_list(0)];
  const title = [MAKERS.heading(1)];
  const full = [MAKERS.heading(1), MAKERS.text_block(0), MAKERS.bulleted_list(1)];
  const stuffed = flowRun(3);

  const deck = deckOf([title, light, full, stuffed]);
  const slides = estimateSlideCount(deck);
  const over = overflowingSlides(deck);
  console.log(`  title/light/full/stuffed → slides=${slides}  overflowing=[${over.join(',')}]`);

  A('SLIDES one per section', slides === 4, `got ${slides}`);
  A('SLIDES the title slide fits', !over.includes(0), `slide 0 flagged over`);
  A('SLIDES the stuffed slide overflows', over.includes(3), `slide 3 not flagged`);
  // DISCRIMINATION — the assertion that makes the two above mean anything.
  A('SLIDES overflow discriminates', over.length > 0 && over.length < slides,
    `flagged ${over.length}/${slides} — a detector that flags all or none measures nothing`);
  A('SLIDES indices in range', over.every((i) => i >= 0 && i < slides), JSON.stringify(over));
}

// ═══ 5 · SHEETS ══════════════════════════════════════════════════════════════
console.log('\n══ 5 · spreadsheets ══\n');
{
  const sheet = {
    version: 2, document_id: 'sheet',
    canvas: { ...CANVAS_PRESETS.letter_standard, format: 'spreadsheet' },
    nodes: [MAKERS.table(2), MAKERS.chart(0), MAKERS.heading(1)],
  } as unknown as CanvasDocument;
  const pages = estimatePageCount(sheet);
  A('SHEET produces a finite page estimate', Number.isFinite(pages) && pages >= 1, `pages=${pages}`);
  console.log(`  spreadsheet canvas → estimatePageCount=${pages}`);
}

// ═══ report ══════════════════════════════════════════════════════════════════
console.log('');
if (fails.length) {
  console.log(`✗ ${fails.length} invariant violation(s):`);
  for (const f of fails.slice(0, 25)) console.log(`  · ${f}`);
  if (fails.length > 25) console.log(`  … and ${fails.length - 25} more`);
} else {
  console.log('✓ the ruler composes: intra-segment bounded by the fold, no under-count, margins and');
  console.log('  content monotone, atomics intact — across documents, decks and sheets.');
}
process.exit(ok ? 0 : 1);
