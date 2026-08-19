/**
 * Document furniture — the apparatus that separates a drafted document from a finished one.
 *
 * WHY THIS EXISTS. Drafting produces prose: `markdown_to_canvas` emits headings, text blocks and
 * lists, and nothing else. The mold it lands in (`lib/ingest/molds.ts::buildMoldCanvas`) is a
 * heading per required section plus an empty paragraph. So a volume that clears every compliance
 * check can still arrive with no figure, no caption, no table outside the cost form, no footnote,
 * no divider, no running header — and half its page envelope unused.
 *
 * Measured against a hand-built reference volume for the same solicitation:
 *
 *   | property        | reference        | generated |
 *   | pages           | 10 of 10         | ~7        |
 *   | characters      | 36,701           | 19,298    |
 *   | images/figures  | 44 over 5 pages  | 0         |
 *   | font faces      | 9                | 1         |
 *
 * An evaluator reads a half-empty volume as a half-made proposal. Filling the envelope is a
 * requirement, not a nicety: a 10-page cap means ~9.9 pages, a 3,000-character cap means just
 * under 3,000.
 *
 * WHAT THIS IS NOT. It does not write prose and it does not invent facts. Every function here is
 * deterministic and derives entirely from what is already in the document or from numbers the
 * system computed elsewhere (`lib/proposal/cost-model.ts`, the schedule, the work split). Same
 * input, same output, no model call — so it is safe to run inside an export path and it can be
 * unit-tested exactly.
 *
 * WHAT IT DOES.
 *   numberFigures      sequential Figure/Table/Chart numbering, repairing wrong numbers
 *   emphasise          inline bold/italic runs on terms that matter (the font-variety gap)
 *   addSectionRules    dividers between top-level sections
 *   buildTocNode       a table of contents from the heading tree
 *   costWaterfallChart / workSplitChart / scheduleGanttChart
 *                      figures COMPUTED from real proposal numbers, as native `chart` nodes
 *                      (which export natively to docx/pptx/xlsx/pdf — no raster round-trip)
 *   measureDocument    the quality ruler: fill %, node-type coverage, furniture counts
 *
 * All page/character measurement delegates to the SAME functions the compliance gate and the live
 * editor gauge use (`paginate` / `countCharacters`), so this can never disagree with them.
 */
import {
  type CanvasDocument,
  type CanvasNode,
  type CaptionContent,
  type ChartContent,
  type HeadingContent,
  type TableContent,
  type TextBlockContent,
  type TocContent,
  countCharacters,
  docNodes,
  estimatePageCount,
  getNodeText,
} from '@/lib/types/canvas-document';

// ─────────────────────────────────────────────────────────────────────────────
// Node construction
// ─────────────────────────────────────────────────────────────────────────────

/** Build a node with the required envelope fields filled in. */
export function furnitureNode(
  type: CanvasNode['type'],
  content: CanvasNode['content'],
  style: CanvasNode['style'] = {},
): CanvasNode {
  return {
    id: crypto.randomUUID(),
    type,
    content,
    style,
    // 'template' — this is document apparatus, not authored content and not AI output. Provenance
    // matters at the library-eligibility gate: furniture must never be harvested back into the
    // atom library as if it were reusable content.
    provenance: { source: 'template' },
    history: [],
    library_eligible: false,
  } as CanvasNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Figure / table numbering
// ─────────────────────────────────────────────────────────────────────────────

/** The node types a caption can belong to, and the caption prefix each takes. */
const CAPTIONABLE: Partial<Record<CanvasNode['type'], CaptionContent['prefix']>> = {
  image: 'Figure',
  chart: 'Chart',
  table: 'Table',
};

/**
 * Give every figure, chart and table a correctly numbered caption.
 *
 * Numbering runs per PREFIX (Figure 1, Figure 2 … independently of Table 1, Table 2 …), which is
 * how every agency style guide counts them. A caption that already follows its element keeps its
 * text and is renumbered in place; an element with no caption gets one built from its own title,
 * alt text, or sheet name — never invented.
 *
 * Renumbering rather than appending is the point: captions drift the moment a figure is inserted
 * above another one, and a proposal whose figure numbers do not match its cross-references reads
 * as unproofed.
 */
export function numberFigures(nodes: CanvasNode[]): CanvasNode[] {
  const counters: Record<string, number> = { Figure: 0, Table: 0, Chart: 0 };
  const out: CanvasNode[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    out.push(n);
    const prefix = CAPTIONABLE[n.type];
    if (!prefix) continue;

    counters[prefix] += 1;
    const num = counters[prefix];
    const next = nodes[i + 1];

    if (next && next.type === 'caption') {
      // Existing caption → renumber in place, keep the author's words.
      const c = next.content as CaptionContent;
      out.push({ ...next, content: { ...c, prefix, number: num } });
      i += 1; // consumed
      continue;
    }

    const text = defaultCaptionText(n);
    if (!text) continue; // nothing truthful to say about it — better silent than fabricated
    out.push(furnitureNode('caption', { prefix, number: num, text } satisfies CaptionContent));
  }
  return out;
}

/** A caption drawn from the element itself — its title, alt text or sheet name. Never invented. */
function defaultCaptionText(n: CanvasNode): string {
  if (n.type === 'chart') return (n.content as ChartContent)?.title?.trim() ?? '';
  if (n.type === 'image') {
    const c = n.content as { caption?: string; alt_text?: string };
    return (c?.caption || c?.alt_text || '').trim();
  }
  if (n.type === 'table') {
    const c = n.content as TableContent;
    return (c?.sheet_name || '').trim();
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline emphasis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add bold/italic runs to terms that carry weight, so body copy is not one undifferentiated face.
 *
 * The reference volume uses nine font faces; a generated one used one. That difference is not
 * decoration — an evaluator skimming for "does this address the requirement" navigates by visual
 * weight, and a wall of uniform 10pt Times gives them nothing to land on.
 *
 * Rules kept deliberately narrow so this stays deterministic and never mangles text:
 *   • whole-word, case-sensitive matches only (so "IP" never matches inside "equIPment")
 *   • FIRST occurrence per block only — emphasising every instance is what makes a page look
 *     shouted rather than structured
 *   • existing `inline_formats` are preserved, and a new run is dropped if it would overlap one
 *   • runs are emitted in ascending `start` order, which is what the exporters assume
 */
export function emphasise(
  nodes: CanvasNode[],
  terms: { bold?: string[]; italic?: string[] } = {},
): CanvasNode[] {
  const bold = terms.bold ?? [];
  const italic = terms.italic ?? [];
  if (bold.length === 0 && italic.length === 0) return nodes;

  return nodes.map((n) => {
    if (n.type !== 'text_block') return n;
    const c = n.content as TextBlockContent;
    const text = c?.text ?? '';
    if (!text) return n;

    const runs = [...(c.inline_formats ?? [])];
    const claimed = (start: number, len: number) =>
      runs.some((r) => start < r.start + r.length && r.start < start + len);

    for (const [format, list] of [['bold', bold], ['italic', italic]] as const) {
      for (const term of list) {
        if (!term) continue;
        const at = findWholeWord(text, term);
        if (at < 0 || claimed(at, term.length)) continue;
        runs.push({ start: at, length: term.length, format });
      }
    }
    if (runs.length === (c.inline_formats?.length ?? 0)) return n;
    runs.sort((a, b) => a.start - b.start);
    return { ...n, content: { ...c, inline_formats: runs } };
  });
}

/** Index of the first whole-word occurrence of `term`, or -1. Case-sensitive by design. */
function findWholeWord(text: string, term: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at < 0) return -1;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + term.length] ?? '';
    if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) return at;
    from = at + 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural furniture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Put a hairline rule before each top-level heading after the first.
 *
 * Deliberately skips the first heading (a rule above the document title is noise) and never
 * doubles a rule that is already there.
 */
export function addSectionRules(nodes: CanvasNode[]): CanvasNode[] {
  const out: CanvasNode[] = [];
  let seenH1 = false;
  for (const n of nodes) {
    const isH1 = n.type === 'heading' && (n.content as HeadingContent)?.level === 1;
    if (isH1) {
      if (seenH1 && out[out.length - 1]?.type !== 'divider') {
        out.push(furnitureNode('divider', { thickness: 0.5, line_style: 'solid', color: '#94A3B8' }));
      }
      seenH1 = true;
    }
    out.push(n);
  }
  return out;
}

/**
 * A table of contents built from the document's own headings.
 *
 * Returns null under `minHeadings` — a TOC over three headings costs a page and earns nothing,
 * and on a page-capped volume that page is the offeror's to spend on content.
 */
export function buildTocNode(nodes: CanvasNode[], minHeadings = 6): CanvasNode | null {
  const entries = nodes
    .filter((n) => n.type === 'heading')
    .map((n) => n.content as HeadingContent)
    .filter((h) => h?.text?.trim())
    .map((h) => ({ text: h.text.trim(), level: h.level ?? 1 }));
  if (entries.length < minHeadings) return null;
  return furnitureNode('toc', { entries, title: 'Contents' } as unknown as TocContent);
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed data figures
// ─────────────────────────────────────────────────────────────────────────────

/** One burden line of the computed cost model, in dollars. */
export interface CostBreakdown {
  labor: number;
  fringe: number;
  overhead: number;
  materials?: number;
  subcontracts?: number;
  ga: number;
  fee?: number;
}

/**
 * The cost build-up as a bar chart — the single most-read figure in a cost volume.
 *
 * Takes the SAME numbers the cost form prints (`lib/proposal/cost-model.ts`), so the figure and
 * the table can never disagree. Zero and absent lines are dropped rather than plotted as empty
 * bars, which is what makes a chart look auto-generated.
 */
export function costWaterfallChart(cost: CostBreakdown, title = 'Cost build-up'): CanvasNode {
  const lines: Array<[string, number | undefined]> = [
    ['Direct labor', cost.labor],
    ['Fringe', cost.fringe],
    ['Overhead', cost.overhead],
    ['Materials / ODC', cost.materials],
    ['Subcontracts', cost.subcontracts],
    ['G&A', cost.ga],
    ['Fee', cost.fee],
  ];
  const present = lines.filter(([, v]) => typeof v === 'number' && v > 0) as Array<[string, number]>;
  return furnitureNode('chart', {
    chart_type: 'bar',
    title,
    categories: present.map(([k]) => k),
    series: [{ name: 'USD', data: present.map(([, v]) => Math.round(v)) }],
  } satisfies ChartContent);
}

/**
 * The prime/sub work split as a doughnut — the figure that answers the eligibility question an
 * SBIR/STTR evaluator checks first (the small-business work-share floor).
 */
export function workSplitChart(
  split: Array<{ name: string; percent: number }>,
  title = 'Work share',
): CanvasNode {
  return furnitureNode('chart', {
    chart_type: 'doughnut',
    title,
    categories: split.map((s) => s.name),
    series: [{ name: '% of effort', data: split.map((s) => Math.round(s.percent * 10) / 10) }],
  } satisfies ChartContent);
}

/**
 * The schedule as a gantt. `series[0]` is the start month and `series[1]` the end month per task —
 * the shape the chart renderer documents for `chart_type: 'gantt'`.
 */
export function scheduleGanttChart(
  tasks: Array<{ name: string; startMonth: number; endMonth: number }>,
  title = 'Schedule',
): CanvasNode {
  return furnitureNode('chart', {
    chart_type: 'gantt',
    title,
    categories: tasks.map((t) => t.name),
    series: [
      { name: 'Start (month)', data: tasks.map((t) => t.startMonth) },
      { name: 'End (month)', data: tasks.map((t) => t.endMonth) },
    ],
  } satisfies ChartContent);
}

// ─────────────────────────────────────────────────────────────────────────────
// The quality ruler
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentMeasurement {
  pages: number;
  maxPages: number | null;
  /** Pages used as a fraction of the cap. Target ~0.95–0.99; `null` when uncapped. */
  pageFill: number | null;
  characters: number;
  maxCharacters: number | null;
  /** Characters used as a fraction of the cap; `null` when uncapped. */
  characterFill: number | null;
  /** Count of every node type present — the coverage half of the quality bar. */
  nodeTypes: Record<string, number>;
  /** Distinct node types used. */
  distinctNodeTypes: number;
  figures: number;
  captions: number;
  tables: number;
  charts: number;
  /** Text blocks carrying at least one inline bold/italic/… run. */
  emphasisedBlocks: number;
  hasHeader: boolean;
  hasFooter: boolean;
  /** Fill/coverage shortfalls, in the words they should be reported in. */
  warnings: string[];
}

/**
 * Measure a document against the quality bar — the counterpart to `validateCanvasAgainstSpec`.
 *
 * Compliance answers "is this document ALLOWED"; this answers "is it FINISHED". They are
 * different questions: a 6-page volume under a 10-page cap is perfectly compliant and obviously
 * unfinished. Both are needed, and only one of them existed.
 *
 * `underfillAt` is the fraction below which a capped document is called out — 0.85 by default,
 * i.e. more than one page unused on a 10-page volume.
 */
export function measureDocument(doc: CanvasDocument, underfillAt = 0.85): DocumentMeasurement {
  const nodes = docNodes(doc);
  const pages = estimatePageCount(doc);
  const characters = countCharacters(nodes);
  const maxPages = doc.canvas?.max_pages ?? null;
  const maxCharacters = doc.canvas?.max_characters ?? null;

  const nodeTypes: Record<string, number> = {};
  let emphasisedBlocks = 0;
  for (const n of nodes) {
    nodeTypes[n.type] = (nodeTypes[n.type] ?? 0) + 1;
    if (n.type === 'text_block' && ((n.content as TextBlockContent)?.inline_formats?.length ?? 0) > 0) {
      emphasisedBlocks += 1;
    }
  }

  const pageFill = maxPages && maxPages > 0 ? pages / maxPages : null;
  const characterFill = maxCharacters && maxCharacters > 0 ? characters / maxCharacters : null;

  const warnings: string[] = [];
  if (pageFill != null && pageFill < underfillAt) {
    warnings.push(
      `Uses ${pages} of ${maxPages} allowed pages (${Math.round(pageFill * 100)}%). `
      + `An evaluator reads unused pages as an unfinished proposal — fill to ~${(maxPages ?? 0) - 0.1}.`,
    );
  }
  if (characterFill != null && characterFill < underfillAt) {
    warnings.push(
      `Uses ${characters} of ${maxCharacters} allowed characters (${Math.round(characterFill * 100)}%).`,
    );
  }
  const figures = (nodeTypes.image ?? 0) + (nodeTypes.chart ?? 0);
  if (figures === 0) warnings.push('No figures. A technical volume with no figure is a wall of text.');
  if ((nodeTypes.caption ?? 0) < figures) {
    warnings.push(`${figures} figure(s) but only ${nodeTypes.caption ?? 0} caption(s) — every figure needs one.`);
  }
  if (emphasisedBlocks === 0 && (nodeTypes.text_block ?? 0) > 3) {
    warnings.push('No inline emphasis anywhere — body copy is one undifferentiated face.');
  }
  if (!doc.canvas?.header) warnings.push('No running header.');
  if (!doc.canvas?.footer) warnings.push('No footer — page numbers are expected on a paginated volume.');

  return {
    pages,
    maxPages,
    pageFill,
    characters,
    maxCharacters,
    characterFill,
    nodeTypes,
    distinctNodeTypes: Object.keys(nodeTypes).length,
    figures,
    captions: nodeTypes.caption ?? 0,
    tables: nodeTypes.table ?? 0,
    charts: nodeTypes.chart ?? 0,
    emphasisedBlocks,
    hasHeader: Boolean(doc.canvas?.header),
    hasFooter: Boolean(doc.canvas?.footer),
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope fill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much room is left before a cap, measured with the same ruler the export gate uses.
 *
 * Reports rather than pads. Nothing here fabricates prose to reach a page count — the honest
 * remedies are more substance, a figure, or a table, and which one applies is a judgement the
 * caller (or a human) makes. What the system CAN do reliably is say precisely how much room is
 * left, which is the number nobody had.
 */
export function headroom(doc: CanvasDocument): {
  pagesFree: number | null;
  charactersFree: number | null;
  atCapacity: boolean;
} {
  const m = measureDocument(doc);
  const pagesFree = m.maxPages == null ? null : m.maxPages - m.pages;
  const charactersFree = m.maxCharacters == null ? null : m.maxCharacters - m.characters;
  const atCapacity =
    (m.pageFill != null && m.pageFill >= 0.9) || (m.characterFill != null && m.characterFill >= 0.9);
  return { pagesFree, charactersFree, atCapacity };
}

/**
 * Trim a character-capped document to just under its cap, cutting from the END of the last text
 * block and stopping at a sentence boundary where one is within reach.
 *
 * The abstract/project-summary family is measured in characters because the agency portal pastes
 * it into a fixed field and REFUSES over the cap — so being over is a submission blocker, not a
 * style note. Cutting mid-word would be worse than the overflow, hence the sentence search.
 */
export function trimToCharacterCap(nodes: CanvasNode[], cap: number): CanvasNode[] {
  const total = countCharacters(nodes);
  if (total <= cap) return nodes;

  let excess = total - cap;
  const out = [...nodes];
  for (let i = out.length - 1; i >= 0 && excess > 0; i -= 1) {
    const n = out[i];
    if (n.type !== 'text_block') continue;
    const c = n.content as TextBlockContent;
    const text = c?.text ?? '';
    if (!text) continue;

    const keep = Math.max(0, text.length - excess);
    if (keep === 0) {
      out.splice(i, 1);
      excess -= text.length;
      continue;
    }
    // Prefer the last sentence end at or before the cut, when it is not a drastic extra loss.
    const window = text.slice(0, keep);
    const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    const cut = stop > keep * 0.6 ? stop + 1 : keep;
    out[i] = {
      ...n,
      content: {
        ...c,
        text: text.slice(0, cut).trimEnd(),
        // Inline runs that no longer fit the shortened text would point past its end.
        inline_formats: (c.inline_formats ?? []).filter((r) => r.start + r.length <= cut),
      },
    };
    excess = countCharacters(out) - cap;
  }
  return out;
}

/**
 * Run the full deterministic furniture pass over a node list.
 *
 * Order matters: rules and the TOC change what the numbering pass walks, and emphasis must run
 * on the final text so its offsets stay valid.
 */
export function applyFurniture(
  nodes: CanvasNode[],
  opts: {
    rules?: boolean;
    toc?: boolean;
    bold?: string[];
    italic?: string[];
  } = {},
): CanvasNode[] {
  let out = nodes;
  if (opts.rules !== false) out = addSectionRules(out);
  if (opts.toc) {
    const toc = buildTocNode(out);
    if (toc) out = [toc, furnitureNode('page_break', null), ...out];
  }
  out = numberFigures(out);
  out = emphasise(out, { bold: opts.bold, italic: opts.italic });
  return out;
}

/** Plain-text length of one node — exported for callers reporting per-section budgets. */
export function nodeCharacters(node: CanvasNode): number {
  return getNodeText(node).replace(/\s+/g, ' ').trim().length;
}
