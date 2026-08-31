/**
 * The risk and issue register.
 *
 * ── ONE TABLE, BECAUSE THE TRANSITION IS THE POINT ───────────────────────────────────────────
 * A risk is something that might happen; an issue is a risk that did. Two tables would make that
 * transition a copy between them, and a copied row cannot answer the question every program review
 * asks — *when did we know?* So `raiseAsIssue` moves `kind` in place and stamps `became_issue_at`.
 * One row, one history, and the score it was rated at survives.
 *
 * ── MITIGATIONS ARE TASKS, NOT A SECOND TO-DO LIST ───────────────────────────────────────────
 * "Order the long-lead parts now" is work with an owner and a date, which is exactly what
 * `project_milestone_tasks` is. Giving the register its own checklist would hand a customer two
 * places where their work lives — the same argument that made project ToDos a projection onto the
 * platform queue rather than a queue of their own, and canvas deliverables one column rather than a
 * second editor.
 *
 * So `mitigationTask` creates a real project task (scope `project`, since a mitigation rarely
 * belongs to one phase) and the register links to it. The task keeps all the machinery it already
 * has: a ToDo, an email, nudges, reassignment, attachments.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────────────────────────
 * Raising and updating a risk is open to anyone on the project: the person who sees it first is
 * rarely the manager, and a register only a manager may write is a register that lags reality by a
 * week. CLOSING one is `tenant_admin` — deciding a risk is behind us is a management call.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, listAssignees, type ProjectActor } from './access';
import { createMilestoneTask } from './milestone-tasks';
import type { Fail, Ok } from './project';

export interface ProjectRisk {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  detail: string | null;
  kind: 'risk' | 'issue';
  status: 'open' | 'closed';
  probability: number;
  impact: number;
  score: number;
  ownerUserId: string | null;
  ownerEmail?: string | null;
  mitigation: string | null;
  contingency: string | null;
  reviewOn: string | null;
  becameIssueAt: string | null;
  closedAt: string | null;
  closedNote: string | null;
  createdAt: string | null;
}

/** 1–5 on both axes; anything else is a typo, not a judgement. */
function rating(v: unknown, fallback: number): number | null {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

/** Worst first — a register sorted by creation date is a register nobody reads past row three. */
export async function listProjectRisks(tenantId: string, projectId: string): Promise<ProjectRisk[]> {
  try {
    return await sql<ProjectRisk[]>`
      SELECT r.id, r.project_id, r.milestone_id, r.title, r.detail, r.kind, r.status,
             r.probability, r.impact, r.score, r.owner_user_id, u.email AS owner_email,
             r.mitigation, r.contingency, r.review_on, r.became_issue_at, r.closed_at,
             r.closed_note, r.created_at
        FROM project_risks r
        LEFT JOIN users u ON u.id = r.owner_user_id
       WHERE r.project_id = ${projectId}::uuid AND r.tenant_id = ${tenantId}::uuid
       ORDER BY (r.status = 'open') DESC, r.score DESC, r.created_at DESC`;
  } catch (err) {
    console.error('[projects/risks] listProjectRisks failed:', err);
    return [];
  }
}

export async function raiseRisk(
  actor: ProjectActor,
  projectId: string,
  input: {
    title?: string; detail?: string | null; milestoneId?: string | null;
    probability?: number | string; impact?: number | string;
    ownerUserId?: string | null; mitigation?: string | null; contingency?: string | null;
    reviewOn?: string | null;
    /** Raise it already realised — the case where somebody logs a problem, not a forecast. */
    asIssue?: boolean;
  },
): Promise<Ok<ProjectRisk> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const title = (input.title ?? '').trim();
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }
  const probability = rating(input.probability, 3);
  const impact = rating(input.impact, 3);
  if (probability === null || impact === null) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'probability and impact are whole numbers from 1 to 5',
    };
  }
  const reviewOn = input.reviewOn ?? null;
  if (reviewOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(reviewOn)) {
    return { ok: false, status: 400, error: 'reviewOn must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-before-write, scoped to THIS project — a milestone from another contract satisfies the FK.
    if (input.milestoneId) {
      const [ms] = await sql<{ id: string }[]>`
        SELECT id FROM project_milestones
         WHERE id = ${input.milestoneId}::uuid AND project_id = ${projectId}::uuid
           AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!ms) {
        return { ok: false, status: 400, error: 'That milestone does not belong to this project', code: 'VALIDATION_ERROR' };
      }
    }
    if (input.ownerUserId) {
      const roster = await listAssignees(actor.tenantId, projectId);
      if (!roster.some((a) => a.userId === input.ownerUserId)) {
        return {
          ok: false, status: 409, code: 'NOT_ON_PROJECT',
          error: 'That person is not on this project, so they could not watch it. Add them first.',
        };
      }
    }

    // Plain values — mig 225's CHECK binds kind to `became_issue_at`, so they are computed
    // together here rather than left to agree.
    const kind = input.asIssue ? 'issue' : 'risk';
    const becameIssueAt = input.asIssue ? new Date() : null;

    const [row] = await sql<ProjectRisk[]>`
      INSERT INTO project_risks
        (tenant_id, project_id, milestone_id, title, detail, kind, probability, impact,
         owner_user_id, mitigation, contingency, review_on, became_issue_at, created_by)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${input.milestoneId ?? null}, ${title},
         ${(input.detail ?? '').trim() || null}, ${kind}, ${probability}, ${impact},
         ${input.ownerUserId ?? null}, ${(input.mitigation ?? '').trim() || null},
         ${(input.contingency ?? '').trim() || null}, ${reviewOn}::date, ${becameIssueAt},
         ${actor.userId}::uuid)
      RETURNING id, project_id, milestone_id, title, detail, kind, status, probability, impact,
                score, owner_user_id, mitigation, contingency, review_on, became_issue_at,
                closed_at, closed_note, created_at`;
    if (!row) return { ok: false, status: 500, error: 'Failed to raise it', code: 'DB_ERROR' };

    await emitEventSingle({
      namespace: 'project',
      type: input.asIssue ? 'issue.raised' : 'risk.raised',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, riskId: row.id, title, score: row.score, kind },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId,
      action: input.asIssue ? 'project.issue_raised' : 'project.risk_raised',
      entityType: 'project_risk', entityId: row.id,
      metadata: { projectId, title, score: row.score },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/risks] raiseRisk failed:', err);
    return { ok: false, status: 500, error: 'Failed to raise it', code: 'DB_ERROR' };
  }
}

export async function updateRisk(
  actor: ProjectActor,
  projectId: string,
  riskId: string,
  patch: {
    probability?: number | string; impact?: number | string;
    ownerUserId?: string | null; mitigation?: string | null; contingency?: string | null;
    reviewOn?: string | null; detail?: string | null;
  },
): Promise<Ok<ProjectRisk> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };
  }
  try {
    const [before] = await sql<ProjectRisk[]>`
      SELECT id, project_id, milestone_id, title, detail, kind, status, probability, impact, score,
             owner_user_id, mitigation, contingency, review_on, became_issue_at, closed_at,
             closed_note, created_at
        FROM project_risks
       WHERE id = ${riskId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!before) return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };

    const probability = 'probability' in patch ? rating(patch.probability, before.probability) : before.probability;
    const impact = 'impact' in patch ? rating(patch.impact, before.impact) : before.impact;
    if (probability === null || impact === null) {
      return {
        ok: false, status: 400, code: 'VALIDATION_ERROR',
        error: 'probability and impact are whole numbers from 1 to 5',
      };
    }
    if (patch.ownerUserId) {
      const roster = await listAssignees(actor.tenantId, projectId);
      if (!roster.some((a) => a.userId === patch.ownerUserId)) {
        return { ok: false, status: 409, code: 'NOT_ON_PROJECT', error: 'That person is not on this project.' };
      }
    }
    // `in`, not truthiness: null MEANS clear the owner / the review date.
    const ownerUserId = 'ownerUserId' in patch ? (patch.ownerUserId ?? null) : before.ownerUserId;
    const reviewOn = 'reviewOn' in patch ? (patch.reviewOn || null) : before.reviewOn;
    const mitigation = 'mitigation' in patch ? ((patch.mitigation ?? '').trim() || null) : before.mitigation;
    const contingency = 'contingency' in patch ? ((patch.contingency ?? '').trim() || null) : before.contingency;
    const detail = 'detail' in patch ? ((patch.detail ?? '').trim() || null) : before.detail;

    const [row] = await sql<ProjectRisk[]>`
      UPDATE project_risks
         SET probability = ${probability}, impact = ${impact}, owner_user_id = ${ownerUserId},
             mitigation = ${mitigation}, contingency = ${contingency}, detail = ${detail},
             review_on = ${reviewOn}::date, updated_at = now()
       WHERE id = ${riskId}::uuid AND tenant_id = ${actor.tenantId}::uuid
      RETURNING id, project_id, milestone_id, title, detail, kind, status, probability, impact,
                score, owner_user_id, mitigation, contingency, review_on, became_issue_at,
                closed_at, closed_note, created_at`;
    if (!row) return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };

    // Only when the SCORE moved. A register that emits on every keystroke is a feed people mute.
    if (row.score !== before.score) {
      await emitEventSingle({
        namespace: 'project',
        type: 'risk.rescored',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: { projectId, riskId, title: row.title, from: before.score, to: row.score },
      });
    }
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/risks] updateRisk failed:', err);
    return { ok: false, status: 500, error: 'Failed to update it', code: 'DB_ERROR' };
  }
}

/** A risk that happened. Moves in place — the history is the point. */
export async function raiseAsIssue(
  actor: ProjectActor,
  projectId: string,
  riskId: string,
): Promise<Ok<ProjectRisk> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };
  }
  try {
    const now = new Date();
    // Compare-and-swap on `kind = 'risk'`: a second click must not re-stamp the moment we learned.
    const [row] = await sql<ProjectRisk[]>`
      UPDATE project_risks
         SET kind = 'issue', became_issue_at = ${now}, updated_at = now()
       WHERE id = ${riskId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid AND kind = 'risk'
      RETURNING id, project_id, milestone_id, title, detail, kind, status, probability, impact,
                score, owner_user_id, mitigation, contingency, review_on, became_issue_at,
                closed_at, closed_note, created_at`;
    if (!row) {
      return { ok: false, status: 409, code: 'ALREADY_AN_ISSUE', error: 'That is already an issue.' };
    }
    await emitEventSingle({
      namespace: 'project',
      type: 'risk.became_issue',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, riskId, title: row.title, score: row.score },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.risk_became_issue',
      entityType: 'project_risk', entityId: riskId,
      metadata: { projectId, title: row.title, score: row.score },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/risks] raiseAsIssue failed:', err);
    return { ok: false, status: 500, error: 'Failed to record it', code: 'DB_ERROR' };
  }
}

/** Close it. `tenant_admin` — deciding a risk is behind us is a management call. */
export async function closeRisk(
  actor: ProjectActor,
  projectId: string,
  riskId: string,
  note?: string | null,
): Promise<Ok<ProjectRisk> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can close a risk', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };
  }
  try {
    const closedAt = new Date();
    const [row] = await sql<ProjectRisk[]>`
      UPDATE project_risks
         SET status = 'closed', closed_at = ${closedAt}, closed_by = ${actor.userId}::uuid,
             closed_note = ${(note ?? '').trim() || null}, updated_at = now()
       WHERE id = ${riskId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid AND status = 'open'
      RETURNING id, project_id, milestone_id, title, detail, kind, status, probability, impact,
                score, owner_user_id, mitigation, contingency, review_on, became_issue_at,
                closed_at, closed_note, created_at`;
    if (!row) {
      return { ok: false, status: 409, code: 'ALREADY_CLOSED', error: 'That is already closed.' };
    }
    await emitEventSingle({
      namespace: 'project',
      type: row.kind === 'issue' ? 'issue.closed' : 'risk.closed',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, riskId, title: row.title, ...(row.closedNote ? { note: row.closedNote } : {}) },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.risk_closed',
      entityType: 'project_risk', entityId: riskId, metadata: { projectId, kind: row.kind },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/risks] closeRisk failed:', err);
    return { ok: false, status: 500, error: 'Failed to close it', code: 'DB_ERROR' };
  }
}

/**
 * Turn a mitigation into real work.
 *
 * A project TASK, not a private checklist: it inherits the ToDo, the email, the nudges, the
 * reassignment and the attachments that spine already has. Building a second one here would give a
 * customer two places their work lives — the argument that made every other seam in this module a
 * reuse rather than a rewrite.
 *
 * Scope `project`, not a milestone: a mitigation is usually standing work, and filing it under a
 * phase would make it gate that phase on screen while gating nothing in the database.
 *
 * ⚠️ It inherits `createMilestoneTask`'s authority, which is `tenant_admin` — adding work to the
 * plan is a management act wherever it starts. That refusal is passed through verbatim rather than
 * re-checked here, so there is one rule about who may add a task, in one place.
 */
export async function mitigationTask(
  actor: ProjectActor,
  projectId: string,
  riskId: string,
  input: { title?: string; assigneeUserId?: string | null; dueDate?: string | null },
): Promise<Ok<{ riskId: string; taskId: string }> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };
  }
  try {
    const [risk] = await sql<{ id: string; title: string; mitigation: string | null }[]>`
      SELECT id, title, mitigation FROM project_risks
       WHERE id = ${riskId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!risk) return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };

    const title = (input.title ?? '').trim() || (risk.mitigation ?? '').trim() || `Mitigate: ${risk.title}`;
    const made = await createMilestoneTask(actor, projectId, {
      milestoneId: null,
      title: title.slice(0, 500),
      detail: `Mitigation for the risk "${risk.title}".`,
      assigneeUserId: input.assigneeUserId ?? null,
      dueDate: input.dueDate ?? null,
    });
    if (!made.ok) return made;

    await emitEventSingle({
      namespace: 'project',
      type: 'risk.mitigation_planned',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, riskId, taskId: made.data.id, title },
    });
    return { ok: true, data: { riskId, taskId: made.data.id } };
  } catch (err) {
    console.error('[projects/risks] mitigationTask failed:', err);
    return { ok: false, status: 500, error: 'Failed to plan the mitigation', code: 'DB_ERROR' };
  }
}
