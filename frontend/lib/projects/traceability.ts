/**
 * Contract traceability — CLIN → milestone → deliverable, and every gap in between.
 *
 * ── WHY THIS IS NOT AN AGENT ─────────────────────────────────────────────────────────────────
 * The backlog filed this beside the agent work, and it does not belong there. Every question it
 * answers is a join: does this CLIN have any milestone under it, does this milestone produce
 * anything, does this deliverable name a contractual item. There is no judgement to make, and an
 * agent asked to make one could get it wrong in a document a customer reads.
 *
 * `project_manager` (A1) exists because reading a blocked task's reason beside a slipping forecast
 * and saying "these are one problem" is a judgement. This is the opposite: it is arithmetic over
 * foreign keys, and arithmetic belongs in SQL where it can be checked.
 *
 * There IS one advisory question here — "this untagged deliverable probably satisfies CLIN 0002" —
 * and that is a natural follow-on. It is deliberately not built yet: a suggestion is only useful
 * once the map below can say what is actually missing, and this is that map.
 *
 * ── WHAT A PROGRAM REVIEW ASKS ───────────────────────────────────────────────────────────────
 * Not "is the project healthy". It asks: *show me every line item and what satisfies it.* So the
 * report is organised by CLIN, and the gaps are named rather than counted — "CLIN 0002 has no
 * deliverable" is actionable; "3 gaps" is a number somebody has to go and investigate.
 *
 * ── AND A GAP IS NOT A FAILURE ───────────────────────────────────────────────────────────────
 * An early-stage project legitimately has CLINs with nothing under them yet. The report says what
 * is unlinked; it does not say it is wrong. Rendering an amber banner over a project three weeks
 * into a five-year contract is how a person learns to ignore the panel.
 */
import { sql } from '@/lib/db';

export type GapKind =
  | 'clin_without_milestone'
  | 'clin_without_deliverable'
  | 'milestone_without_clin'
  | 'milestone_without_deliverable'
  | 'deliverable_without_clin'
  | 'cdrl_without_instance';

export interface TraceGap {
  kind: GapKind;
  /** The row the gap is ABOUT — named, so it is actionable rather than a count. */
  subject: string;
  detail: string;
}

export interface ClinTrace {
  clinId: string;
  clinNumber: string;
  title: string;
  milestones: Array<{ id: string; code: string | null; title: string; status: string }>;
  /** Deliverables reaching this CLIN either directly or through their milestone. */
  deliverables: Array<{ id: string; title: string; direct: boolean; accepted: boolean; sent: boolean }>;
}

export interface Traceability {
  clins: ClinTrace[];
  /** Milestones under no CLIN — real work nothing on the contract accounts for. */
  unassignedMilestones: Array<{ id: string; code: string | null; title: string }>;
  gaps: TraceGap[];
}

const EMPTY: Traceability = { clins: [], unassignedMilestones: [], gaps: [] };

export async function traceability(tenantId: string, projectId: string): Promise<Traceability> {
  try {
    const [clins, milestones, deliverables, cdrls] = await Promise.all([
      sql<Array<{ id: string; clinNumber: string; title: string }>>`
        SELECT id, clin_number, title FROM project_clins
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
         ORDER BY sort_index, clin_number`,
      sql<Array<{ id: string; clinId: string | null; code: string | null; title: string; status: string }>>`
        SELECT id, clin_id, code, title, status FROM project_milestones
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
         ORDER BY sort_index`,
      // A deliverable reaches a CLIN two ways, and they are different claims (mig 228): its OWN
      // `clin_id` names the contractual item it satisfies; its milestone's names the line item the
      // work sat under. `direct` records which, because "tagged to CLIN 0002" and "produced under a
      // milestone that happens to be CLIN 0002" are not the same statement to an auditor.
      sql<Array<{
        id: string; title: string; ownClin: string | null; milestoneClin: string | null;
        milestoneId: string; accepted: boolean; sent: boolean;
      }>>`
        SELECT d.id, d.title, d.clin_id AS own_clin, m.clin_id AS milestone_clin,
               d.milestone_id, (d.accepted_at IS NOT NULL) AS accepted,
               (d.submitted_at IS NOT NULL) AS sent
          FROM project_deliverables d
          JOIN project_milestones m ON m.id = d.milestone_id
         WHERE m.project_id = ${projectId}::uuid AND d.tenant_id = ${tenantId}::uuid
         ORDER BY d.sort_index`,
      sql<Array<{ id: string; cdrlNumber: string; title: string; instances: number }>>`
        SELECT c.id, c.cdrl_number, c.title,
               (SELECT count(*)::int FROM project_deliverables d WHERE d.cdrl_item_id = c.id) AS instances
          FROM project_cdrl_items c
         WHERE c.project_id = ${projectId}::uuid AND c.tenant_id = ${tenantId}::uuid
         ORDER BY c.cdrl_number`,
    ]);

    // A plain row type, not `typeof milestones` — postgres.js's result type carries query metadata
    // (columns, count, command), so `[]` is not assignable to it and the map cannot be seeded.
    type MilestoneRow = { id: string; clinId: string | null; code: string | null; title: string; status: string };
    const msByClin = new Map<string, MilestoneRow[]>();
    for (const m of milestones) {
      if (!m.clinId) continue;
      const list = msByClin.get(m.clinId) ?? [];
      list.push(m);
      msByClin.set(m.clinId, list);
    }

    const delByClin = new Map<string, ClinTrace['deliverables']>();
    for (const d of deliverables) {
      const target = d.ownClin ?? d.milestoneClin;
      if (!target) continue;
      const list = delByClin.get(target) ?? [];
      list.push({
        id: d.id, title: d.title, direct: d.ownClin !== null,
        accepted: d.accepted, sent: d.sent,
      });
      delByClin.set(target, list);
    }

    const gaps: TraceGap[] = [];

    const clinTraces: ClinTrace[] = clins.map((c) => {
      const ms = msByClin.get(c.id) ?? [];
      const del = delByClin.get(c.id) ?? [];
      if (ms.length === 0) {
        gaps.push({
          kind: 'clin_without_milestone', subject: `CLIN ${c.clinNumber}`,
          detail: 'No milestone sits under this line item — nothing in the plan is doing its work.',
        });
      }
      if (del.length === 0) {
        gaps.push({
          kind: 'clin_without_deliverable', subject: `CLIN ${c.clinNumber}`,
          detail: 'No deliverable satisfies this line item, directly or through a milestone.',
        });
      }
      return {
        clinId: c.id, clinNumber: c.clinNumber, title: c.title,
        milestones: ms.map((m) => ({ id: m.id, code: m.code, title: m.title, status: m.status })),
        deliverables: del,
      };
    });

    const unassignedMilestones = milestones.filter((m) => !m.clinId)
      .map((m) => ({ id: m.id, code: m.code, title: m.title }));
    for (const m of unassignedMilestones) {
      gaps.push({
        kind: 'milestone_without_clin', subject: m.code ? `${m.code} ${m.title}` : m.title,
        detail: 'This work is not under any contract line item.',
      });
    }

    const producing = new Set(deliverables.map((d) => d.milestoneId));
    for (const m of milestones) {
      if (producing.has(m.id)) continue;
      gaps.push({
        kind: 'milestone_without_deliverable', subject: m.code ? `${m.code} ${m.title}` : m.title,
        detail: 'This phase produces nothing the customer receives.',
      });
    }

    for (const d of deliverables) {
      if (d.ownClin || d.milestoneClin) continue;
      gaps.push({
        kind: 'deliverable_without_clin', subject: d.title,
        detail: 'Neither this deliverable nor its milestone names a contract line item.',
      });
    }

    for (const c of cdrls) {
      if (c.instances > 0) continue;
      gaps.push({
        kind: 'cdrl_without_instance', subject: `CDRL ${c.cdrlNumber}`,
        detail: `"${c.title}" is required by the contract and no deliverable has been created for it.`,
      });
    }

    return { clins: clinTraces, unassignedMilestones, gaps };
  } catch (err) {
    console.error('[projects/traceability] failed:', err);
    // An EMPTY map, not a partial one. A traceability report missing half its rows would show
    // gaps that are not there, which is worse than showing none: somebody would go and "fix" them.
    return EMPTY;
  }
}
