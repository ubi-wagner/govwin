/**
 * The AI-manager gate closer (A4) — and the reason it cannot do any harm.
 *
 * ── ONE WRITER ───────────────────────────────────────────────────────────────────────────────
 * This does not close a milestone. It calls `markMilestoneMet`, which is the only thing that ever
 * has, and which already refuses on `TASKS_OUTSTANDING` and `DELIVERABLES_OUTSTANDING`.
 *
 * That is the entire safety argument, and it is structural rather than careful: **the agent's reach
 * is a strict subset of a person's.** It can close only what a tenant_admin could have closed at
 * that moment, and it additionally requires its own preconditions. A human can close a milestone the
 * closer would not; the closer can never close one a human could not.
 *
 * A second write path — "the agent knows it is fine, skip the check" — would invert that in one
 * line, which is exactly why there is not one.
 *
 * ── AND IT IS OPT-IN, PER MILESTONE ──────────────────────────────────────────────────────────
 * `gate_closer` defaults to `'human'` (mig 236), including on every milestone written before this
 * existed. A capability that switched itself on for old rows would be deciding something on the
 * customer's behalf that they were never asked about.
 *
 * ── WHAT THE AGENT ACTUALLY CONTRIBUTES ──────────────────────────────────────────────────────
 * Not permission — the deterministic gates already grant that. It contributes a REASON TO STOP: an
 * open high-scoring risk against this phase, or a slipping successor, is a signal that a person
 * should look even though every box is ticked. So the assessment can only ever BLOCK an auto-close,
 * never enable one.
 *
 * That asymmetry is worth stating plainly because the opposite is the intuitive design: people
 * expect "the AI decides it's done". Here the rows decide it is done and the AI may object.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, type ProjectActor } from './access';
import { markMilestoneMet } from './milestones';
import type { Fail, Ok } from './project';

export type GateCloser = 'human' | 'ai_manager';

export interface AutoCloseOutcome {
  milestoneId: string;
  closed: boolean;
  /** Why not, when not — in a sentence a person can act on. */
  reason: string;
  /** What the agent objected to, if anything. Empty when the rows simply were not ready. */
  objections: string[];
}

/** A risk at or above this score is worth a person's eyes even when every box is ticked. */
const OBJECTION_SCORE = 15;

export async function setGateCloser(
  actor: ProjectActor,
  projectId: string,
  milestoneId: string,
  closer: GateCloser,
): Promise<Ok<{ milestoneId: string; gateCloser: GateCloser }> | Fail> {
  if (closer !== 'human' && closer !== 'ai_manager') {
    return { ok: false, status: 400, error: "gateCloser must be 'human' or 'ai_manager'", code: 'VALIDATION_ERROR' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  try {
    const [row] = await sql<{ id: string }[]>`
      UPDATE project_milestones SET gate_closer = ${closer}, updated_at = now()
       WHERE id = ${milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid
      RETURNING id`;
    if (!row) return { ok: false, status: 404, error: 'Milestone not found', code: 'NOT_FOUND' };

    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.gate_closer_set',
      entityType: 'project_milestone', entityId: milestoneId,
      metadata: { projectId, gateCloser: closer },
    });
    return { ok: true, data: { milestoneId, gateCloser: closer } };
  } catch (err) {
    console.error('[projects/gate-closer] setGateCloser failed:', err);
    return { ok: false, status: 500, error: 'Failed to set the gate closer', code: 'DB_ERROR' };
  }
}

/**
 * Try to close a milestone on the AI manager's behalf.
 *
 * Never throws and never dead-ends: every refusal is an outcome with a reason, because this is
 * called from a sweep and a raised exception would stop the milestone after it.
 */
export async function attemptAutoClose(
  actor: ProjectActor,
  projectId: string,
  milestoneId: string,
): Promise<AutoCloseOutcome> {
  const no = (reason: string, objections: string[] = []): AutoCloseOutcome =>
    ({ milestoneId, closed: false, reason, objections });

  try {
    const [ms] = await sql<{ id: string; title: string; gateCloser: string; status: string }[]>`
      SELECT id, title, gate_closer, status FROM project_milestones
       WHERE id = ${milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!ms) return no('That milestone is not on this project.');
    if (ms.status !== 'pending') return no(`"${ms.title}" is already ${ms.status}.`);

    // OPT-IN. A milestone nobody assigned to the AI manager is closed by a person, full stop.
    if (ms.gateCloser !== 'ai_manager') {
      return no(`"${ms.title}" is closed by a person — its gate closer is not the AI manager.`);
    }

    // ── THE AGENT'S CONTRIBUTION: A REASON TO STOP ──────────────────────────────────────────
    // Checked BEFORE attempting the close, because an objection is not a failure to report after
    // the fact — it is the thing that should have prevented the attempt.
    const objections: string[] = [];
    const risks = await sql<{ title: string; score: number; kind: string }[]>`
      SELECT title, score, kind FROM project_risks
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND status = 'open' AND milestone_id = ${milestoneId}::uuid AND score >= ${OBJECTION_SCORE}`;
    for (const r of risks) {
      objections.push(`${r.kind} "${r.title}" is open against this phase, scored ${r.score}.`);
    }
    // A deliverable accepted internally but never SENT is the other one: the boxes are ticked and
    // the customer has nothing. `markMilestoneMet` does not check this — acceptance is its gate —
    // so it is exactly the kind of thing worth a person's eyes.
    const unsent = await sql<{ title: string }[]>`
      SELECT title FROM project_deliverables
       WHERE milestone_id = ${milestoneId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND accepted_at IS NOT NULL AND submitted_at IS NULL`;
    for (const d of unsent) {
      objections.push(`"${d.title}" is accepted internally but has not been sent to the customer.`);
    }

    if (objections.length > 0) {
      await emitEventSingle({
        namespace: 'project',
        type: 'milestone.auto_close_declined',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: { projectId, milestoneId, title: ms.title, objections },
      });
      return no(
        `The AI manager did not close "${ms.title}" — it wants a person to look first.`,
        objections,
      );
    }

    // ── THE ONE WRITER ──────────────────────────────────────────────────────────────────────
    // `markMilestoneMet`, exactly as a person's click reaches it, with its own TASKS_OUTSTANDING
    // and DELIVERABLES_OUTSTANDING refusals intact. Nothing here can weaken them, because nothing
    // here writes a status.
    const result = await markMilestoneMet(actor, projectId, milestoneId, {
      note: 'Closed by the AI manager: every task was done, every deliverable accepted, and nothing '
        + 'on the register argued against it.',
      metrics: { closedBy: 'ai_manager' },
    });
    if (!result.ok) {
      // NOT an objection — the rows simply were not ready, and the message is the same one a
      // person would have seen. Reported as-is rather than paraphrased.
      return no(result.error);
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'milestone.auto_closed',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, milestoneId, title: ms.title },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.milestone_auto_closed',
      entityType: 'project_milestone', entityId: milestoneId,
      metadata: { projectId, title: ms.title },
    });
    return { milestoneId, closed: true, reason: `"${ms.title}" was closed by the AI manager.`, objections: [] };
  } catch (err) {
    console.error('[projects/gate-closer] attemptAutoClose failed:', err);
    return no('Could not evaluate the gate.');
  }
}

/**
 * Sweep every AI-gated milestone on a project.
 *
 * Returns an outcome per milestone, including the ones it declined — a sweep that reported only its
 * successes would make "nothing happened" and "three phases were blocked" look identical.
 */
export async function sweepAutoCloses(
  actor: ProjectActor,
  projectId: string,
): Promise<AutoCloseOutcome[]> {
  if (!(await canAccessProject(actor, projectId))) return [];
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND gate_closer = 'ai_manager' AND status = 'pending'
       ORDER BY sort_index`;
    const out: AutoCloseOutcome[] = [];
    for (const r of rows) {
      // Sequential on purpose: `markMilestoneMet` reads and writes the same rows a sibling might,
      // and a parallel sweep would race itself for no gain on a list this size.
      out.push(await attemptAutoClose(actor, projectId, r.id));
    }
    return out;
  } catch (err) {
    console.error('[projects/gate-closer] sweepAutoCloses failed:', err);
    return [];
  }
}
