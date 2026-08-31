/**
 * The work breakdown structure — and its projection onto the `workplan` canvas.
 *
 * ── TABLES ARE THE SOURCE OF TRUTH; THE CANVAS IS AN EDITING SURFACE ─────────────────────────
 * The canvas system is genuinely attractive here — versioning, undo, autosave, `.xlsx` export for
 * free, and a WBS *is* a structured grid. It is still the wrong place to keep the plan, because
 * four things this capability must do are SQL operations and none of them can be done against a
 * JSONB blob without projecting it back into tables anyway: rollup, RLS, assignment, and comparing
 * a current set against an immutable baseline.
 *
 * So the rows are the plan and `toWorkplanCanvas` renders them. The canvas contributes the
 * INTERACTION model — the grid, cell editing, the overlay layer, ActOnSelection — which is the
 * valuable half.
 *
 * **The honest cost:** the plan does not get `canvas_versions` history for free. Baseline and audit
 * are explicit in tables instead, which is what `process_instance_transitions` already does for
 * workflow instances.
 *
 * ── ORDERING ─────────────────────────────────────────────────────────────────────────────────
 * `sort_index`, always. `'1.10'` sorts before `'1.2'` lexically, which is the bug migration 143
 * fixed for `proposal_sections.section_number`. The code is an identifier; the order is an integer.
 */
import { randomUUID } from 'crypto';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import type { Fail, Ok } from './project';

/**
 * ── THE WBS ELEMENT IS A MILESTONE (mig 228) ─────────────────────────────────────────────────
 * `project_wbs_nodes` was a parallel hierarchy beside `project_milestones`, describing the same
 * thing with its own dates, costs and CLIN. It is gone: a project is the portal, the WBS **is** the
 * milestone list, and each milestone carries tasks and deliverables.
 *
 * This module survives because the WORKPLAN GRID does — a canvas table over the plan — and it now
 * reads the one spine. `parent_id` is gone because milestones do not nest, and a caller that sends
 * one is REFUSED rather than quietly ignored.
 *
 * ── AND THE BASELINE COLUMNS ARE READ, NOT SYNTHESISED (mig 229) ─────────────────────────────
 * The first cut of this repointing aliased `baseline_date` into BOTH baseline-date columns and
 * `planned_cost` into the baseline cost, because the milestone had no `baseline_cost` yet. The grid
 * renders those columns greyed out and labelled "Baseline" — so that alias put the CURRENT plan
 * behind a label promising the frozen one, and made cost variance compute as zero forever by
 * subtracting a column from itself. Migration 229 gives the milestone a real frozen `baseline_cost`
 * and the shape below reads it. A grid may show an empty baseline; it may not show a fake one.
 */
export interface WbsNode {
  id: string;
  projectId: string;
  clinId: string | null;
  code: string | null;
  title: string;
  /** Frozen at baseline, refused thereafter by migration 216's trigger. */
  baselineDate: string | null;
  baselineCost: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedCost: string | null;
  actualCost: string;
  sortIndex: number;
}

export async function listWbs(tenantId: string, projectId: string): Promise<WbsNode[]> {
  try {
    return await sql<WbsNode[]>`
      SELECT id, project_id, clin_id, code, title,
             baseline_date, baseline_cost,
             starts_on AS planned_start, forecast_date AS planned_end,
             planned_cost, actual_cost, sort_index
        FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, code NULLS LAST`;
  } catch (err) {
    console.error('[projects/wbs] listWbs failed:', err);
    return [];
  }
}

export interface WbsInput {
  code: string;
  title: string;
  clinId?: string | null;
  parentId?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  plannedCost?: number | null;
  sortIndex?: number;
}

function asDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false };
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? { ok: false } : { ok: true, value: v };
}

export async function createWbsNode(
  actor: ProjectActor,
  projectId: string,
  input: WbsInput,
): Promise<Ok<WbsNode> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can edit the work breakdown', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const code = (input.code ?? '').trim();
  const title = (input.title ?? '').trim();
  if (!code || code.length > 40) {
    return { ok: false, status: 400, error: 'A WBS code of 1–40 characters is required', code: 'VALIDATION_ERROR' };
  }
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A task title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }

  const start = asDate(input.plannedStart);
  const end = asDate(input.plannedEnd);
  if (!start.ok || !end.ok) {
    return { ok: false, status: 400, error: 'Planned dates must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  if (start.value && end.value && end.value < start.value) {
    return { ok: false, status: 400, error: 'plannedEnd cannot precede plannedStart', code: 'VALIDATION_ERROR' };
  }
  const cost = input.plannedCost;
  if (cost !== null && cost !== undefined && (!Number.isFinite(cost) || cost < 0)) {
    return { ok: false, status: 400, error: 'plannedCost must be a non-negative number', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-BEFORE-WRITE, both of them scoped to this project. A parent or CLIN from a DIFFERENT
    // project would satisfy the FK — it is a real row — and quietly graft one contract's plan onto
    // another's. RLS would not catch it either, because both rows can belong to the same tenant.
    if (input.parentId) {
      // REFUSED, not ignored. Accepting an input and discarding it is how a caller comes to
      // believe in a hierarchy that does not exist — and then writes twelve nodes under a parent
      // nothing reads.
      return {
        ok: false, status: 400, code: 'VALIDATION_ERROR',
        error: 'WBS elements do not nest — a milestone IS the element. Use sortIndex to order them.',
      };
    }
    if (input.clinId) {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM project_clins
         WHERE id = ${input.clinId}::uuid AND project_id = ${projectId}::uuid LIMIT 1`;
      if (rows.length === 0) {
        return { ok: false, status: 400, error: 'clinId does not belong to this project', code: 'VALIDATION_ERROR' };
      }
    }

    // A WBS element IS a milestone (mig 228).
    const [row] = await sql<WbsNode[]>`
      INSERT INTO project_milestones
        (tenant_id, project_id, clin_id, code, title, starts_on, forecast_date,
         planned_cost, sort_index)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${input.clinId ?? null},
         ${code}, ${title}, ${start.value}::date, ${end.value}::date,
         ${cost ?? null}, ${input.sortIndex ?? 0})
      RETURNING id, project_id, clin_id, code, title,
                baseline_date, baseline_cost,
                starts_on AS planned_start, forecast_date AS planned_end,
                planned_cost, actual_cost, sort_index`;

    await emitEventSingle({
      namespace: 'project',
      type: 'wbs_node.created',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, nodeId: row.id },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/wbs] createWbsNode failed:', err);
    return { ok: false, status: 500, error: 'Failed to add the task', code: 'DB_ERROR' };
  }
}

/**
 * Project the WBS onto a `workplan` canvas.
 *
 * A read-only rendering: the canvas is regenerated from the rows on every load, so there is no
 * second copy to drift. Cells carry their row id in the cell metadata so an edit knows what it is
 * editing — that binding is what "cells bound to rows rather than to a blob" means in practice.
 *
 * BASELINE COLUMNS ARE RENDERED AND NOT EDITABLE. Showing them next to the current plan is the
 * whole value — variance is the number a PM actually reads — and the database refuses to move them
 * anyway (migration 216's trigger), so an editable-looking cell would be a lie the UI tells until
 * the save fails.
 */
export const WORKPLAN_COLUMNS = [
  'Code', 'Milestone', 'CLIN',
  'Baseline date', 'Baseline cost',
  'Planned start', 'Planned end', 'Planned cost', 'Actual cost',
] as const;

/** Columns the grid must not let a person type into. Index-aligned with WORKPLAN_COLUMNS. */
export const WORKPLAN_READONLY_COLUMNS = [3, 4];

export function toWorkplanCanvas(
  nodes: WbsNode[],
  clins: Array<{ id: string; clinNumber: string }>,
  projectName: string,
): CanvasDocument {
  const clinNumber = new Map(clins.map((c) => [c.id, c.clinNumber]));
  const money = (v: string | null) => (v === null || v === undefined ? '' : Number(v).toFixed(2));

  const table: CanvasNode = {
    id: randomUUID(),
    type: 'table',
    content: {
      headers: [...WORKPLAN_COLUMNS],
      rows: nodes.map((n) => [
        n.code ?? '',
        n.title,
        n.clinId ? (clinNumber.get(n.clinId) ?? '') : '',
        n.baselineDate ?? '',
        money(n.baselineCost),
        n.plannedStart ?? '',
        n.plannedEnd ?? '',
        money(n.plannedCost),
        money(n.actualCost),
      ]),
      is_spreadsheet: true,
    },
    style: {},
    provenance: { source: 'template' },
    history: [],
    library_eligible: false,
  } as CanvasNode;

  return {
    version: 1,
    title: `${projectName} — work plan`,
    canvas: { ...CANVAS_PRESETS.workplan },
    nodes: [table],
    // The row ids, positionally aligned with the table's rows. The canvas node model has no per-cell
    // metadata slot, so the binding lives here rather than being smuggled into cell text — where it
    // would be visible to a person and editable by accident.
    metadata: { workplan: { rowIds: nodes.map((n) => n.id), readonlyColumns: WORKPLAN_READONLY_COLUMNS } },
  } as unknown as CanvasDocument;
}
