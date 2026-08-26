/**
 * Volume finishing — turn an assembled volume into a document somebody would want to read.
 *
 * WHY THIS EXISTS. `assembleArtifactCanvas` concatenates the drafted sections and stops. What comes
 * out is structurally correct and visually inert: headings, paragraphs, bullets, no figure, no
 * caption, no running header, no cover. Measured against the hand-built reference volume for the
 * same solicitation — 10 pages, 44 images across 5 of them — the generated Technical Volume had
 * zero. "No pictures" is not a cosmetic note; an evaluator skims a technical volume by figure and
 * reads the prose second, so a volume with no figures loses the part of the argument that lands
 * first.
 *
 * WHAT IT ADDS, and where each thing comes from:
 *
 *   cover banner       company + solicitation + volume, off the proposal record
 *   schedule gantt     tasks and months PARSED OUT OF THE SECTION'S OWN TEXT ("Months 1–4", "M1–M3")
 *   architecture flow  the offeror's own named stages, taken from their own bullet list
 *   improvement bars   a current-vs-target table already in the document
 *   work-share bar     the computed small-business split (the caller passes it)
 *   cost build-up      the computed cost lines (the caller passes them)
 *   running header     volume + solicitation, on any paginated artifact missing one
 *   footer             page numbers, same rule
 *   figure numbering   via document-furniture, so numbers and captions can never drift
 *
 * WHAT IT WILL NOT DO. It invents nothing. Every generator here returns [] the moment its data is
 * absent or degenerate: no parsed months ⇒ no gantt (an evenly-spread bar chart labelled "schedule"
 * is a lie an evaluator can check); fewer than two stages ⇒ no flow diagram; no current/target
 * table ⇒ no comparison. A volume whose sections say nothing measurable finishes with a cover and
 * its furniture, and the readiness warning says the figures are missing — which is the true state.
 *
 * WHERE IT RUNS. At assembly, on the way to preview and export, not at draft time. The volume is
 * the unit these figures belong to (a schedule spans the whole statement of work, not one item),
 * and running here means one implementation serves docx, pdf, pptx, xlsx and the on-screen document
 * view identically. Deterministic and side-effect-free: same document in, same document out.
 */
import {
  type CanvasDocument,
  type CanvasGroup,
  type CanvasNode,
  type CanvasRules,
  type CanvasSection,
  type HeadingContent,
  type ListContent,
  type TableContent,
  type TextBlockContent,
  coalesceGroups,
  estimatePageCount,
  getNodeText,
} from '@/lib/types/canvas-document';
import {
  architectureFigure,
  costBuildupFigure,
  coverBanner,
  improvementFigure,
  scheduleFigure,
  workShareFigure,
  type CostBand,
  type FlowStage,
  type Metric,
  type ScheduleTask,
} from '@/lib/proposal/figures';
import { applyFurniture, furnitureNode } from '@/lib/proposal/document-furniture';

export interface VolumeFacts {
  /** The offeror. Printed on the cover band. */
  companyName?: string | null;
  /** Solicitation / topic number, for the cover band and the running header. */
  solicitationNumber?: string | null;
  /** Volume name, e.g. "Technical Volume". */
  volumeName?: string | null;
  /** narrative | cost | form | matrix | other — decides which furniture applies. */
  artifactType?: string | null;
  /** Computed cost lines, if the caller has them (cost volumes). */
  cost?: CostBand[] | null;
  /** Computed small-business work share and its mandated floor, in percent. */
  workShare?: { primePct: number; floorPct: number; primeLabel?: string; partnerLabel?: string } | null;
  /**
   * The solicitation's OWN stated deliverables and when they are due, as curated
   * (`solicitation_compliance.custom_variables.phase_i_deliverables`, e.g.
   * "Kick-Off Briefing (Day 15); Final Report (Day 120)"). These are the agency's dates, not the
   * offeror's estimates, which is what makes a schedule figure drawable without inventing a plan.
   */
  milestones?: ScheduleTask[] | null;
  /**
   * The offeror's OWN pictures — approved image atoms from their library, harvested out of the
   * proposals they uploaded (`lib/pdf/figure-harvest.ts`).
   *
   * These outrank anything generated. A photograph of the company's optical bench says something a
   * drawn diagram cannot, it is evidence rather than illustration, and it is the customer's own
   * asset. A generated figure is what you fall back to when the library has nothing that fits.
   */
  libraryFigures?: LibraryFigure[] | null;
  /** Terms to emphasise in body copy — the offeror's own product/technology names. */
  emphasise?: string[];
  /**
   * Hard ceiling on how many LIBRARY figures may be admitted, on top of the page-fit rule.
   *
   * Exists so a caller that can measure the TRUTH — `fitFinishedVolume`, which renders the document
   * and counts its actual pages — can walk this down until the rendered volume is inside its cap.
   * The estimator is ±1 page and no amount of tuning makes a character-width model exact; the
   * renderer is exact, and this is the dial it turns.
   */
  maxLibraryFigures?: number;
}

/** One reusable picture from the tenant's library, with the text that describes it. */
export interface LibraryFigure {
  atomId: string;
  /** Storage key or data URI — whatever the image node carries; the exporters resolve either. */
  storageKey: string;
  /** OCR + vision text, used both to caption it and to decide which section it belongs in. */
  text: string;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section intent — which figure, if any, a section can carry
// ─────────────────────────────────────────────────────────────────────────────

type Intent = 'schedule' | 'approach' | 'results' | 'workshare' | 'cost' | null;

/**
 * What kind of section this is, from its heading.
 *
 * Deliberately matched on the AGENCY's vocabulary rather than the offeror's: "Statement of Work",
 * "Technical Objectives", "Anticipated Performance Improvements" are the phrases solicitations use
 * for these items, so the same rules work across DoD, NSF, DOE and state programs without a
 * per-agency table.
 */
function intentOf(title: string): Intent {
  const t = title.toLowerCase();
  if (/statement of work|work plan|schedule|milestone|task\b|period of performance/.test(t)) return 'schedule';
  if (/work.?share|small business concern|research institution|eligibilit/.test(t)) return 'workshare';
  if (/cost|budget|price/.test(t)) return 'cost';
  if (/approach|concept|prototype|architect|modification|methodolog|innovation/.test(t)) return 'approach';
  if (/improvement|anticipated|objective|result|performance|transition|commercial/.test(t)) return 'results';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivations — every one reads the document, none of them writes facts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule tasks parsed from a section's own words.
 *
 * Matches the two forms a statement of work actually uses — "Task 2: Bench characterisation
 * (Months 3–6)" and "M1–M4 Integration" — and nothing else. A task line with no month span is
 * skipped rather than guessed at: an invented span is a commitment the offeror never made, and it
 * is the kind of error a contracting officer notices.
 */
function parseSchedule(nodes: CanvasNode[]): { tasks: ScheduleTask[]; months: number } {
  const lines: string[] = [];
  for (const n of nodes) {
    if (n.type === 'bulleted_list' || n.type === 'numbered_list') {
      for (const it of ((n.content as ListContent)?.items ?? [])) {
        lines.push(typeof it === 'string' ? it : (it as { text?: string })?.text ?? '');
      }
    } else if (n.type === 'text_block') {
      // Sentence-split so one long paragraph of task prose yields one candidate per task.
      lines.push(...String((n.content as TextBlockContent)?.text ?? '').split(/(?<=[.;])\s+/));
    } else if (n.type === 'table') {
      for (const row of ((n.content as TableContent)?.rows ?? [])) {
        lines.push((row ?? []).map((c) => (typeof c === 'string' ? c : (c as { text?: string })?.text ?? '')).join(' '));
      }
    }
  }

  const SPAN = /\b(?:months?\s*(\d{1,2})\s*[–—\-to]+\s*(\d{1,2})|m(\d{1,2})\s*[–—-]\s*m?(\d{1,2}))\b/i;
  const POINT = /\bmonth\s*(\d{1,2})\b|\bm(\d{1,2})\b/i;

  const tasks: ScheduleTask[] = [];
  let horizon = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line.length < 8) continue;
    const span = line.match(SPAN);
    let start: number | null = null;
    let end: number | null = null;
    if (span) {
      start = Number(span[1] ?? span[3]);
      end = Number(span[2] ?? span[4]);
    } else {
      const pt = line.match(POINT);
      // A single month is a MILESTONE, not a bar. Give it a one-month bar ending on that month so
      // the diamond lands where the text says it does.
      if (pt) { end = Number(pt[1] ?? pt[2]); start = Math.max(0, end - 1); }
    }
    if (start == null || end == null || !(end > start) || end > 60) continue;

    // The task's NAME is the line with its month clause and any leading enumerator removed —
    // "Task 2:", "3.", "•". What is left is what the offeror called the work.
    const name = line
      .replace(SPAN, '').replace(POINT, '')
      .replace(/^\s*(?:task\s*\d+|phase\s*\d+|\d+)\s*[.:)-]?\s*/i, '')
      .replace(/[(),;:\s]+$/, '').replace(/^\s*[-–—•]\s*/, '')
      .trim();
    if (name.length < 4) continue;
    tasks.push({ name, startMonth: start, endMonth: end, milestone: !span });
    horizon = Math.max(horizon, end);
  }
  // Dedupe by name, keep first (earliest mention wins), cap at what the figure draws.
  const seen = new Set<string>();
  const unique = tasks.filter((t) => {
    const k = t.name.toLowerCase().slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
  return { tasks: unique, months: horizon };
}

/**
 * Flow stages from the offeror's own bullet list.
 *
 * A bulleted list in an approach section IS the pipeline in prose form, so drawing it is a
 * restatement rather than an addition. The stage name is the bullet's lead-in — the text before the
 * first colon or dash, which is where a proposal writer puts the label — and the remainder becomes
 * the second line. Lists whose items are full sentences with no lead-in are left alone; forcing a
 * sentence into a 66×20pt box produces the truncated mush this was rejected for once already.
 */
function parseStages(nodes: CanvasNode[]): FlowStage[] {
  for (const n of nodes) {
    if (n.type !== 'bulleted_list' && n.type !== 'numbered_list') continue;
    const items = ((n.content as ListContent)?.items ?? [])
      .map((it) => (typeof it === 'string' ? it : (it as { text?: string })?.text ?? ''))
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (items.length < 2) continue;

    const stages: FlowStage[] = [];
    for (const item of items.slice(0, 5)) {
      const m = item.match(/^(.{3,44}?)\s*[—–:-]\s+(.{4,})$/);
      if (!m) continue;                     // no lead-in ⇒ not a stage list
      const name = m[1].replace(/\*+/g, '').trim();
      if (/[.?!]$/.test(name)) continue;    // a whole sentence, not a label
      stages.push({ name, detail: m[2].split(/[.;]/)[0].trim().slice(0, 52) });
    }
    if (stages.length >= 2) return stages;
  }
  return [];
}

/**
 * Current-vs-target metrics from a table the document already contains.
 *
 * Requires a header row naming both sides (current/baseline/today vs target/proposed/goal/phase) and
 * numeric cells. Anything looser produced bars off unrelated columns, which is worse than no figure
 * because it looks authoritative.
 */
function parseMetrics(nodes: CanvasNode[]): Metric[] {
  const cell = (c: unknown) => (typeof c === 'string' ? c : (c as { text?: string })?.text ?? '');
  const num = (s: string) => {
    const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };
  for (const n of nodes) {
    if (n.type !== 'table') continue;
    const c = n.content as TableContent;
    const headers = (c?.headers ?? []).map((h) => cell(h).toLowerCase());
    const ci = headers.findIndex((h) => /current|baseline|today|state of the art|sota/.test(h));
    const pi = headers.findIndex((h) => /target|proposed|goal|phase\s*i|objective/.test(h));
    if (ci < 0 || pi < 0 || ci === pi) continue;

    const out: Metric[] = [];
    for (const row of (c?.rows ?? [])) {
      const name = cell(row?.[0]).replace(/\s+/g, ' ').trim();
      const cur = num(cell(row?.[ci]));
      const prop = num(cell(row?.[pi]));
      if (!name || !Number.isFinite(cur) || !Number.isFinite(prop)) continue;
      const unit = (cell(row?.[ci]).match(/[%a-zA-Z]+\s*$/)?.[0] ?? '').trim().slice(0, 6);
      out.push({ name, current: cur, proposed: prop, unit: unit || undefined });
    }
    if (out.length) return out.slice(0, 4);
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Page furniture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Give a paginated volume the running header and footer it is expected to carry.
 *
 * Only fills in what is MISSING — a mold that declares its own header keeps it. `{page}` is the
 * exporters' own token; the header carries the identifiers that make a loose printed page traceable
 * back to the submission, which is what the convention exists for.
 */
function withPageFurniture(canvas: CanvasRules, facts: VolumeFacts): CanvasRules {
  const font = { family: canvas.font_default?.family ?? 'Times New Roman', size: 9, color: '#475569' };
  const ident = [facts.companyName, facts.solicitationNumber].filter(Boolean).join('  ·  ');
  const out: CanvasRules = { ...canvas };
  if (!out.header && ident) {
    out.header = { template: `${ident}${facts.volumeName ? `  ·  ${facts.volumeName}` : ''}`, height: 28, font };
  }
  if (!out.footer) {
    // `{n}` / `{N}` are the exporters' OWN tokens — the PDF exporter maps them onto Chromium's
    // live pageNumber/totalPages spans (lib/export/pdf-exporter.ts). Writing `{page}` printed the
    // literal string "Page {page}" across the foot of every page of the Supporting Documents
    // volume, which is the sort of thing that only ever shows up by looking at the rendered page.
    out.footer = { template: 'Page {n} of {N}', height: 28, font };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The finisher
// ─────────────────────────────────────────────────────────────────────────────

const nodesOf = (s: CanvasSection): CanvasNode[] => s.groups.flatMap((g) => g.nodes);
const regroup = (nodes: CanvasNode[]): CanvasGroup[] => coalesceGroups(nodes);

/** True when this artifact type gets figures and page furniture at all. */
function isPaginatedProse(artifactType: string | null | undefined, canvas: CanvasRules): boolean {
  if (canvas.format === 'spreadsheet') return false;
  return artifactType !== 'matrix';
}

/**
 * The offeror's own picture for this section, if the library has one that belongs here.
 *
 * Matched on WORDS, not on tags. A harvested figure carries the OCR of whatever text is inside it
 * plus a vision caption of what it depicts, and that text is the only honest evidence of what the
 * picture is about — the tags on it describe the document it came out of, which is the same for
 * every figure in that document and therefore separates nothing.
 *
 * The bar is deliberately high. A picture placed in a section it has nothing to do with is worse
 * than no picture: it reads as padding, and an evaluator who spots one stops trusting the rest.
 * Two shared content words is the floor, and a figure whose best section is a tie goes to the
 * first — deterministic, so the same volume assembles the same way twice.
 */
function pickLibraryFigure(
  heading: string,
  nodes: CanvasNode[],
  figures: LibraryFigure[],
  used: Set<string>,
): CanvasNode[] {
  if (figures.length === 0) return [];
  // Match against the section's HEADING AND ITS PROSE. A heading is four or five words and a
  // picture's OCR is a scattering of fragments; requiring them to overlap on the heading alone
  // placed none of six real figures. What the section is about is in its paragraphs.
  const want = contentWords(`${heading} ${nodes.map(getNodeText).join(' ').slice(0, 4000)}`);
  if (want.size === 0) return [];

  let best: LibraryFigure | null = null;
  let bestScore = 0;
  for (const f of figures) {
    if (used.has(f.atomId)) continue;
    const have = contentWords(`${f.caption ?? ''} ${f.text}`);
    let score = 0;
    for (const w of want) if (have.has(w)) score += 1;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  // Three shared content words, now that both sides carry real text. Two was noise at this width;
  // a picture placed in a section it has nothing to do with reads as padding, and an evaluator who
  // spots one stops trusting the rest.
  if (!best || bestScore < 3) return [];
  used.add(best.atomId);

  // The caption is the atom's own DESCRIPTION — never its filename.
  //
  // `alt_text` on a harvested figure is whatever the enricher wrote; when vision captioning is off
  // it falls back to the atom title, which is the source document's name. That printed
  // "Figure 1. Immobileyes_DON26BX03-NP002_Technical_Volume_PREVIEW.pdf — page 1" under a
  // photograph, which is provenance leaking onto a submitted page — the same defect as the alt-text
  // captions document-furniture already learned not to borrow. A filename is rejected here and the
  // OCR's own first line stands instead; failing that, an honest generic that tells the author this
  // is reused material to replace.
  const caption = firstNonFilename([best.caption, firstSentence(best.text)])
    || 'Figure carried forward from a prior submission — replace or re-caption.';

  return [
    furnitureNode('image', {
      storage_key: best.storageKey,
      alt_text: caption.slice(0, 220),
      width: best.width ?? 468,
      height: best.height ?? 300,
    }, { alignment: 'center', space_before: 8, space_after: 4 }),
    furnitureNode('caption', { prefix: 'Figure', number: 1, text: caption.slice(0, 220) }),
  ];
}

/**
 * The first candidate that is not a filename or a provenance line.
 *
 * A caption is what the picture SHOWS. "…_PREVIEW.pdf — page 1", "capture-8dc7bb71…png" and
 * "Screen capture from X · 2026-08-19T…" are all records of where the bytes came from, and none of
 * them belongs under a figure in a document going to an evaluator.
 */
function firstNonFilename(candidates: Array<string | null | undefined>): string {
  for (const raw of candidates) {
    const t = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < 8) continue;
    if (/\.(pdf|docx?|pptx?|xlsx?|png|jpe?g|gif|webp)\b/i.test(t)) continue;   // a file name
    if (/^(screen capture|figure harvested|capture-)/i.test(t)) continue;      // a provenance line
    if (/\d{4}-\d{2}-\d{2}T\d{2}:/.test(t)) continue;                          // a timestamp
    return t.slice(0, 220);
  }
  return '';
}

/** Content words of a string: lowercased, de-duplicated, without the vocabulary every proposal shares. */
function contentWords(s: string): Set<string> {
  const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'will',
    'proposal', 'section', 'volume', 'phase', 'sbir', 'sttr', 'government', 'offeror', 'figure',
    'page', 'technical', 'approach', 'required', 'requirements']);
  return new Set(
    (s.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w)),
  );
}

/** First sentence of a blob of OCR/caption text, trimmed to caption length. */
function firstSentence(s: string): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const stop = t.search(/[.!?](\s|$)/);
  return (stop > 12 ? t.slice(0, stop + 1) : t).slice(0, 200);
}

/**
 * The generated figure a section's own content supports — the fallback when the library has
 * nothing that belongs here. Every generator returns [] when its data is absent.
 */
function generatedFigure(intent: Intent, nodes: CanvasNode[], facts: VolumeFacts): CanvasNode[] {
  if (intent === 'schedule') {
    // The section's own months first — that is the offeror's plan. Falling back to the
    // solicitation's curated deliverable dates second: those are the AGENCY's milestones, so
    // drawing them commits the offeror to nothing they were not already required to meet.
    const own = parseSchedule(nodes);
    const { tasks, months } = own.tasks.length >= 2
      ? own
      : { tasks: facts.milestones ?? [], months: Math.max(0, ...(facts.milestones ?? []).map((m) => m.endMonth)) };
    return scheduleFigure(tasks, months, 'Phase I schedule and milestones');
  }
  if (intent === 'approach') return architectureFigure(parseStages(nodes), 'Technical approach');
  if (intent === 'results') return improvementFigure(parseMetrics(nodes));
  if (intent === 'workshare' && facts.workShare) {
    const w = facts.workShare;
    return workShareFigure(w.primePct, w.floorPct, w.primeLabel, w.partnerLabel);
  }
  if (intent === 'cost' && facts.cost?.length) return costBuildupFigure(facts.cost);
  return [];
}

/**
 * Finish an assembled volume: figures where the content supports one, then furniture over the whole.
 *
 * Returns a NEW document; the input is not mutated, so a caller can measure before and after.
 */
export function finishVolumeCanvas(doc: CanvasDocument, facts: VolumeFacts = {}): CanvasDocument {
  const artifactType = facts.artifactType ?? 'narrative';
  const sections = doc.sections ?? [];
  if (!sections.length) return doc;

  const canvas = doc.canvas;
  const paginated = isPaginatedProse(artifactType, canvas);
  // A volume that forbids images gets none — the compliance floor's `images_allowed` is the
  // agency's rule and outranks anything this module thinks would look better.
  const imagesOk = paginated && canvas.images_allowed !== false;

  const usedIntents = new Set<Intent>();
  const usedFigures = new Set<string>();
  const placed: string[][] = [];
  const outSections: CanvasSection[] = sections.map((sec, si) => {
    const nodes = nodesOf(sec);
    if (!imagesOk || nodes.length === 0) return sec;

    const heading = (nodes.find((n) => n.type === 'heading')?.content as HeadingContent)?.text
      ?? sec.title ?? '';
    // A section that already carries a picture keeps it — this finishes a volume, it does not
    // redecorate one.
    if (nodes.some((n) => n.type === 'image' || n.type === 'chart')) return sec;

    // The offeror's OWN picture first, when the library holds one that belongs in this section.
    // Considered for EVERY section: a photograph of the company's optical bench is evidence, and
    // which section it belongs in is decided by what the picture is OF, not by whether the heading
    // happens to match one of the generated-figure intents. Gating it on intent was measured to
    // place none of six real harvested figures.
    let figure = pickLibraryFigure(heading, nodes, facts.libraryFigures ?? [], usedFigures);
    const fromLibrary = figure.length > 0;

    // A generated figure only where the library had nothing, and only where the section's own
    // content supports one — one per intent per volume, because three gantts of the same schedule
    // reads as a document nobody proofread.
    const intent = intentOf(heading);
    if (figure.length === 0) {
      if (!intent || usedIntents.has(intent)) return sec;
      figure = generatedFigure(intent, nodes, facts);
      if (figure.length === 0) return sec;
      usedIntents.add(intent);
    }

    // The figure goes AFTER the section's opening prose, not before it — a reader wants the claim
    // and then its picture. Anchor: the end of the first substantial text block following the
    // heading, or the top of the section when it opens with a list or a table.
    const firstProse = nodes.findIndex((n) => n.type === 'text_block' && getNodeText(n).length > 120);
    const at = firstProse >= 0 ? firstProse + 1 : Math.min(1, nodes.length);
    const merged = [...nodes.slice(0, at), ...figure, ...nodes.slice(at)];
    // Remember what was added, in placement order, so it can be taken back out if the volume
    // overruns its cap (see the fit pass below). Only LIBRARY figures are droppable: a generated
    // figure is derived from the section's own content and is part of what the section says.
    if (fromLibrary) placed.push(figure.map((n) => n.id));
    return { ...sec, groups: regroup(merged), layout: sec.layout ?? { mode: 'flow' } };
  });

  // The cover band opens the volume. It is page furniture, not a numbered figure (see
  // document-furniture::numberFigures, which learned that the hard way). Built BEFORE the fit pass
  // because it costs a third of a page and the fit pass has to count it — measuring without it
  // reported ten pages and shipped eleven.
  const bannerSection: CanvasSection | null = (() => {
    if (!imagesOk || !facts.companyName || !facts.volumeName) return null;
    const banner = coverBanner(facts.companyName, facts.solicitationNumber ?? '', facts.volumeName);
    return banner.length
      ? { id: crypto.randomUUID(), layout: { mode: 'flow' as const }, groups: regroup(banner) }
      : null;
  })();
  const withBanner = (secs: CanvasSection[]) => (bannerSection ? [bannerSection, ...secs] : secs);

  // ── ASSEMBLE, THEN FIT THE ENVELOPE ─────────────────────────────────────────────────────────
  // Assembly is a function of "which figures to leave out", so the fit pass can measure exactly
  // what ships — cover band, section rules, numbered captions and all. Measuring the half-built
  // document instead reported ten pages and shipped eleven, twice: furniture is not free, and a
  // ruler that reads a different document from the one that gets exported is not a ruler.
  const assemble = (drop: Set<string>): CanvasSection[] => {
    const secs = withBanner(stripNodes(outSections, drop));

    // Rules between top-level sections, correct figure/table numbering, and inline emphasis on the
    // offeror's own terms. Applied over the flattened list so numbering is continuous, then
    // redistributed — applyFurniture inserts but never reorders or drops, so walking both lists in
    // step re-attaches every inserted node to the section its neighbour came from.
    const finishedFlat = applyFurniture(secs.flatMap(nodesOf), {
      rules: artifactType === 'narrative',
      toc: false, // a TOC costs a page of a page-capped volume; the caller opts in, not this
      bold: facts.emphasise ?? [],
    });

    const out: CanvasSection[] = [];
    let fi = 0;
    for (const sec of secs) {
      const take: CanvasNode[] = [];
      for (const orig of nodesOf(sec)) {
        while (fi < finishedFlat.length && finishedFlat[fi].id !== orig.id) take.push(finishedFlat[fi++]);
        if (fi < finishedFlat.length) take.push(finishedFlat[fi++]);
      }
      out.push({ ...sec, groups: regroup(take) });
    }
    // Trailing insertions (a caption on the document's very last figure) land on the last section.
    if (fi < finishedFlat.length && out.length) {
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, groups: regroup([...nodesOf(last), ...finishedFlat.slice(fi)]) };
    }
    return out;
  };

  // Fit by ADDING, not by removing.
  //
  // The first version placed every candidate and then dropped from the end until the volume fit.
  // Measured, that converged to zero: six harvested figures cost four pages against one page of
  // headroom, and every intermediate step was still over, so it kept dropping and the volume
  // shipped with no pictures at all. Removing one at a time cannot land on "as many as fit" when
  // each step is coarse relative to the headroom.
  //
  // Adding does. Start from the volume with no library figures — its generated figures stay, they
  // are derived from the section's own content — then admit candidates in READING ORDER, keeping
  // each only while the finished document is still inside its cap. The result is the largest
  // prefix that fits, and it keeps the figures nearest the front, where a volume wants them.
  const allLibraryIds = new Set(placed.flat());
  let rebuilt = assemble(allLibraryIds);
  if (paginated && canvas.max_pages && canvas.max_pages > 0) {
    const admitted = new Set<string>();
    let admittedCount = 0;
    const ceiling = facts.maxLibraryFigures ?? Number.POSITIVE_INFINITY;
    for (const ids of placed) {
      if (admittedCount >= ceiling) break;
      const trial = new Set(allLibraryIds);
      ids.forEach((id) => trial.delete(id));          // admit this figure…
      admitted.forEach((id) => trial.delete(id));     // …on top of the ones already admitted
      const candidate = assemble(trial);
      const probe: CanvasDocument = { ...doc, canvas, sections: candidate, nodes: [] };
      // Fits, by the same ruler the compliance floor and the editor gauge use. That ruler is only
      // trustworthy here because it was corrected to treat a figure as ATOMIC (canvas-document
      // ::paginate) — before that it spent the white space the renderer leaves when a picture will
      // not fit on the rest of a page, and cleared volumes at "10 of 10" that laid out as 11.
      // The visual reviewer still reports the TRUE rendered count, which is the number any
      // compliance CLAIM should rest on.
      if (estimatePageCount(probe) > canvas.max_pages) continue;   // no room — try the next
      ids.forEach((id) => admitted.add(id));
      admittedCount += 1;
      rebuilt = candidate;
    }
  } else {
    rebuilt = assemble(new Set());   // uncapped: every figure the library matched
  }

  return {
    ...doc,
    canvas: paginated ? withPageFurniture(canvas, facts) : canvas,
    sections: rebuilt,
    nodes: [],
  };
}

/** Re-export so callers building a facts object do not need a second import. */
export { furnitureNode };

/** A copy of the section list with the given node ids removed. */
function stripNodes(sections: CanvasSection[], drop: Set<string>): CanvasSection[] {
  if (drop.size === 0) return sections;
  return sections.map((s) => ({
    ...s,
    groups: coalesceGroups(s.groups.flatMap((g) => g.nodes).filter((n) => !drop.has(n.id))),
  }));
}
