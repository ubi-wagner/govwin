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
import {
  validateCanvasAgainstSpec,
  docNodes,
  type CanvasDocument,
  type ComplianceSpec,
} from '@/lib/types/canvas-document';

export type BlockerCategory =
  | 'empty_section'
  | 'unlocked_section'
  | 'orphan_requirement'
  | 'page_budget'
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
}

const CATEGORY_ORDER: Record<BlockerCategory, number> = {
  empty_section: 0,
  unlocked_section: 1,
  orphan_requirement: 2,
  page_budget: 3,
  format_floor: 4,
};

/**
 * Compute the readiness report for one proposal. `tenantId` scopes the read (the proposal must
 * belong to it, else null → 404 upstream). The caller still enforces auth/verifyTenantAccess.
 */
export async function computeSubmissionReadiness(
  proposalId: string,
  tenantId: string,
): Promise<ReadinessReport | null> {
  const [proposal] = await sql<{ id: string }[]>`
    SELECT id FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `;
  if (!proposal) return null;

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
    SELECT id, compliance_spec AS "complianceSpec"
    FROM proposal_artifacts
    WHERE proposal_id = ${proposalId}::uuid
  `;
  const specByArtifact = new Map<string, ComplianceSpec>();
  for (const a of artifacts) {
    const spec = coerceJsonb<ComplianceSpec | null>(a.complianceSpec, null);
    if (spec) specByArtifact.set(a.id, spec);
  }

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

    // Page budget (advisory estimate — mirrors the overview's per-section gauge, ~3 nodes/page).
    if ((s.pageAllocation ?? 0) > 0) {
      const pageEst = Math.ceil(nodeCount / 3);
      if (pageEst > (s.pageAllocation as number)) {
        overBudget++;
        blockers.push({
          category: 'page_budget',
          severity: 'warning',
          message: `"${s.title ?? 'Section'}" runs ~${pageEst}pp against a ${s.pageAllocation}pp budget (estimate — confirm at export).`,
          sectionId: s.id,
          sectionTitle: s.title ?? undefined,
        });
      }
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
    },
    blockers,
  };
}
