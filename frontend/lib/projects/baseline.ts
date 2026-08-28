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
import { withTenant } from '@/lib/rls';
import { withEventBracket, emitEventSingle, userActor } from '@/lib/events';
import { canAssign, canAccessProject, type ProjectActor } from './access';
import { isoDate } from './dates';
import { readiness, type Fail, type Ok } from './project';

export interface BaselineResult {
  projectId: string;
  baselinedAt: string;
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
  actor: ProjectActor,
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
      SELECT id, name, baselined_at FROM projects
       WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    if (!project) return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };

    if (project.baselinedAt) {
      // `isoDate`, not a ten-character slice of the string form: `baselined_at` arrives as a
      // JavaScript Date, and slicing it yields "Tue Apr 28" — a date with no year, shown to a
      // person, in a message whose whole job is to tell them WHEN. Same class as the D8 page bug.
      const on = isoDate(project.baselinedAt);
      return {
        ok: false, status: 409, code: 'ALREADY_BASELINED',
        error: `${on ? `This project was baselined on ${on}.` : 'This project is already baselined.'} `
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
        // ── `withTenant`, NOT `sql.begin` — the escape that made the baseline UNSETTABLE ──────
        // `lib/db.ts`'s `sql` is a Proxy: only the tagged-template CALL is routed through the
        // tenant context. `sql.begin` forwards straight to the raw `govtech_app` pool, where
        // `app.tenant_id` is unset — so every statement inside the transaction matched ZERO rows
        // under RLS, the CAS on `projects` found nothing, and the route answered
        //     409 "This project was baselined by someone else a moment ago."
        // on the FIRST attempt, for a project nobody had ever baselined. The unit tests mock the
        // DB, the isolation lens uses the owner client, and no lens had ever POSTed this route as
        // a real actor — the end-to-end drive caught it on its first complete run.
        // `withTenant` is the explicit client `lib/db.ts`'s own header tells you to use here.
        // `tx: any` is the house idiom (lib/intake.ts, lib/rls.ts, lib/ingest/materialize.ts) —
        // postgres.js's TransactionSql type is not callable as a tagged template under this config.
        const out = await withTenant(actor.tenantId, async (tx: any) => {
          // NULL → value on every row. The trigger permits exactly this transition; a second call
          // would be value → different and is refused above with a legible message.
          //
          // ONE statement now: the milestone IS the WBS element (mig 228), so freezing the plan
          // is freezing the milestones. It used to be two, against two tables that described the
          // same thing — and a baseline written in two places is a baseline that can half-freeze.
          //
          // BOTH promises, in the one statement (mig 229). Freezing the date and leaving the cost
          // is a half-baseline of a subtler kind: schedule variance would be measurable and cost
          // variance would silently be zero, because `planned_cost` — which a rebaseline may move —
          // would be standing on both sides of the subtraction.
          const ms = await tx`
            UPDATE project_milestones
               SET baseline_date = forecast_date,
                   baseline_cost = planned_cost,
                   updated_at    = now()
             WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND baseline_date IS NULL
            RETURNING id`;

          const [proj] = await tx`
            UPDATE projects
               SET baselined_at = now(), status = 'active', updated_at = now()
             WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND baselined_at IS NULL
            RETURNING baselined_at`;

          // Compare-and-swap: `baselined_at IS NULL` in the predicate, so two concurrent baseline
          // requests cannot both win. The loser matches zero rows and is rolled back rather than
          // producing a second, later timestamp over the same frozen plan.
          if (!proj) throw new Error('BASELINE_RACE');

          return { milestones: ms.length, baselinedAt: String(proj.baselinedAt) };
        });

        await auditLog({
          tenantId: actor.tenantId, userId: actor.userId, action: 'project.baseline_set',
          entityType: 'project', entityId: projectId,
          metadata: { milestones: out.milestones },
        });

        return {
          result: { milestones: out.milestones },
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
    console.error('[projects/baseline] setBaseline failed:', err);
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
  actor: ProjectActor,
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
      SELECT id, baselined_at FROM projects
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
        SELECT MIN(starts_on)::text AS earliest FROM project_milestones
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
        // ── `withTenant`, NOT `sql.begin` — the escape that made the baseline UNSETTABLE ──────
        // `lib/db.ts`'s `sql` is a Proxy: only the tagged-template CALL is routed through the
        // tenant context. `sql.begin` forwards straight to the raw `govtech_app` pool, where
        // `app.tenant_id` is unset — so every statement inside the transaction matched ZERO rows
        // under RLS, the CAS on `projects` found nothing, and the route answered
        //     409 "This project was baselined by someone else a moment ago."
        // on the FIRST attempt, for a project nobody had ever baselined. The unit tests mock the
        // DB, the isolation lens uses the owner client, and no lens had ever POSTed this route as
        // a real actor — the end-to-end drive caught it on its first complete run.
        // `withTenant` is the explicit client `lib/db.ts`'s own header tells you to use here.
        // `tx: any` is the house idiom (lib/intake.ts, lib/rls.ts, lib/ingest/materialize.ts) —
        // postgres.js's TransactionSql type is not callable as a tagged template under this config.
        const out = await withTenant(actor.tenantId, async (tx: any) => {
          // ONLY the current-plan columns. `baseline_date` and `baseline_cost` are not in this
          // statement at all — and if a future edit added them, the trigger would refuse the write
          // rather than let it through quietly.
          // ONE statement, against the one spine (mig 228). Both ends of a milestone's window move
          // together — shifting the end without the start silently compresses every phase, and the
          // dates still look like dates.
          const ms = await tx`
            UPDATE project_milestones
               SET starts_on     = starts_on     + ${shiftDays} * INTERVAL '1 day',
                   forecast_date = forecast_date + ${shiftDays} * INTERVAL '1 day',
                   updated_at    = now()
             WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
               AND (starts_on IS NOT NULL OR forecast_date IS NOT NULL) AND status = 'pending'
            RETURNING id`;

          return { milestones: ms.length };
        });

        await auditLog({
          tenantId: actor.tenantId, userId: actor.userId, action: 'project.rebaselined',
          entityType: 'project', entityId: projectId,
          metadata: { shiftDays, reason, ...out },
        });

        return {
          result: { shiftDays, ...out },
          value: { ok: true as const, data: { projectId, shiftedDays: shiftDays, ...out } },
        };
      },
    );
  } catch (err) {
    console.error('[projects/baseline] rebaseline failed:', err);
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
        FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, baseline_date NULLS LAST`;
  } catch (err) {
    console.error('[projects/baseline] milestoneVariance failed:', err);
    return [];
  }
}

/** Emitted when a milestone's forecast crosses its baseline — advisory, for the activity feed. */
export async function noteSlip(
  actor: ProjectActor, projectId: string, milestone: { id: string; title: string; varianceDays: number },
): Promise<void> {
  await emitEventSingle({
    namespace: 'project',
    type: 'milestone.due',
    actor: userActor(actor.userId),
    tenantId: actor.tenantId,
    payload: { projectId, milestoneId: milestone.id, title: milestone.title, varianceDays: milestone.varianceDays },
  });
}
