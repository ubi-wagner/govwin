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
  /** Terms to emphasise in body copy — the offeror's own product/technology names. */
  emphasise?: string[];
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
    out.footer = { template: 'Page {page}', height: 28, font };
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
  const outSections: CanvasSection[] = sections.map((sec, si) => {
    const nodes = nodesOf(sec);
    if (!imagesOk || nodes.length === 0) return sec;

    const heading = (nodes.find((n) => n.type === 'heading')?.content as HeadingContent)?.text
      ?? sec.title ?? '';
    const intent = intentOf(heading);
    // One figure per intent per volume. Three gantts of the same schedule, one per section that
    // happens to mention a month, reads as a document nobody proofread.
    if (!intent || usedIntents.has(intent)) return sec;

    let figure: CanvasNode[] = [];
    if (intent === 'schedule') {
      // The section's own months first — that is the offeror's plan. Falling back to the
      // solicitation's curated deliverable dates second: those are the AGENCY's milestones, so
      // drawing them commits the offeror to nothing they were not already required to meet, and it
      // is the difference between a statement-of-work page with a schedule and one without.
      const own = parseSchedule(nodes);
      const { tasks, months } = own.tasks.length >= 2
        ? own
        : { tasks: facts.milestones ?? [], months: Math.max(0, ...(facts.milestones ?? []).map((m) => m.endMonth)) };
      figure = scheduleFigure(tasks, months, 'Phase I schedule and milestones');
    } else if (intent === 'approach') {
      figure = architectureFigure(parseStages(nodes), 'Technical approach');
    } else if (intent === 'results') {
      figure = improvementFigure(parseMetrics(nodes));
    } else if (intent === 'workshare' && facts.workShare) {
      const w = facts.workShare;
      figure = workShareFigure(w.primePct, w.floorPct, w.primeLabel, w.partnerLabel);
    } else if (intent === 'cost' && facts.cost?.length) {
      figure = costBuildupFigure(facts.cost);
    }
    if (figure.length === 0) return sec;
    usedIntents.add(intent);

    // The figure goes AFTER the section's opening prose, not before it — a reader wants the claim
    // and then its picture. Anchor: the end of the first text block following the heading, or the
    // top of the section when it opens with a list or a table.
    const firstProse = nodes.findIndex((n) => n.type === 'text_block' && getNodeText(n).length > 120);
    const at = firstProse >= 0 ? firstProse + 1 : Math.min(1, nodes.length);
    const merged = [...nodes.slice(0, at), ...figure, ...nodes.slice(at)];
    return { ...sec, groups: regroup(merged), layout: sec.layout ?? { mode: 'flow' } };
  });

  // The cover band opens the volume. It is page furniture, not a numbered figure (see
  // document-furniture::numberFigures, which learned that the hard way).
  if (imagesOk && facts.companyName && facts.volumeName) {
    const banner = coverBanner(
      facts.companyName,
      facts.solicitationNumber ?? '',
      facts.volumeName,
    );
    if (banner.length) {
      outSections.unshift({
        id: crypto.randomUUID(),
        layout: { mode: 'flow' },
        groups: regroup(banner),
      });
    }
  }

  // Furniture over the assembled whole: rules between top-level sections, correct figure/table
  // numbering, and inline emphasis on the offeror's own terms. Applied per section so a node never
  // migrates across a section boundary, with numbering carried by running the pass once over the
  // flattened list and redistributing by original section length.
  const flat = outSections.flatMap((s) => nodesOf(s));
  const finishedFlat = applyFurniture(flat, {
    rules: artifactType === 'narrative',
    toc: false, // a TOC costs a page of a page-capped volume; the caller opts in, not this
    bold: facts.emphasise ?? [],
  });

  // applyFurniture inserts (captions, rules) but never reorders or drops, so walking both lists in
  // step re-attaches every inserted node to the section its neighbour came from.
  const rebuilt: CanvasSection[] = [];
  let fi = 0;
  for (const sec of outSections) {
    const originals = nodesOf(sec);
    const take: CanvasNode[] = [];
    for (const orig of originals) {
      // Anything applyFurniture inserted BEFORE this original belongs to this section.
      while (fi < finishedFlat.length && finishedFlat[fi].id !== orig.id) take.push(finishedFlat[fi++]);
      if (fi < finishedFlat.length) take.push(finishedFlat[fi++]);
    }
    rebuilt.push({ ...sec, groups: regroup(take) });
  }
  // Trailing insertions (a caption on the document's very last figure) land on the last section.
  if (fi < finishedFlat.length && rebuilt.length) {
    const last = rebuilt[rebuilt.length - 1];
    rebuilt[rebuilt.length - 1] = { ...last, groups: regroup([...nodesOf(last), ...finishedFlat.slice(fi)]) };
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
