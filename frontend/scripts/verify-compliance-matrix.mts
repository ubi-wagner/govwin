/**
 * The ruler aggregating into CANVAS COMPLIANCE — all 22 primitives, mixed orders, real matrices.
 *
 * `verify-ruler-composition` proves the ruler composes (intra-segment bounded by the fold, no
 * under-count, margins and content monotone). It stops at the ruler. This carries the same content
 * one level up, through `validateCanvasAgainstSpec`, which is the gate an artifact actually has to
 * pass — and it does it across the WHOLE node vocabulary rather than the ten types with measured
 * demand, because a type nobody drafts today is still a type a mold or a paste can introduce
 * tomorrow, and the gate must not throw or silently mismeasure when it arrives.
 *
 * Three things are being tested that the ruler harness cannot reach:
 *
 *   AGGREGATION   the page count the COMPLIANCE gate enforces is the same number `paginate()`
 *                 reports. If those two ever diverge, a volume passes the editor gauge and fails
 *                 the export gate (or worse, the reverse).
 *   ORDER         content-based rules must be order-INVARIANT. Reordering the same nodes cannot
 *                 change whether the document contains an image, what its smallest font is, or how
 *                 many characters it holds. Layout-based rules (page count) legitimately MAY vary
 *                 with order, because an atomic node that straddles a page edge moves wholesale —
 *                 so the harness asserts invariance only where invariance is actually required.
 *                 Asserting it everywhere would manufacture failures out of correct behaviour.
 *   MATRICES      the same document judged against several real agency shapes — a paginated DoD
 *                 volume, a character-capped abstract, a slide deck, and a spec that forbids images
 *                 outright — must produce DIFFERENT verdicts. A matrix dimension along which every
 *                 answer is identical is measuring nothing, which is the failure mode that made the
 *                 first margin test pass vacuously.
 *
 * Determinism: orders are permuted by a seeded hash, never Math.random. A harness whose output
 * drifts run to run reports the instrument rather than the product.
 *
 *   cd frontend && npx tsx scripts/verify-compliance-matrix.mts
 * Exit 0 if every property holds; 1 otherwise.
 */
import {
  validateCanvasAgainstSpec, paginate, estimatePageCount, estimateSlideCount,
  countCharacters, nodeHeightsPt, CANVAS_PRESETS,
  type CanvasDocument, type CanvasNode, type NodeType, type ComplianceSpec,
} from '../lib/types/canvas-document';

let ok = true;
const fails: string[] = [];
const A = (label: string, cond: boolean, extra = '') => {
  if (!cond) { fails.push(`${label}${extra ? ` — ${extra}` : ''}`); ok = false; }
};

const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second, and '
  + 'the formwork automation reduced on-site labour by sixty percent across the validated build. ';

let seq = 0;
const mk = (type: NodeType, content: Record<string, unknown>, style?: Record<string, unknown>) =>
  ({ id: `n${++seq}`, type, content, ...(style ? { style } : {}) } as unknown as CanvasNode);

/** EVERY member of NodeType. Kept exhaustive on purpose — see the coverage assertion at the end. */
const MAKERS: Record<NodeType, () => CanvasNode> = {
  heading: () => mk('heading', { level: 2, text: 'A section heading' }),
  text_block: () => mk('text_block', { text: PROSE.repeat(2) }),
  bulleted_list: () => mk('bulleted_list', { items: [{ text: PROSE.slice(0, 70) }, { text: PROSE.slice(0, 50) }] }),
  numbered_list: () => mk('numbered_list', { items: [{ text: 'Step one' }, { text: 'Step two' }] }),
  image: () => mk('image', { storage_key: 'probe/fig.png', alt_text: 'A validated build', width: 480, height: 300 }),
  table: () => mk('table', { headers: ['Requirement', 'Where', 'Status'], rows: [['A', '§1', 'Yes'], ['B', '§2', 'Yes']] }),
  caption: () => mk('caption', { prefix: 'Figure', number: 1, text: 'The gantry at full scale.' }),
  footnote: () => mk('footnote', { marker: '1', text: 'Measured across twelve batches.' }),
  toc: () => mk('toc', { max_depth: 2 }),
  page_break: () => mk('page_break', {}),
  url: () => mk('url', { href: 'https://example.gov/notice', display_text: 'The solicitation notice' }),
  spacer: () => mk('spacer', { height: 18 }),
  shape: () => mk('shape', { shape: 'rectangle', text: 'Phase I' }),
  text_box: () => mk('text_box', { text: PROSE.slice(0, 120) }),
  callout: () => mk('callout', { variant: 'warning', title: 'Mandatory', text: PROSE.slice(0, 140) }),
  code_block: () => mk('code_block', { code: 'def burden(x):\n    return x * 1.35\n', language: 'python' }),
  blockquote: () => mk('blockquote', { text: PROSE.slice(0, 130), cite: 'Solicitation §4' }),
  chart: () => mk('chart', { chart_type: 'bar', categories: ['a', 'b', 'c'], series: [{ name: 's', data: [1, 2, 3] }] }),
  equation: () => mk('equation', { latex: 'E = mc^2', display: true }),
  divider: () => mk('divider', { thickness: 1, line_style: 'solid' }),
  video: () => mk('video', { url: 'https://example.gov/demo.mp4', caption: 'Print head demo' }),
  signature: () => mk('signature', { label: 'Authorized Representative', signer_name: 'K. Ulepic' }),
};
const VOCABULARY = Object.keys(MAKERS) as NodeType[];

/** Deterministic permutation — a seeded Fisher–Yates, so orders vary but never between runs. */
function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shuffled<T>(xs: T[], seed: string): T[] {
  const a = [...xs];
  let h = hash32(seed) || 1;
  for (let i = a.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── the compliance matrices — real agency shapes, deliberately different ────
const SPEC = (o: Partial<ComplianceSpec>): ComplianceSpec => ({
  max_pages: null, max_slides: null, min_font_size: null, images_allowed: true,
  required_sections: [], header_required: false, footer_required: false, max_characters: null, ...o,
});
const MATRICES: Array<{ name: string; spec: ComplianceSpec; format: string }> = [
  { name: 'DoD SBIR Phase I', format: 'letter', spec: SPEC({ max_pages: 15, min_font_size: 10, header_required: true, footer_required: true }) },
  { name: 'NSF project pitch', format: 'letter', spec: SPEC({ max_pages: 3, min_font_size: 10 }) },
  { name: 'abstract (chars)', format: 'letter', spec: SPEC({ max_characters: 4000 }) },
  { name: 'no-images spec', format: 'letter', spec: SPEC({ max_pages: 20, images_allowed: false }) },
  { name: 'tight 2-page', format: 'letter', spec: SPEC({ max_pages: 2, min_font_size: 11 }) },
  { name: 'deck (12 slides)', format: 'slide_16_9', spec: SPEC({ max_slides: 12 }) },
  { name: 'generous', format: 'letter', spec: SPEC({ max_pages: 500, max_characters: 10_000_000 }) },
];

const docOf = (nodes: CanvasNode[], format: string): CanvasDocument => ({
  version: 2, document_id: 'probe',
  canvas: format === 'slide_16_9'
    ? { ...CANVAS_PRESETS.letter_standard, format, width: 960, height: 540, margins: { top: 40, right: 40, bottom: 40, left: 40 } }
    : { ...CANVAS_PRESETS.letter_standard, format },
  ...(format === 'slide_16_9'
    ? { sections: chunk(nodes, 4).map((ns, i) => ({ id: `s${i}`, title: `Slide ${i + 1}`, groups: [{ id: `g${i}`, nodes: ns }] })) }
    : { nodes }),
} as unknown as CanvasDocument);

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const codes = (vs: { code: string }[]) => [...new Set(vs.map((v) => v.code))].sort();

// ═══ 0 · the instrument itself — does the shuffle shuffle? ══════════════════
// Every order-based property below is vacuous if the permutation returns the same sequence each
// time. Asserting the variety is what stops this harness reporting a green that measures nothing —
// the failure mode that made the first margin matrix pass while margins did nothing at all.
console.log('══ 0 · the permutation varies ══\n');
{
  const orders = ['o1', 'o2', 'o3', 'o4', 'o5'].map((s) => shuffled(VOCABULARY, s).join(','));
  const distinct = new Set(orders).size;
  A('SHUFFLE produces distinct orders', distinct === orders.length, `${distinct} distinct of ${orders.length}`);
  A('SHUFFLE is not the identity', orders[0] !== VOCABULARY.join(','), 'seed o1 returned the input order');
  console.log(`  ${distinct}/${orders.length} distinct permutations of ${VOCABULARY.length} primitives`);
}

// ═══ 1 · every primitive is measurable in every canvas family ════════════════
console.log('══ 1 · all 22 primitives measurable ══\n');
{
  for (const format of ['letter', 'slide_16_9', 'spreadsheet']) {
    const doc = docOf(VOCABULARY.map((t) => MAKERS[t]()), format);
    let bad = 0;
    if (format !== 'slide_16_9') {
      for (const h of nodeHeightsPt(doc)) {
        if (!Number.isFinite(h.heightPt) || h.heightPt < 0) { bad += 1; console.log(`      ✗ ${h.type} → ${h.heightPt}`); }
      }
    }
    let threw = '';
    try { validateCanvasAgainstSpec(doc, MATRICES[0].spec); } catch (e) { threw = (e as Error).message; }
    A(`MEASURABLE ${format}`, bad === 0, `${bad} node(s) with a non-finite or negative height`);
    A(`NO THROW ${format}`, threw === '', threw);
    console.log(`  ${format.padEnd(14)} ${VOCABULARY.length} primitives · heights finite · validator did not throw`);
  }
}

// ═══ 2 · aggregation — the gate enforces the ruler's own number ══════════════
console.log('\n══ 2 · the compliance gate and the ruler agree ══\n');
{
  for (const seed of ['a', 'b', 'c', 'd']) {
    const nodes = shuffled(VOCABULARY, seed).flatMap((t) => [MAKERS[t](), MAKERS.text_block()]);
    const doc = docOf(nodes, 'letter');
    const fromRuler = paginate(doc).totalPages;
    const fromEstimate = estimatePageCount(doc);
    A(`AGGREGATION seed=${seed}`, fromRuler === fromEstimate, `paginate=${fromRuler} estimatePageCount=${fromEstimate}`);
    // And the gate's own verdict must follow that number.
    const tight = validateCanvasAgainstSpec(doc, SPEC({ max_pages: fromRuler - 1 }));
    const exact = validateCanvasAgainstSpec(doc, SPEC({ max_pages: fromRuler }));
    A(`GATE fires one under seed=${seed}`, codes(tight).includes('over_page_limit'), codes(tight).join(','));
    A(`GATE clears at exactly seed=${seed}`, !codes(exact).includes('over_page_limit'), codes(exact).join(','));
    console.log(`  seed=${seed}  pages=${fromRuler}  gate@${fromRuler - 1}→over  gate@${fromRuler}→clear`);
  }
}

// ═══ 3 · order invariance where it is required ══════════════════════════════
console.log('\n══ 3 · content rules order-invariant, layout rules may vary ══\n');
{
  const CONTENT_CODES = new Set(['image_not_allowed', 'font_too_small', 'over_character_limit']);
  // Include a node carrying an explicit UNDERSIZE font. Without one, `min_font_size` never fires
  // anywhere in this harness — two matrices constrain it and nothing ever tripped it, which is
  // coverage that looks present and is not.
  const base = [...VOCABULARY.map((t) => MAKERS[t]()),
    mk('text_block', { text: 'Set in eight point, below every agency floor.' }, { size: 8 })];
  const spec = SPEC({ images_allowed: false, min_font_size: 11, max_characters: 200, max_pages: 500 });
  const seen: string[][] = [];
  const pageCounts: number[] = [];
  for (const seed of ['o1', 'o2', 'o3', 'o4', 'o5']) {
    const doc = docOf(shuffled(base, seed), 'letter');
    const v = validateCanvasAgainstSpec(doc, spec);
    seen.push(codes(v).filter((c) => CONTENT_CODES.has(c)));
    pageCounts.push(paginate(doc).totalPages);
  }
  const first = JSON.stringify(seen[0]);
  A('ORDER content-rule verdicts identical across permutations',
    seen.every((s) => JSON.stringify(s) === first), JSON.stringify(seen));
  console.log(`  content-rule codes (all 5 orders): ${seen[0].join(', ') || '(none)'}`);
  console.log(`  page counts across the same orders: ${pageCounts.join(', ')}  ← may legitimately vary`);
  // The content rules must actually FIRE, or the invariance above is vacuous.
  A('ORDER the content rules fired at all', seen[0].length >= 3, `only ${seen[0].length} fired`);
  A('ORDER the font floor fired', seen[0].includes('font_too_small'), seen[0].join(','));
}

// ═══ 4 · the matrices actually discriminate ═════════════════════════════════
console.log('\n══ 4 · the same document judged by seven matrices ══\n');
{
  const nodes = shuffled(VOCABULARY, 'matrix').flatMap((t) => [MAKERS[t](), MAKERS.text_block(), MAKERS.text_block()]);
  const verdicts = new Map<string, string[]>();
  for (const m of MATRICES) {
    const doc = docOf(nodes, m.format);
    const v = validateCanvasAgainstSpec(doc, m.spec);
    verdicts.set(m.name, codes(v));
    const pages = m.format === 'slide_16_9' ? `${estimateSlideCount(doc)} slides` : `${estimatePageCount(doc)}pp`;
    console.log(`  ${m.name.padEnd(18)} ${pages.padEnd(11)} ${codes(v).join(', ') || '(clean)'}`);
  }
  const distinct = new Set([...verdicts.values()].map((v) => v.join('|')));
  A('MATRICES discriminate', distinct.size > 1,
    `every matrix returned the same verdict (${distinct.size}) — the dimension measures nothing`);
  A('MATRICES the generous spec is clean', (verdicts.get('generous') ?? []).length === 0,
    (verdicts.get('generous') ?? []).join(','));
  A('MATRICES the no-images spec flags the image', (verdicts.get('no-images spec') ?? []).includes('image_not_allowed'),
    (verdicts.get('no-images spec') ?? []).join(','));
  A('MATRICES the tight spec flags pages', (verdicts.get('tight 2-page') ?? []).includes('over_page_limit'),
    (verdicts.get('tight 2-page') ?? []).join(','));
  A('MATRICES the abstract flags characters', (verdicts.get('abstract (chars)') ?? []).includes('over_character_limit'),
    (verdicts.get('abstract (chars)') ?? []).join(','));
}

// ═══ 5 · coverage — every primitive reached the gate ════════════════════════
console.log('\n══ 5 · vocabulary coverage ══\n');
{
  A('COVERAGE the maker table is exhaustive over NodeType', VOCABULARY.length === 22, `${VOCABULARY.length} makers`);
  const doc = docOf(VOCABULARY.map((t) => MAKERS[t]()), 'letter');
  const measured = new Set(nodeHeightsPt(doc).map((h) => h.type));
  const missing = VOCABULARY.filter((t) => !measured.has(t));
  A('COVERAGE every primitive reached the ruler', missing.length === 0, missing.join(','));
  const chars = countCharacters(VOCABULARY.map((t) => MAKERS[t]()));
  A('COVERAGE the character ruler saw text', chars > 200, `${chars} chars`);
  console.log(`  ${VOCABULARY.length}/22 primitives measured · ${chars} characters counted`);
}

console.log('');
if (fails.length) {
  console.log(`✗ ${fails.length} violation(s):`);
  for (const f of fails.slice(0, 20)) console.log(`  · ${f}`);
} else {
  console.log('✓ all 22 primitives measure, aggregate into the compliance gate, stay order-invariant');
  console.log('  where required, and the matrices discriminate — doc · deck · sheet.');
}
process.exit(ok ? 0 : 1);
