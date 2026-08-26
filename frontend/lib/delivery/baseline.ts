/**
 * Freezing the plan, and moving it afterwards without losing what was frozen.
 *
 * ── THE ONE NUMBER THAT CANNOT BE RECOMPUTED ─────────────────────────────────────────────────
 * Everything else in this capability can be derived again from the rows. The baseline cannot: it is
 * what the plan looked like at a moment that has passed, and once overwritten there is no way back
 * to it. That is why migration 216 enforces immutability in a TRIGGER rather than here — an
 * app-layer rule protects only the writers that exist today.
 *
 * This module is the other half of the same rule: **rebaseline supersedes the CURRENT plan; it
 * never touches the baseline.** A rebaseline that overwrote it would destroy "fourteen days late
 * against baseline" forever, and silently, because the arithmetic would still work.
 *
 * ── WHY BOTH LAYERS ──────────────────────────────────────────────────────────────────────────
 * The trigger raises `23001`, which reaches a user as a 500 and a stack trace. The guards here turn
 * the same refusals into an answer a person can act on — "this project was baselined on 3 March;
 * rebaseline instead" — and the trigger stays as the thing that is actually true regardless of
 * which code path arrives.
 */
import { sql, auditLog } from '@/lib/db';
import { withEventBracket, emitEventSingle, userActor } from '@/lib/events';
import { canAssign, canAccessProject, type DeliveryActor } from './access';
import { readiness, type Fail, type Ok } from './projects';

export interface BaselineResult {
  projectId: string;
  baselinedAt: string;
  wbsNodes: number;
  milestones: number;
}

/**
 * Freeze the contractual skeleton: copy the current plan into the baseline columns, once.
 *
 * Refuses on two conditions, both of which would otherwise produce a baseline that means nothing:
 * missing anchor documents (a promise measured against no contract), and an already-baselined
 * project (which the trigger would reject anyway, less legibly).
 */
export async function setBaseline(
  actor: DeliveryActor,
  projectId: string,
): Promise<Ok<BaselineResult> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can baseline a project', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  try {
    const [project] = await sql<{ id: string; name: string; baselinedAt: string | null }[]>`
      SELECT id, name, baselined_at FROM delivery_projects
       WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    if (!project) return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };

    if (project.baselinedAt) {
      return {
        ok: false, status: 409, code: 'ALREADY_BASELINED',
        error: `This project was baselined on ${String(project.baselinedAt).slice(0, 10)}. `
          + 'Use rebaseline to move the current plan — the baseline itself is permanent.',
      };
    }

    // The two-artifact rule, enforced HERE and nowhere else. A baseline is the promise you measure
    // variance against; freezing one against documents that are not there makes every later number
    // a claim about nothing.
    const ready = await readiness(actor.tenantId, projectId);
    if (!ready.canBaseline) {
      return {
        ok: false, status: 409, code: 'NOT_READY',
        error: `Upload ${ready.missing.join(' and ')} before baselining. The baseline is what `
          + 'variance is measured against, and it has to be measured against the signed documents.',
      };
    }

    return await withEventBracket(
      {
        namespace: 'project',
        type: 'baseline.set',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: { projectId, name: project.name },
      },
      async () => {
        // `tx: any` is the house idiom (lib/intake.ts, lib/rls.ts, lib/ingest/materialize.ts),
        // and those files carry NO eslint-disable — the rule is not configured in this project,
        // so naming it in a disable comment is itself a build error:
        //   Error: Definition for rule '@typescript-eslint/no-explicit-any' was not found.
        // postgres.js's TransactionSql type is not callable as a tagged template under this
        // config, and every transaction in the tree annotates it the same way.
        const out = await sql.begin(async (tx: any) => {
          // NULL → value on every row. The trigger permits exactly this transition; a second call
          // would be value → different and is refused above with a legible message.
          const wbs = await tx`
            UPDATE delivery_wbs_nodes
               SET baseline_start = planned_start,
                   baseline_end   = planned_end,
                   baseline_cost  = planned_cost,
                   updated_at     = now()
             WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND baseline_start IS NULL AND baseline_end IS NULL AND baseline_cost IS NULL
            RETURNING id`;

          const ms = await tx`
            UPDATE delivery_milestones
               SET baseline_date = forecast_date,
                   updated_at    = now()
             WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND baseline_date IS NULL
            RETURNING id`;

          const [proj] = await tx`
            UPDATE delivery_projects
               SET baselined_at = now(), status = 'active', updated_at = now()
             WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND baselined_at IS NULL
            RETURNING baselined_at`;

          // Compare-and-swap: `baselined_at IS NULL` in the predicate, so two concurrent baseline
          // requests cannot both win. The loser matches zero rows and is rolled back rather than
          // producing a second, later timestamp over the same frozen plan.
          if (!proj) throw new Error('BASELINE_RACE');

          return { wbsNodes: wbs.length, milestones: ms.length, baselinedAt: String(proj.baselinedAt) };
        });

        await auditLog({
          tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.baseline_set',
          entityType: 'delivery_project', entityId: projectId,
          metadata: { wbsNodes: out.wbsNodes, milestones: out.milestones },
        });

        return {
          result: { wbsNodes: out.wbsNodes, milestones: out.milestones },
          value: { ok: true as const, data: { projectId, ...out } },
        };
      },
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'BASELINE_RACE') {
      return {
        ok: false, status: 409, code: 'ALREADY_BASELINED',
        error: 'This project was baselined by someone else a moment ago.',
      };
    }
    console.error('[delivery/baseline] setBaseline failed:', err);
    return { ok: false, status: 500, error: 'Failed to set the baseline', code: 'DB_ERROR' };
  }
}

export interface RebaselineInput {
  /** Move every current date by this many days. Negative pulls the plan earlier. */
  shiftDays?: number;
  /** …or set the plan to start on this date, shifting everything by the same delta. */
  startOn?: string;
  reason: string;
}

export interface RebaselineResult {
  projectId: string;
  shiftedDays: number;
  wbsNodes: number;
  milestones: number;
}

/**
 * Move the CURRENT plan. The baseline is untouched — that is the whole point of the operation
 * having its own name.
 *
 * A reason is required, and not as ceremony: a rebaseline is the moment a schedule stopped being
 * true, and six months later "why is everything fourteen days later than the contract says" is
 * answered by this field or by nobody.
 */
export async function rebaseline(
  actor: DeliveryActor,
  projectId: string,
  input: RebaselineInput,
): Promise<Ok<RebaselineResult> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can rebaseline', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const reason = (input.reason ?? '').trim();
  if (!reason || reason.length > 2000) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'A reason is required — it is the only record of why the schedule moved',
    };
  }

  try {
    const [project] = await sql<{ id: string; baselinedAt: string | null }[]>`
      SELECT id, baselined_at FROM delivery_projects
       WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    if (!project) return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
    if (!project.baselinedAt) {
      return {
        ok: false, status: 409, code: 'NOT_BASELINED',
        error: 'This project has no baseline yet. Edit the plan directly, or baseline it first.',
      };
    }

    // Resolve the shift. `startOn` is expressed as a delta so both forms take the same code path —
    // one shift, applied uniformly, which is what keeps durations intact.
    let shiftDays: number;
    if (typeof input.shiftDays === 'number') {
      if (!Number.isInteger(input.shiftDays) || Math.abs(input.shiftDays) > 3650) {
        return { ok: false, status: 400, error: 'shiftDays must be a whole number within ±3650', code: 'VALIDATION_ERROR' };
      }
      shiftDays = input.shiftDays;
    } else if (typeof input.startOn === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startOn)) {
        return { ok: false, status: 400, error: 'startOn must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
      }
      const [row] = await sql<{ earliest: string | null }[]>`
        SELECT MIN(planned_start)::text AS earliest FROM delivery_wbs_nodes
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
      if (!row?.earliest) {
        return { ok: false, status: 409, error: 'No planned dates to shift', code: 'NOT_READY' };
      }
      const from = Date.parse(`${row.earliest}T00:00:00Z`);
      const to = Date.parse(`${input.startOn}T00:00:00Z`);
      shiftDays = Math.round((to - from) / 86_400_000);
    } else {
      return { ok: false, status: 400, error: 'Provide shiftDays or startOn', code: 'VALIDATION_ERROR' };
    }

    if (shiftDays === 0) {
      return { ok: false, status: 400, error: 'That shift moves nothing', code: 'VALIDATION_ERROR' };
    }

    return await withEventBracket(
      {
        namespace: 'project',
        type: 'project.rebaselined',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: { projectId, shiftDays, reason },
      },
      async () => {
        // `tx: any` is the house idiom (lib/intake.ts, lib/rls.ts, lib/ingest/materialize.ts),
        // and those files carry NO eslint-disable — the rule is not configured in this project,
        // so naming it in a disable comment is itself a build error:
        //   Error: Definition for rule '@typescript-eslint/no-explicit-any' was not found.
        // postgres.js's TransactionSql type is not callable as a tagged template under this
        // config, and every transaction in the tree annotates it the same way.
        const out = await sql.begin(async (tx: any) => {
          // ONLY the planned_* columns. The baseline_* columns are not in this statement at all —
          // and if a future edit added them, the trigger would refuse the write rather than let it
          // through quietly.
          const wbs = await tx`
            UPDATE delivery_wbs_nodes
               SET planned_start = planned_start + ${shiftDays} * INTERVAL '1 day',
                   planned_end   = planned_end   + ${shiftDays} * INTERVAL '1 day',
                   updated_at    = now()
             WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND (planned_start IS NOT NULL OR planned_end IS NOT NULL)
            RETURNING id`;

          const ms = await tx`
            UPDATE delivery_milestones
               SET forecast_date = forecast_date + ${shiftDays} * INTERVAL '1 day',
                   updated_at    = now()
             WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND forecast_date IS NOT NULL AND status = 'pending'
            RETURNING id`;

          return { wbsNodes: wbs.length, milestones: ms.length };
        });

        await auditLog({
          tenantId: actor.tenantId, userId: actor.userId, action: 'delivery.rebaselined',
          entityType: 'delivery_project', entityId: projectId,
          metadata: { shiftDays, reason, ...out },
        });

        return {
          result: { shiftDays, ...out },
          value: { ok: true as const, data: { projectId, shiftedDays: shiftDays, ...out } },
        };
      },
    );
  } catch (err) {
    console.error('[delivery/baseline] rebaseline failed:', err);
    return { ok: false, status: 500, error: 'Failed to rebaseline', code: 'DB_ERROR' };
  }
}

/** Variance per milestone: how far the current forecast has drifted from what was promised. */
export interface MilestoneVariance {
  id: string;
  title: string;
  baselineDate: string | null;
  forecastDate: string | null;
  varianceDays: number | null;
  status: string;
}

export async function milestoneVariance(tenantId: string, projectId: string): Promise<MilestoneVariance[]> {
  try {
    return await sql<MilestoneVariance[]>`
      SELECT id, title, baseline_date, forecast_date, status,
             CASE WHEN baseline_date IS NULL OR forecast_date IS NULL THEN NULL
                  ELSE (forecast_date - baseline_date)::int END AS variance_days
        FROM delivery_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, baseline_date NULLS LAST`;
  } catch (err) {
    console.error('[delivery/baseline] milestoneVariance failed:', err);
    return [];
  }
}

/** Emitted when a milestone's forecast crosses its baseline — advisory, for the activity feed. */
export async function noteSlip(
  actor: DeliveryActor, projectId: string, milestone: { id: string; title: string; varianceDays: number },
): Promise<void> {
  await emitEventSingle({
    namespace: 'project',
    type: 'milestone.due',
    actor: userActor(actor.userId),
    tenantId: actor.tenantId,
    payload: { projectId, milestoneId: milestone.id, title: milestone.title, varianceDays: milestone.varianceDays },
  });
}
