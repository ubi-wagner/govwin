/**
 * GET /api/portal/[tenantSlug]/automation-overview — the tenant's "Your automation" roll-up.
 *
 * At-a-glance monitoring for the tenant admin (UI-gaps T2/T4/T5): policy coverage by scope, the
 * team-wide open ToDo / nudge / escalation board, and a per-portal automation-config summary read
 * back from guardrail_config. tenant_admin+ with tenant access; reads run through withTenant() so
 * they stay correct under the NOBYPASSRLS cutover, with the explicit WHERE tenant_id as today's
 * load-bearing belt (RLS is inert under the bypass role).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { coerceJsonb } from '@/lib/jsonb';
import { TRIGGER_CATALOG } from '@/lib/automation/catalog';

interface RouteContext { params: Promise<{ tenantSlug: string }> }

async function resolveCtx(ctx: RouteContext): Promise<
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id || !hasRoleAtLeast(role, 'tenant_admin')) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant admin access required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const { tenantSlug } = await ctx.params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true, tenantId, userId: u.id };
}

interface RawTask {
  id: string; title: string; taskType: string; status: string; assigneeRole: string | null;
  dueAt: string | null; nudgeSchedule: unknown; nudgesSent: number; entityType: string | null;
  entityId: string | null; stepName: string | null;
}
interface RawPortal {
  id: string; label: string | null; status: string; currentStageIndex: number; guardrailConfig: unknown;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const r = await resolveCtx(ctx);
  if (!r.ok) return r.res;
  try {
    const data: {
      policyRows: Array<{ scope: string; enabled: number; total: number }>;
      taskRows: RawTask[];
      portalRows: RawPortal[];
    } = await withTenant(r.tenantId, async (tx) => {
      const policyRows = await tx<Array<{ scope: string; enabled: number; total: number }>>`
        SELECT scope, count(*) FILTER (WHERE enabled)::int AS enabled, count(*)::int AS total
        FROM tenant_automation_policies WHERE tenant_id = ${r.tenantId}::uuid GROUP BY scope
      `;
      const taskRows = await tx<RawTask[]>`
        SELECT id, title, task_type AS "taskType", status, assignee_role AS "assigneeRole",
               due_at AS "dueAt", nudge_schedule AS "nudgeSchedule", nudges_sent AS "nudgesSent",
               entity_type AS "entityType", entity_id AS "entityId", step_name AS "stepName"
        FROM tasks
        WHERE tenant_id = ${r.tenantId}::uuid AND status IN ('open', 'in_progress')
        ORDER BY due_at ASC NULLS LAST
        LIMIT 30
      `;
      const portalRows = await tx<RawPortal[]>`
        SELECT id, label, status, current_stage_index AS "currentStageIndex",
               guardrail_config AS "guardrailConfig"
        FROM proposal_portals WHERE tenant_id = ${r.tenantId}::uuid
        ORDER BY created_at DESC LIMIT 25
      `;
      return { policyRows, taskRows, portalRows };
    });

    // Coverage: enabled/configured (from tenant rows) vs the governable total (from the catalog).
    const catalogTotals = TRIGGER_CATALOG.reduce<Record<string, number>>((acc, t) => {
      acc[t.scope] = (acc[t.scope] ?? 0) + 1; return acc;
    }, {});
    const byScope = new Map(data.policyRows.map((p) => [p.scope, p]));
    const coverage = (['discovery', 'build'] as const).map((scope) => ({
      scope,
      enabled: byScope.get(scope)?.enabled ?? 0,
      configured: byScope.get(scope)?.total ?? 0,
      total: catalogTotals[scope] ?? 0,
    }));

    // Tasks: raw nudge schedule coerced; the component computes stage/escalated/overdue badges.
    const tasks = data.taskRows.map((t) => ({
      ...t,
      nudgeSchedule: coerceJsonb<number[]>(t.nudgeSchedule, []),
    }));

    // Portals: the config a build launched with, read back (agentFirst / RFP oversight / cadence).
    const portals = data.portalRows.map((p) => {
      const cfg = coerceJsonb<Record<string, unknown>>(p.guardrailConfig, {});
      const stages = Array.isArray(cfg.stages) ? cfg.stages : [];
      const collaborators = Array.isArray(cfg.collaborators) ? cfg.collaborators : [];
      return {
        id: p.id,
        label: p.label ?? 'Untitled portal',
        status: p.status,
        currentStageIndex: p.currentStageIndex,
        agentFirst: cfg.agentFirst === true,
        rfpOversight: cfg.rfpOversight !== false, // default ON unless explicitly opted out
        stageCount: stages.length,
        nudgeDays: Array.isArray(cfg.nudgeDays) ? (cfg.nudgeDays as number[]) : [],
        managerCount: collaborators.filter((c) => (c as { role?: string })?.role === 'manager').length,
      };
    });

    return NextResponse.json({ data: { coverage, tasks, portals } });
  } catch (e) {
    console.error('[automation-overview] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load automation overview', code: 'DB_ERROR' }, { status: 500 });
  }
}
