/**
 * Visual page review — reading the document the way an evaluator does: by looking at it.
 *
 * WHY THIS EXISTS. Every other check in this product reads the MODEL. `validateCanvasAgainstSpec`
 * counts pages and font sizes off the canvas; `measureDocument` counts figures and captions;
 * `color_team_reviewer` reads extracted text. Not one of them sees the page. So a whole class of
 * defect passed every gate and was obvious to the first person who rendered a page:
 *
 *   · flow-diagram labels truncated mid-word ("production un…", "optics + firm…")
 *   · a stacked cost bar whose sub-10% bands drew as unlabelled slivers, one reading as a GAP
 *   · a caption borrowed from alt text, printing "Figure 1. Immobileyes Inc. — Volume 2 — …"
 *     under the masthead and renumbering every real figure
 *   · a footer printing the literal string "Page {page}" on every page
 *   · half a page of white space where a section ended
 *
 * None of those are model errors. They are rendering errors, and the only instrument that finds
 * them is a picture of the page.
 *
 * WHAT IT DOES. Renders the artifact to PDF through the product's own exporter — so what is
 * reviewed is byte-identical to what the customer downloads — captures every page as an image, and
 * asks the vision model to report what is wrong with each one. Decks and workbooks go the same
 * way: the PDF exporter renders a slide deck one slide per page and a workbook as its printed
 * sheet, so "each page or slide or sheet" is one code path, not three.
 *
 * WHERE IT RUNS. It is a REVIEWER, so it obeys the reviewer contract: advisory, never a writer.
 * It returns findings. Callers decide whether those become comments on a section, a blocking
 * gate, or a line in an ingest assessment. Wired into the color-team review path
 * (`lib/proposal-ai-review.ts`) and available to the ingest and packaging assessments.
 *
 * GATED, like every other AI capability here. No real `ANTHROPIC_API_KEY` ⇒ `engine: 'none'` and
 * an empty finding list, and the caller carries on. The CAPTURE half is not gated and is useful on
 * its own: `capturePages` gives any caller — a test, a person, a report — the same images.
 */
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { capturePdfPages, type CapturedPage } from '@/lib/pdf/page-capture';

export type VisualEngine = 'vision' | 'none';

export type VisualSeverity = 'blocker' | 'defect' | 'polish';

export interface VisualFinding {
  /** 1-based page (or slide, or sheet) the finding is on. */
  page: number;
  severity: VisualSeverity;
  /** What is wrong, in one sentence, naming where on the page it is. */
  finding: string;
}

export interface VisualReviewResult {
  engine: VisualEngine;
  /** Pages Chromium actually laid out — the TRUE count, not the estimate. */
  pagesReviewed: number;
  findings: VisualFinding[];
  /** Set when the review could not run. Never thrown — a review is advice, not a gate. */
  skippedReason?: string;
}

const KEY = process.env.ANTHROPIC_API_KEY;
const ENABLED = !!KEY && KEY !== 'sk-noop' && process.env.VISUAL_REVIEW !== 'off';
const MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-20250514';

/** Cap per review. Twenty page-images is already a large request; a BAA is not the subject here. */
const MAX_PAGES = 20;

/**
 * What the reviewer is asked to look for.
 *
 * Deliberately narrow, and deliberately about APPEARANCE. The model is not asked whether the
 * argument is persuasive — `color_team_reviewer` reads the text and does that far better from the
 * text than from a picture of it. It is asked the question only a picture can answer: does this
 * page look like a finished, professionally produced document, and what on it does not.
 */
const SYSTEM = [
  'You review rendered pages of a government proposal as an evaluator sees them. You are looking at',
  'a picture of a page, so report only what is VISIBLE. Do not comment on the persuasiveness or',
  'accuracy of the content — another reviewer reads the text.',
  '',
  'Report a finding for anything that would make an evaluator think the document was not finished:',
  '  · text cut off, truncated mid-word, overflowing its box, or overlapping other content',
  '  · a figure, chart or table that is unreadable, unlabelled, mislabelled, or clipped',
  '  · a caption that does not describe the thing above it, or numbering that is out of sequence',
  '  · placeholder text that was never replaced — brackets, "TBD", "Lorem", an unsubstituted',
  '    template token such as {page} or {{company}}',
  '  · large empty regions, a page that is mostly blank, or an obviously broken layout',
  '  · a running header or footer that is missing, wrong, or duplicated',
  '  · anything naming a DIFFERENT company or solicitation than the one this document is for',
  '',
  'Severity: "blocker" if a submission would be rejected or an evaluator could not read it;',
  '"defect" if it looks unfinished; "polish" if it is a refinement.',
  '',
  'Reply with a JSON array and nothing else: [{"page":1,"severity":"defect","finding":"…"}].',
  'An empty array is the right answer for a page with nothing wrong. Never invent a finding.',
].join('\n');

export interface VisualReviewInput {
  /** The document to look at. Rendered through the product's own PDF exporter. */
  doc: CanvasDocument;
  /** Template variables the exporter substitutes — pass what the download passes. */
  variables?: Record<string, string>;
  /** Named in the prompt so the reviewer can spot a foreign company or solicitation. */
  context?: { companyName?: string | null; solicitationNumber?: string | null; volumeName?: string | null };
  /**
   * The agency's page cap for this volume. When given, the review reports the RENDERED page count
   * against it as a blocker — the one measurement in this product that is ground truth rather than
   * an estimate.
   */
  pageCap?: number | null;
  maxPages?: number;
}

/**
 * Render an artifact and capture every page as an image.
 *
 * Exposed on its own because the pictures are worth having with or without a model to read them:
 * a person reviewing a build, a test asserting on what a page looks like, and the review below all
 * want the same bytes.
 */
export async function capturePages(input: VisualReviewInput): Promise<CapturedPage[]> {
  try {
    const { exportToPdf } = await import('@/lib/export/pdf-exporter');
    const pdf = await exportToPdf(input.doc, input.variables ?? {});
    return await capturePdfPages(pdf, { scale: 2, maxPages: Math.min(MAX_PAGES, input.maxPages ?? MAX_PAGES) });
  } catch (e) {
    console.error('[visual-review] capture failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Look at every page of an artifact and report what is visibly wrong with it.
 *
 * All pages go in ONE request. Page-by-page requests cannot see that a running header changed
 * halfway through, that figure numbering skips, or that one page is styled unlike its neighbours —
 * and those are exactly the defects a reader notices first.
 */
export async function reviewArtifactVisually(input: VisualReviewInput): Promise<VisualReviewResult> {
  const pages = await capturePages(input);
  if (pages.length === 0) {
    return { engine: 'none', pagesReviewed: 0, findings: [], skippedReason: 'no pages rendered' };
  }

  // The page count is FREE here and it is the only one in the product that is not an estimate.
  //
  // `estimatePageCount` drives the editor gauge, the compliance floor and the readiness panel, and
  // it is a character-width model: fast, interactive, and measured at ±1 page against Chromium on
  // real volumes (a Technical Volume it cleared at "10 of 10" laid out as 11; a Supporting
  // Documents it called 3 laid out as 2). An estimate is the right instrument for a gauge that
  // updates as you type. It is the wrong instrument for the sentence "this volume is within its
  // page limit", which is a claim about the file being submitted — and the file has already been
  // rendered by the time this runs.
  const overCap: VisualFinding[] = [];
  if (input.pageCap && input.pageCap > 0 && pages.length > input.pageCap) {
    overCap.push({
      page: input.pageCap + 1,
      severity: 'blocker',
      finding: `The volume renders as ${pages.length} pages against a ${input.pageCap}-page limit. `
        + `Measured on the rendered document, not estimated — pages ${input.pageCap + 1}–${pages.length} `
        + 'would be discarded or the submission refused.',
    });
  }

  if (!ENABLED) {
    return {
      engine: 'none',
      pagesReviewed: pages.length,
      findings: overCap,
      skippedReason: 'vision engine not configured (ANTHROPIC_API_KEY)',
    };
  }

  const ctx = input.context ?? {};
  const heading = [
    ctx.volumeName ? `Volume: ${ctx.volumeName}` : '',
    ctx.companyName ? `Offeror: ${ctx.companyName}` : '',
    ctx.solicitationNumber ? `Solicitation: ${ctx.solicitationNumber}` : '',
  ].filter(Boolean).join(' · ');

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: KEY });
    const content: Array<Record<string, unknown>> = [];
    if (heading) content.push({ type: 'text', text: heading });
    for (const p of pages) {
      content.push({ type: 'text', text: `Page ${p.pageNumber} of ${pages.length}:` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: p.png.toString('base64') },
      });
    }
    content.push({ type: 'text', text: 'Report every visible problem across these pages as the JSON array described.' });

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: content as never }],
    });
    const block = res.content.find((b) => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text : '';
    return { engine: 'vision', pagesReviewed: pages.length, findings: [...overCap, ...parseFindings(raw, pages.length)] };
  } catch (e) {
    console.error('[visual-review] review failed:', e instanceof Error ? e.message : e);
    return {
      engine: 'none',
      pagesReviewed: pages.length,
      findings: overCap,
      skippedReason: e instanceof Error ? e.message : 'review failed',
    };
  }
}

/**
 * Parse the model's reply into findings, keeping only well-formed ones.
 *
 * A reviewer that cannot be parsed reports nothing rather than something invented, and a page
 * number outside the document is dropped — a finding nobody can navigate to is worse than silence.
 */
function parseFindings(raw: string, pageCount: number): VisualFinding[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];

  const SEVERITIES: VisualSeverity[] = ['blocker', 'defect', 'polish'];
  const out: VisualFinding[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const page = Number(r.page);
    const finding = typeof r.finding === 'string' ? r.finding.trim() : '';
    const severity = SEVERITIES.includes(r.severity as VisualSeverity) ? (r.severity as VisualSeverity) : 'defect';
    if (!finding || !Number.isInteger(page) || page < 1 || page > pageCount) continue;
    out.push({ page, severity, finding: finding.slice(0, 400) });
  }
  // Blockers first — a reader should not have to sort a review.
  const rank: Record<VisualSeverity, number> = { blocker: 0, defect: 1, polish: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.page - b.page).slice(0, 60);
}
