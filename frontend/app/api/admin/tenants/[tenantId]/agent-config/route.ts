/**
 * GET   /api/admin/tenants/[tenantId]/agent-config — per-tenant AI limits
 * PATCH /api/admin/tenants/[tenantId]/agent-config — set monthly budget + rate limit
 *
 * The per-tenant overrides on tenant_agent_config. NULL on either field means
 * "inherit the platform default" (platform_agent_config). monthly_budget = 0
 * disables AI for the tenant. The guards (lib/ai/agent-guard.ts,
 * pipeline/src/agents/fabric.py) resolve tenant -> platform -> constant.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantId: string }>;
}

const MAX_BUDGET = 100_000; // sanity ceiling ($)
const MAX_RATE = 100_000;   // sanity ceiling (calls/hour)
const MAX_CEILING = 1_000;  // sanity ceiling for per-call cost ($)

async function requireAdmin(): Promise<
  | { ok: true; userId: string; role: Role }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }),
    };
  }
  const sessionUser = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'rfp_admin')) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 }),
    };
  }
  return { ok: true, userId: sessionUser.id, role };
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { tenantId } = await ctx.params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const adm = await requireAdmin();
    if (!adm.ok) return adm.res;

    try {
      const [cfg] = await sql<{ monthlyBudget: string | null; rateLimitPerHour: number | null; perCallCeiling: string | null }[]>`
        SELECT monthly_budget, rate_limit_per_hour, per_call_ceiling
        FROM tenant_agent_config
        WHERE tenant_id = ${tenantId}::uuid
      `;
      const [platform] = await sql<{ defaultMonthlyBudget: string; defaultRateLimitPerHour: number; defaultPerCallCeiling: string }[]>`
        SELECT default_monthly_budget, default_rate_limit_per_hour, default_per_call_ceiling
        FROM platform_agent_config
        WHERE id = TRUE
      `;

      return NextResponse.json({
        data: {
          tenantId,
          monthlyBudget: cfg?.monthlyBudget != null ? parseFloat(cfg.monthlyBudget) : null,
          rateLimitPerHour: cfg?.rateLimitPerHour ?? null,
          perCallCeiling: cfg?.perCallCeiling != null ? parseFloat(cfg.perCallCeiling) : null,
          platformDefaults: {
            monthlyBudget: platform?.defaultMonthlyBudget != null ? parseFloat(platform.defaultMonthlyBudget) : 50,
            rateLimitPerHour: platform?.defaultRateLimitPerHour ?? 50,
            perCallCeiling: platform?.defaultPerCallCeiling != null ? parseFloat(platform.defaultPerCallCeiling) : 0.5,
          },
        },
      });
    } catch (dbErr) {
      console.error('[admin/tenants/agent-config] GET DB error:', dbErr);
      return NextResponse.json({ error: 'Failed to load agent config', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[admin/tenants/agent-config] GET error:', err);
    return NextResponse.json({ error: 'Failed to load agent config', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const { tenantId } = await ctx.params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const adm = await requireAdmin();
    if (!adm.ok) return adm.res;

    let body: { monthlyBudget?: number | null; rateLimitPerHour?: number | null; perCallCeiling?: number | null };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    const budgetProvided = 'monthlyBudget' in body;
    const rateProvided = 'rateLimitPerHour' in body;
    const ceilingProvided = 'perCallCeiling' in body;
    if (!budgetProvided && !rateProvided && !ceilingProvided) {
      return NextResponse.json({ error: 'No valid fields to update', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Validate ─────────────────────────────────────────────────
    let budgetVal: number | null = null;
    if (budgetProvided) {
      const b = body.monthlyBudget;
      if (b !== null) {
        if (typeof b !== 'number' || !Number.isFinite(b) || b < 0 || b > MAX_BUDGET) {
          return NextResponse.json(
            { error: `monthlyBudget must be a number between 0 and ${MAX_BUDGET}, or null to inherit`, code: 'VALIDATION_ERROR' },
            { status: 422 },
          );
        }
        budgetVal = Math.round(b * 100) / 100;
      }
    }
    let rateVal: number | null = null;
    if (rateProvided) {
      const r = body.rateLimitPerHour;
      if (r !== null) {
        if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > MAX_RATE) {
          return NextResponse.json(
            { error: `rateLimitPerHour must be an integer between 1 and ${MAX_RATE}, or null to inherit`, code: 'VALIDATION_ERROR' },
            { status: 422 },
          );
        }
        rateVal = r;
      }
    }
    let ceilingVal: number | null = null;
    if (ceilingProvided) {
      const c = body.perCallCeiling;
      if (c !== null) {
        if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0 || c > MAX_CEILING) {
          return NextResponse.json(
            { error: `perCallCeiling must be a number between 0 (exclusive) and ${MAX_CEILING}, or null to inherit`, code: 'VALIDATION_ERROR' },
            { status: 422 },
          );
        }
        ceilingVal = Math.round(c * 10000) / 10000;
      }
    }

    try {
      // Verify tenant exists.
      const [existing] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE id = ${tenantId}::uuid`;
      if (!existing) {
        return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      const startId = await emitEventStart({
        namespace: 'finder',
        type: 'agent_config.updated',
        actor: userActor(adm.userId),
        tenantId: null, // admin event
        payload: { tenantId, fields: Object.keys(body) },
      });

      // Ensure a row exists (inherit-everything by default), then update only
      // the provided fields so PATCH semantics don't clobber the others.
      await sql`
        INSERT INTO tenant_agent_config (tenant_id, monthly_budget, rate_limit_per_hour, per_call_ceiling)
        VALUES (${tenantId}::uuid, NULL, NULL, NULL)
        ON CONFLICT (tenant_id) DO NOTHING
      `;

      const setClauses = [];
      if (budgetProvided) setClauses.push(sql`monthly_budget = ${budgetVal}`);
      if (rateProvided) setClauses.push(sql`rate_limit_per_hour = ${rateVal}`);
      if (ceilingProvided) setClauses.push(sql`per_call_ceiling = ${ceilingVal}`);
      setClauses.push(sql`updated_at = now()`);
      const setFragment = setClauses.reduce((acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`));

      const [updated] = await sql<{ monthlyBudget: string | null; rateLimitPerHour: number | null; perCallCeiling: string | null }[]>`
        UPDATE tenant_agent_config
        SET ${setFragment}
        WHERE tenant_id = ${tenantId}::uuid
        RETURNING monthly_budget, rate_limit_per_hour, per_call_ceiling
      `;

      await emitEventEnd(startId, { result: { tenantId, updatedFields: Object.keys(body) } });

      return NextResponse.json({
        data: {
          tenantId,
          monthlyBudget: updated?.monthlyBudget != null ? parseFloat(updated.monthlyBudget) : null,
          rateLimitPerHour: updated?.rateLimitPerHour ?? null,
          perCallCeiling: updated?.perCallCeiling != null ? parseFloat(updated.perCallCeiling) : null,
        },
      });
    } catch (dbErr) {
      console.error('[admin/tenants/agent-config] PATCH DB error:', dbErr);
      return NextResponse.json({ error: 'Failed to update agent config', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[admin/tenants/agent-config] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update agent config', code: 'DB_ERROR' }, { status: 500 });
  }
}
