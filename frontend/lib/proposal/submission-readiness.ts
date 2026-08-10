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
import {
  validateCanvasAgainstSpec,
  estimatePageCount,
  docNodes,
  type CanvasDocument,
  type ComplianceSpec,
} from '@/lib/types/canvas-document';

export type BlockerCategory =
  | 'empty_section'
  | 'unlocked_section'
  | 'orphan_requirement'
  | 'page_overflow'
  | 'work_split'
  | 'format_floor';

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
    requirements: { mandatory: number; satisfied: number; unmet: number };
    formatWarnings: number;
    overBudget: number;
    /** Per page-limited volume: the REAL rendered page count vs its hard cap. */
    volumes: Array<{ name: string; pages: number; max: number; over: boolean }>;
    /** STTR only: the cooperative work-split computed from the Cost Volume (min SB 40% / RI 30%). */
    workSplit?: { sbPct: number; riPct: number; ok: boolean; computable: boolean };
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
  empty_section: 0,
  unlocked_section: 1,
  orphan_requirement: 2,
  page_overflow: 3,
  work_split: 4,
  format_floor: 5,
};

/**
 * Compute the readiness report for one proposal. `tenantId` scopes the read (the proposal must
 * belong to it, else null → 404 upstream). The caller still enforces auth/verifyTenantAccess.
 */
export async function computeSubmissionReadiness(
  proposalId: string,
  tenantId: string,
): Promise<ReadinessReport | null> {
  const [proposal] = await sql<{ id: string; programType: string | null }[]>`
    SELECT p.id, o.program_type AS "programType"
    FROM proposals p
    LEFT JOIN opportunities o ON o.id = p.opportunity_id
    WHERE p.id = ${proposalId}::uuid AND p.tenant_id = ${tenantId}::uuid LIMIT 1
  `;
  if (!proposal) return null;
  const isSttr = /sttr/i.test(proposal.programType ?? '');

  const sections = await sql<SectionRow[]>`
    SELECT id, title, content, status, is_locked AS "isLocked", artifact_id AS "artifactId",
           page_allocation AS "pageAllocation"
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
  const specByArtifact = new Map<string, ComplianceSpec>();
  const metaByArtifact = new Map<string, { artifactType: string | null; volumeName: string | null }>();
  for (const a of artifacts) {
    const spec = coerceJsonb<ComplianceSpec | null>(a.complianceSpec, null);
    if (spec) specByArtifact.set(a.id, spec);
    metaByArtifact.set(a.id, { artifactType: a.artifactType, volumeName: a.volumeName });
  }
  // Sections collected per artifact (volume), in flow order, for the real rendered-page-count gate.
  const volSections = new Map<string, Array<{ title: string | null; content: string | null }>>();

  const blockers: ReadinessBlocker[] = [];

  // ── Section state ──────────────────────────────────────────────────────────
  let locked = 0, emptyN = 0, draftedUnlocked = 0, formatWarnings = 0, overBudget = 0;
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
      list.push({ title: s.title, content: s.content });
      volSections.set(s.artifactId, list);
    }

    // Format floor (advisory) — only the per-section-meaningful rules, from the section's artifact spec.
    const spec = s.artifactId ? specByArtifact.get(s.artifactId) : undefined;
    if (!spec) continue;
    for (const v of validateCanvasAgainstSpec(doc, spec)) {
      if (v.code !== 'font_too_small' && v.code !== 'image_not_allowed') continue; // per-section only
      formatWarnings++;
      blockers.push({
        category: 'format_floor',
        severity: 'warning',
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
    const max = spec?.max_pages;
    const meta = metaByArtifact.get(artifactId);
    if (max == null || secs.length === 0) continue; // needs a page cap
    if (meta?.artifactType !== 'narrative') continue; // page count is only meaningful for prose volumes
    let pages: number;
    try {
      const doc = assembleArtifactCanvas(secs, meta.artifactType, meta.volumeName ?? 'Volume');
      pages = estimatePageCount(doc);
    } catch { continue; } // a measurement failure must never itself block
    const over = pages > max;
    volumeInfo.push({ name: meta.volumeName ?? 'Volume', pages, max, over });
    if (over) {
      overBudget++;
      blockers.push({
        category: 'page_overflow',
        severity: 'blocker',
        message: `"${meta.volumeName ?? 'Volume'}" is estimated at ${pages} pages against a ${max}-page limit — trim ${pages - max} page(s) before submission (same estimate the export compliance check uses).`,
      });
    }
  }

  // ── STTR cooperative work-split (SB≥40% / RI≥30% by cost) — computed, not asserted ──────────
  let workSplit: ReadinessReport['summary']['workSplit'];
  if (isSttr) {
    // The Cost Volume may be a 'cost' spreadsheet OR a budget 'form' — match either.
    const costArtifactId = [...metaByArtifact].find(([, m]) => m.artifactType === 'cost' || /cost|budget/i.test(m.volumeName ?? ''))?.[0];
    const costSecs = costArtifactId ? volSections.get(costArtifactId) : undefined;
    const split = computeSttrSplit(costSecs ?? []);
    const ok = split.found && split.sbPct >= 40 && split.riPct >= 30;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    workSplit = { sbPct: r1(split.sbPct), riPct: r1(split.riPct), ok, computable: split.found };
    // ADVISORY only. Reading the split from a free-text cost table (performer labels, $ formats) is
    // heuristic and can mis-read a realistic table, so we SURFACE the computed split for the human to
    // verify and never HARD-block a possibly-compliant proposal on it — a hard gate would need a
    // structured cost model with an explicit performer/role column.
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
      requirements: { mandatory: matrix.length, satisfied: satisfiedReq, unmet: matrix.length - satisfiedReq },
      formatWarnings,
      overBudget,
      volumes: volumeInfo,
      ...(workSplit ? { workSplit } : {}),
    },
    blockers,
  };
}
