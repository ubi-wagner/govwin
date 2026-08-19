/**
 * Submission-readiness — the "can this proposal go out the door?" roll-up.
 *
 * The proposal overview shows plenty of RAW finish-line state (per-section lock, per-section
 * compliance ✓/✗, page counts, requirement coverage) but never fuses it into a single go / not-ready
 * verdict with a concrete, actionable blocker list. This does exactly that, reusing the signals the
 * platform already maintains — it invents no new compliance logic:
 *
 *   • Section state   — proposal_sections.status ('empty' = not drafted) + is_locked (accepted).
 *   • Requirement     — proposal_compliance_matrix auto-satisfies 1:1 on section lock, so it is a
 *                       SUMMARY stat here; only an ORPHAN unmet mandatory requirement (no owning
 *                       section) becomes its own blocker.
 *   • Format floor    — the SAME advisory check the export gate runs (validateCanvasAgainstSpec),
 *                       filtered to the per-section-meaningful rules (font floor, images-allowed).
 *                       Advisory → surfaced as WARNINGS, never as hard blockers (matches the platform:
 *                       export is gated on lock, not on the floor).
 *
 * Read-only + advisory: it computes and reports; it never locks, submits, or writes business tables.
 */
import { sql } from '@/lib/db';
import { coerceJsonb } from '@/lib/jsonb';
import { assembleArtifactCanvas } from '@/lib/export/artifact-export';
import { computeSttrSplit } from '@/lib/proposal/sttr-split';
import { parseStructuredCostInputs } from '@/lib/proposal/cost-volume-canvas';
import { computeBudget } from '@/lib/proposal/cost-model';
import { measureDocument } from '@/lib/proposal/document-furniture';
import {
  validateCanvasAgainstSpec,
  estimatePageCount,
  countDocCharacters,
  estimateSlideCount,
  overflowingSlides,
  docNodes,
  type CanvasDocument,
  type ComplianceSpec,
} from '@/lib/types/canvas-document';

export type BlockerCategory =
  | 'deadline'
  | 'empty_section'
  | 'unlocked_section'
  | 'orphan_requirement'
  | 'missing_document'
  | 'page_overflow'
  | 'work_split'
  | 'format_floor'
  /** Compliant but obviously unfinished — an unused page envelope, no figures, no emphasis. */
  | 'underfilled';

export interface ReadinessBlocker {
  category: BlockerCategory;
  /** 'blocker' fails readiness; 'warning' is advisory (readiness can still be GO). */
  severity: 'blocker' | 'warning';
  message: string;
  sectionId?: string;
  sectionTitle?: string;
}

export interface ReadinessReport {
  proposalId: string;
  ready: boolean;
  blockerCount: number;
  warningCount: number;
  summary: {
    sections: { total: number; locked: number; drafted_unlocked: number; empty: number };
    /** Submission deadline (opportunity close). daysRemaining is negative once past; estimated = the
     *  close date is a platform estimate, not yet confirmed from the solicitation. */
    deadline: { closeDate: string | null; daysRemaining: number | null; past: boolean; estimated: boolean };
    requirements: { mandatory: number; satisfied: number; unmet: number };
    /** Required supporting docs/forms (SF424, reps & certs, letters): provided vs still missing. */
    documents: { required: number; provided: number; missing: number };
    /** Mandated-format violations promoted to hard blockers (sub-minimum font, image where forbidden). */
    formatViolations: number;
    overBudget: number;
    /** Per size-limited volume: the REAL rendered size (pages for docs, slides for decks) vs its hard cap. */
    volumes: Array<{ name: string; pages: number; max: number; over: boolean; unit: 'pages' | 'slides' }>;
    /** STTR only: the cooperative work-split computed from the Cost Volume (min SB 40% / RI 30%). */
    workSplit?: { sbPct: number; riPct: number; ok: boolean; computable: boolean };
    /** Any cost volume: the total proposed price rolled up by the deterministic burden engine. */
    cost?: { totalPrice: number; computable: boolean };
  };
  blockers: ReadinessBlocker[];
}

interface SectionRow {
  id: string;
  title: string | null;
  content: string | null;
  status: string | null;
  isLocked: boolean;
  artifactId: string | null;
  pageAllocation: number | null;
  characterAllocation: number | null;
}
interface MatrixRow {
  requirementText: string | null;
  status: string;
  sectionId: string | null;
}
interface ArtifactRow {
  id: string;
  complianceSpec: unknown;
  artifactType: string | null;
  volumeName: string | null;
}

const CATEGORY_ORDER: Record<BlockerCategory, number> = {
  deadline: 0,
  empty_section: 1,
  unlocked_section: 2,
  orphan_requirement: 3,
  missing_document: 4,
  page_overflow: 5,
  work_split: 6,
  format_floor: 7,
  // Last: never let a polish warning sit above a real submission blocker in the list.
  underfilled: 8,
};

/**
 * Compute the readiness report for one proposal. `tenantId` scopes the read (the proposal must
 * belong to it, else null → 404 upstream). The caller still enforces auth/verifyTenantAccess.
 */
export async function computeSubmissionReadiness(
  proposalId: string,
  tenantId: string,
): Promise<ReadinessReport | null> {
  const [proposal] = await sql<{ id: string; programType: string | null; closeDate: string | Date | null; datesEstimated: boolean | null }[]>`
    SELECT p.id, o.program_type AS "programType", o.close_date AS "closeDate", o.dates_estimated AS "datesEstimated"
    FROM proposals p
    LEFT JOIN opportunities o ON o.id = p.opportunity_id
    WHERE p.id = ${proposalId}::uuid AND p.tenant_id = ${tenantId}::uuid LIMIT 1
  `;
  if (!proposal) return null;
  const isSttr = /sttr/i.test(proposal.programType ?? '');

  const blockers: ReadinessBlocker[] = [];

  // ── Submission deadline (opportunity close) ─────────────────────────────────
  // A solicitation that has already CLOSED cannot be submitted to — a hard blocker when the close
  // date is confirmed, a warning when it is a platform estimate (never hard-fail on a guessed date).
  const closeMs = proposal.closeDate ? new Date(proposal.closeDate).getTime() : null;
  const estimated = proposal.datesEstimated === true;
  const daysRemaining = closeMs != null ? Math.ceil((closeMs - Date.now()) / 86_400_000) : null;
  const past = closeMs != null && closeMs < Date.now();
  const deadline = { closeDate: closeMs != null ? new Date(closeMs).toISOString() : null, daysRemaining, past, estimated };
  if (past && closeMs != null) {
    const dateStr = new Date(closeMs).toISOString().slice(0, 10);
    blockers.push(estimated
      ? { category: 'deadline', severity: 'warning', message: `Estimated close (${dateStr}) has passed — confirm the solicitation's actual deadline before relying on this proposal.` }
      : { category: 'deadline', severity: 'blocker', message: `The solicitation closed on ${dateStr} — submissions are no longer accepted.` });
  }

  const sections = await sql<SectionRow[]>`
    SELECT id, title, content, status, is_locked AS "isLocked", artifact_id AS "artifactId",
           page_allocation AS "pageAllocation", character_allocation AS "characterAllocation"
    FROM proposal_sections
    WHERE proposal_id = ${proposalId}::uuid
    ORDER BY sort_index NULLS LAST, id
  `;
  const matrix = await sql<MatrixRow[]>`
    SELECT requirement_text AS "requirementText", status, section_id AS "sectionId"
    FROM proposal_compliance_matrix
    WHERE proposal_id = ${proposalId}::uuid AND is_mandatory = true
  `;
  const artifacts = await sql<ArtifactRow[]>`
    SELECT id, compliance_spec AS "complianceSpec",
           artifact_type AS "artifactType", volume_name AS "volumeName"
    FROM proposal_artifacts
    WHERE proposal_id = ${proposalId}::uuid
  `;
  // Mandatory supporting documents/forms (SF424, reps & certs, required letters). Seeded at provision
  // from the solicitation's required_documents; the tenant uploads or an admin waives each.
  const requiredDocs = await sql<{ requirementLabel: string | null; status: string; requirementSource: string | null }[]>`
    SELECT requirement_label AS "requirementLabel", status,
           -- How the product came to believe this document is required. 'provenance:default' means
           -- it was NOT read from this solicitation — it came from a program skeleton's default
           -- list. See the blocker/warning split below.
           requirement_source AS "requirementSource"
    FROM proposal_supporting_docs
    WHERE proposal_id = ${proposalId}::uuid AND is_required = true
  `;
  const specByArtifact = new Map<string, ComplianceSpec>();
  const metaByArtifact = new Map<string, { artifactType: string | null; volumeName: string | null }>();
  for (const a of artifacts) {
    const spec = coerceJsonb<ComplianceSpec | null>(a.complianceSpec, null);
    if (spec) specByArtifact.set(a.id, spec);
    metaByArtifact.set(a.id, { artifactType: a.artifactType, volumeName: a.volumeName });
  }
  // Sections collected per artifact (volume), in flow order, for the real rendered-page-count gate.
  // pageAllocation rides along so the volume loop can check whether the per-section allowances
  // even FIT the volume's own cap (assembleArtifactCanvas ignores it; only the sum tells you).
  const volSections = new Map<string, Array<{ title: string | null; content: string | null; pageAllocation: number | null }>>();

  // ── Section state ──────────────────────────────────────────────────────────
  let locked = 0, emptyN = 0, draftedUnlocked = 0, formatViolations = 0, overBudget = 0;
  for (const s of sections) {
    const isEmpty = (s.status ?? '') === 'empty';
    if (s.isLocked) {
      locked++;
    } else if (isEmpty) {
      emptyN++;
      blockers.push({
        category: 'empty_section',
        severity: 'blocker',
        message: `"${s.title ?? 'Untitled'}" is empty — nothing drafted yet.`,
        sectionId: s.id,
        sectionTitle: s.title ?? undefined,
      });
      continue; // an empty section is not also reported as "drafted but unlocked"
    } else {
      draftedUnlocked++;
      blockers.push({
        category: 'unlocked_section',
        severity: 'blocker',
        message: `"${s.title ?? 'Untitled'}" is drafted but not yet accepted & locked.`,
        sectionId: s.id,
        sectionTitle: s.title ?? undefined,
      });
    }

    // Content-based checks (parse the canvas once). Run for LOCKED sections too — a section can be
    // accepted yet still bust its page budget, which pure lock-state readiness would miss.
    const doc = coerceJsonb<CanvasDocument | null>(s.content, null);
    if (!doc) continue;
    const nodeCount = docNodes(doc).length;
    if (nodeCount === 0) continue;

    // Collect the drafted section into its volume for the REAL rendered-page-count gate (below).
    // The DSIP page limit is per-VOLUME, and it is HARD — an over-limit Technical Volume is rejected
    // outright — so we measure the assembled volume with the same layout engine the exporter uses
    // (paginate over assembleArtifactCanvas), not a per-section node estimate.
    if (s.artifactId) {
      const list = volSections.get(s.artifactId) ?? [];
      list.push({ title: s.title, content: s.content, pageAllocation: s.pageAllocation });
      volSections.set(s.artifactId, list);
    }

    // Mandated format floor — HARD blocker. A font below the RFP's stated minimum, or an image where
    // the volume forbids figures, is an administrative DQ ("proposals not conforming to the format
    // requirements will not be evaluated"), not a nicety. These two codes fire ONLY when the
    // solicitation actually set the rule (min_font_size / images_allowed=false) and are read off
    // explicit node properties (smallest node font; presence of an image node), so a violation is
    // real, not an estimate — hence a blocker, not an advisory. (Page/slide caps are gated
    // separately below; header/footer + other softer codes stay out of the per-section pass.)
    // ── Character cap — a HARD blocker, and checked before the artifact spec because it is a
    // property of the SECTION, not the volume. A character-capped narrative (an SBIR cover-sheet
    // abstract, an NSF project summary) is pasted into a fixed-size agency form field that
    // truncates at the cap, so going over does not cost a deduction — it silently deletes the end
    // of the argument between our export and their reviewer. Exact count, not an estimate, which
    // is what makes it a blocker rather than a warning.
    if (s.characterAllocation != null && s.characterAllocation > 0) {
      const chars = countDocCharacters(doc);
      if (chars > s.characterAllocation) {
        formatViolations++;
        blockers.push({
          category: 'format_floor',
          severity: 'blocker',
          message: `"${s.title ?? 'Section'}": ${chars.toLocaleString()} characters exceeds the `
            + `${s.characterAllocation.toLocaleString()}-character limit — the agency form truncates the overflow.`,
          sectionId: s.id,
          sectionTitle: s.title ?? undefined,
        });
      }
    }

    const spec = s.artifactId ? specByArtifact.get(s.artifactId) : undefined;
    if (!spec) continue;
    // The narrative body-font floor governs PROSE. A cost WORKBOOK (xlsx) or a webFORM is not
    // narrative body text — federal cost tables + form fine-print are conventionally < the prose
    // minimum yet legible, and the RFP's "text shall be ≥ N-pt" rule is a narrative/deck rule — so
    // skip font_too_small for those artifact types (the page-count gate below already scopes itself
    // the same way). The floor stays a HARD blocker on narrative + slide volumes, unchanged.
    const atype = s.artifactId ? metaByArtifact.get(s.artifactId)?.artifactType : null;
    const fontExempt = atype === 'cost' || atype === 'form';
    for (const v of validateCanvasAgainstSpec(doc, spec)) {
      if (v.code !== 'font_too_small' && v.code !== 'image_not_allowed') continue; // per-section only
      if (v.code === 'font_too_small' && fontExempt) continue;
      formatViolations++;
      blockers.push({
        category: 'format_floor',
        severity: 'blocker',
        message: `"${s.title ?? 'Section'}": ${v.message}`,
        sectionId: s.id,
        sectionTitle: s.title ?? undefined,
      });
    }
  }

  // ── Page-count gate (per PAGE-BASED volume) — the hard DSIP page limit ──────
  // Only NARRATIVE volumes are page-measured: cost volumes (spreadsheets), forms, and slide decks
  // carry a max_pages in their spec but a document page-flow count is meaningless for them (an XLSX
  // budget or a webform is not paginated). We measure with `estimatePageCount` — the SAME estimator
  // the export compliance floor uses (validateCanvasAgainstSpec) — so readiness and the export gate
  // can never contradict each other. Over the limit is a BLOCKER: an over-limit Technical Volume is
  // rejected outright on DSIP.
  const volumeInfo: ReadinessReport['summary']['volumes'] = [];
  for (const [artifactId, secs] of volSections) {
    const spec = specByArtifact.get(artifactId);
    const meta = metaByArtifact.get(artifactId);
    if (secs.length === 0) continue;
    let doc: CanvasDocument;
    try { doc = assembleArtifactCanvas(secs, meta?.artifactType ?? 'narrative', meta?.volumeName ?? 'Volume'); }
    catch { continue; } // a measurement failure must never itself block
    // A deck is measured in SLIDES, a prose volume in PAGES; cost spreadsheets / forms have no flow cap.
    const isSlide = doc.canvas?.format === 'slide_16_9' || doc.canvas?.format === 'slide_4_3';
    if (!isSlide && meta?.artifactType !== 'narrative') continue;
    const unit: 'pages' | 'slides' = isSlide ? 'slides' : 'pages';
    const max = isSlide ? spec?.max_slides : spec?.max_pages;
    if (max == null) continue; // needs a cap for this dimension
    const size = isSlide ? estimateSlideCount(doc) : estimatePageCount(doc);
    const name = meta?.volumeName ?? 'Volume';
    const noun = isSlide ? 'slide' : 'page';
    const over = size > max;
    volumeInfo.push({ name, pages: size, max, over, unit });
    if (over) {
      overBudget++;
      blockers.push({
        category: 'page_overflow',
        severity: 'blocker',
        message: `"${name}" is estimated at ${size} ${unit} against a ${max}-${noun} limit — trim ${size - max} ${noun}(s) before submission (same estimate the export compliance check uses).`,
      });
    }
    // ── Do the section allowances even FIT the volume? ────────────────────────────────────
    // Each `proposal_sections.page_allocation` comes from `volume_required_items.page_limit`,
    // authored per ITEM. Nothing checks them against the VOLUME's own cap, so a volume whose
    // announcement says "NTE 10 pages" can carry ten items each stamped 10 — 100 pages of
    // allowance against a 10-page envelope. Every per-section check then passes while the assembled
    // volume is 2.7× over, and the error is invisible until export. Observed exactly this on a live
    // T3CP build: 10 sections × 10 pages, volume cap 10.
    //
    // A blocker, not a warning: unlike an under-filled volume (a judgement call), an over-subscribed
    // page budget is arithmetic — it cannot be what the solicitation meant, and drafting to those
    // allowances guarantees an over-length submission.
    const allowanceSum = secs.reduce((t, x) => t + (x.pageAllocation ?? 0), 0);
    if (!isSlide && max != null && allowanceSum > max) {
      blockers.push({
        category: 'page_overflow',
        severity: 'blocker',
        message: `"${name}": its ${secs.length} sections are allocated ${allowanceSum} pages between them, `
          + `but the volume's limit is ${max}. The per-section allowances over-subscribe the volume — `
          + 'drafting to them guarantees an over-length submission. Re-allocate the pages across the sections.',
      });
    }

    // ── Compliant, but finished? ──────────────────────────────────────────────────────────
    // The check above answers "is this volume ALLOWED"; this answers "is it FINISHED". They are
    // different questions, and only the first one existed: a 6-page volume under a 10-page cap
    // passes every compliance gate and still reads to an evaluator as a half-made proposal.
    // Measured against a hand-built reference volume for the same solicitation, the generated one
    // used ~7 of 10 pages, half the character density, and ZERO figures. Warnings only — the
    // builder decides whether an under-filled volume is deliberate; the system's job is to make
    // sure they are never surprised by it at submission.
    if (!isSlide) {
      for (const w of measureDocument(doc, 0.85, meta?.artifactType ?? 'narrative').warnings) {
        blockers.push({ category: 'underfilled', severity: 'warning', message: `"${name}": ${w}` });
      }
    }
    if (isSlide) {
      const ov = overflowingSlides(doc);
      if (ov.length) blockers.push({
        category: 'page_overflow',
        severity: 'warning',
        message: `"${name}": ${ov.length} slide(s) overflow the frame (slide ${ov.map((i) => i + 1).join(', ')}) — content will be cut off.`,
      });
    }
  }

  // ── Deterministic cost roll-up (the universal burden-waterfall engine) ──────────────────────
  // The Cost Volume may be a 'cost' spreadsheet OR a budget 'form' — match either.
  const r1 = (n: number) => Math.round(n * 10) / 10;
  // Gather sections from ALL cost-ish artifacts (a proposal may carry a cost-narrative/justification
  // volume alongside the workbook volume; an unordered first-match could miss the real workbook). The
  // structured parser scans them for the 'Labor' sheet wherever it lives.
  const costArtifactIds = [...metaByArtifact]
    .filter(([, m]) => m.artifactType === 'cost' || /cost|budget/i.test(m.volumeName ?? ''))
    .map(([id]) => id);
  const costSecs = costArtifactIds.flatMap((id) => volSections.get(id) ?? []);
  // Preferred path: the cost volume is the STRUCTURED workbook (Rates/Labor/ODC/Subs sheets). Parse
  // its inputs and run the SAME deterministic engine the pipeline `cost_estimator` uses, so the total
  // price and the work-share reflect the tenant's actual edits — no free-text label guessing.
  const structured = parseStructuredCostInputs(costSecs);
  let cost: ReadinessReport['summary']['cost'];
  let workSplit: ReadinessReport['summary']['workSplit'];
  if (structured) {
    const b = computeBudget(structured.labor, structured.rates, { odcs: structured.odcs, subs: structured.subs });
    cost = { totalPrice: Math.round(b.grand.totalPrice), computable: b.grand.totalPrice > 0 };
    if (isSttr) {
      // Share-of-price basis (matches the shipped work-split semantics): SB = prime share = 1 − subs/price;
      // RI = research-institution subcontract share of price (from the explicit RI column, not a label guess).
      const sbPct = (1 - b.workshare.subcontractShareOfPrice) * 100;
      const riPct = b.workshare.researchInstitutionShareOfPrice * 100;
      const ok = sbPct >= 40 && riPct >= 30;
      workSplit = { sbPct: r1(sbPct), riPct: r1(riPct), ok, computable: true };
      if (!ok) {
        blockers.push({
          category: 'work_split',
          severity: 'warning',
          message: `STTR work-split (computed from the structured Cost Volume) reads small business ${r1(sbPct)}% / research institution ${r1(riPct)}% — verify against the statutory 40% / 30% floor before submission.`,
        });
      }
    }
  } else if (isSttr) {
    // Fallback: a free-text / uploaded cost table. Heuristic reader (performer labels, $ formats) — can
    // mis-read a realistic table, so it is ADVISORY and never a hard block.
    const split = computeSttrSplit(costSecs);
    const ok = split.found && split.sbPct >= 40 && split.riPct >= 30;
    workSplit = { sbPct: r1(split.sbPct), riPct: r1(split.riPct), ok, computable: split.found };
    if (!split.found) {
      blockers.push({
        category: 'work_split',
        severity: 'warning',
        message: 'STTR work-split not computable from the Cost Volume — verify the small business performs at least 40% and the single research institution at least 30% by cost.',
      });
    } else if (!ok) {
      blockers.push({
        category: 'work_split',
        severity: 'warning',
        message: `STTR work-split (computed from the Cost Volume) reads small business ${r1(split.sbPct)}% / research institution ${r1(split.riPct)}% — verify against the statutory 40% / 30% floor before submission.`,
      });
    }
  }

  // ── Requirement coverage (summary + orphan blockers) ───────────────────────
  const sectionIds = new Set(sections.map((s) => s.id));
  const satisfiedReq = matrix.filter((m) => m.status === 'satisfied' || m.status === 'not_applicable').length;
  for (const m of matrix) {
    const met = m.status === 'satisfied' || m.status === 'not_applicable';
    // Only surface an unmet requirement as its OWN blocker when no owning section represents it
    // (otherwise it is already covered by that section's empty/unlocked blocker — no double-count).
    if (!met && (!m.sectionId || !sectionIds.has(m.sectionId))) {
      blockers.push({
        category: 'orphan_requirement',
        severity: 'blocker',
        message: `Required item not covered by any section (${m.status}): ${(m.requirementText ?? '').slice(0, 120)}`,
      });
    }
  }

  // ── Required document/form coverage — the #1 avoidable administrative DQ ─────
  // A mandatory supporting doc (SF424, reps & certs, a required letter) still 'missing' is a HARD
  // blocker: a submission missing a required form is rejected without evaluation. 'waived' is an admin
  // decision the form is not needed; 'uploaded'/'reviewed'/'approved' all mean it is provided.
  let docsProvided = 0;
  for (const d of requiredDocs) {
    if (d.status !== 'missing') { docsProvided++; continue; }
    // A DEFAULTED requirement warns; a requirement READ from the solicitation blocks.
    //
    // "A value the product did not read from the solicitation must never look like one it did"
    // (docs/INGEST_PROVENANCE.md), and a hard submission blocker is the strongest way of looking
    // like one. The T3CP skeleton's default list carries "CMMC Reps & Certs", which that BAA does
    // not require as an attachment at all — CMMC is a representation made in DSIP, so there is no
    // document to upload. As a blocker it made a finished build unsubmittable for a file that does
    // not exist, and the only escape was an admin waiving a requirement nobody could verify.
    //
    // It stays on the checklist either way. What changes is whether the product stakes a hard
    // refusal on something it assumed.
    const defaulted = d.requirementSource === 'provenance:default';
    blockers.push({
      category: 'missing_document',
      severity: defaulted ? 'warning' : 'blocker',
      message: defaulted
        ? `Document not provided: ${d.requirementLabel ?? 'Unnamed document'}. This requirement `
          + 'came from the program default list, not from this solicitation — confirm whether it applies.'
        : `Required document not provided: ${d.requirementLabel ?? 'Unnamed document'}.`,
    });
  }

  blockers.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);
  const blockerCount = blockers.filter((b) => b.severity === 'blocker').length;
  const warningCount = blockers.filter((b) => b.severity === 'warning').length;

  return {
    proposalId,
    ready: blockerCount === 0,
    blockerCount,
    warningCount,
    summary: {
      sections: { total: sections.length, locked, drafted_unlocked: draftedUnlocked, empty: emptyN },
      deadline,
      requirements: { mandatory: matrix.length, satisfied: satisfiedReq, unmet: matrix.length - satisfiedReq },
      documents: { required: requiredDocs.length, provided: docsProvided, missing: requiredDocs.length - docsProvided },
      formatViolations,
      overBudget,
      volumes: volumeInfo,
      ...(workSplit ? { workSplit } : {}),
      ...(cost ? { cost } : {}),
    },
    blockers,
  };
}
