/**
 * GET   /api/admin/agents/platform-config — pipeline-wide AI defaults + cap
 * PATCH /api/admin/agents/platform-config — set defaults / cap / master switch
 *
 * The singleton platform_agent_config row that governs the RFP pipeline itself:
 *   - default_monthly_budget / default_rate_limit_per_hour — applied to any
 *     tenant without an explicit override
 *   - platform_monthly_cap — hard ceiling on TOTAL monthly AI spend across all
 *     tenants + admin/system (NULL = off)
 *   - ai_enabled — master on/off switch for the whole agent workforce
 *
 * Auth: master_admin only (pipeline-wide controls + kill switch).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

const MAX_BUDGET = 100_000;
const MAX_RATE = 100_000;
const MAX_CAP = 10_000_000;

async function requireMasterAdmin(): Promise<
  | { ok: true; userId: string }
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
  if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'master_admin')) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Master admin access required', code: 'FORBIDDEN' }, { status: 403 }),
    };
  }
  return { ok: true, userId: sessionUser.id };
}

interface PlatformRow {
  defaultMonthlyBudget: string | null;
  defaultRateLimitPerHour: number | null;
  platformMonthlyCap: string | null;
  aiEnabled: boolean | null;
}

function serialize(row: PlatformRow | undefined) {
  return {
    defaultMonthlyBudget: row?.defaultMonthlyBudget != null ? parseFloat(row.defaultMonthlyBudget) : 50,
    defaultRateLimitPerHour: row?.defaultRateLimitPerHour ?? 50,
    platformMonthlyCap: row?.platformMonthlyCap != null ? parseFloat(row.platformMonthlyCap) : null,
    aiEnabled: row?.aiEnabled ?? true,
  };
}

export async function GET() {
  try {
    const adm = await requireMasterAdmin();
    if (!adm.ok) return adm.res;

    try {
      const [row] = await sql<PlatformRow[]>`
        SELECT default_monthly_budget, default_rate_limit_per_hour,
               platform_monthly_cap, ai_enabled
        FROM platform_agent_config
        WHERE id = TRUE
      `;
      return NextResponse.json({ data: serialize(row) });
    } catch (dbErr) {
      console.error('[admin/agents/platform-config] GET DB error:', dbErr);
      return NextResponse.json({ error: 'Failed to load platform config', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[admin/agents/platform-config] GET error:', err);
    return NextResponse.json({ error: 'Failed to load platform config', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const adm = await requireMasterAdmin();
    if (!adm.ok) return adm.res;

    let body: {
      defaultMonthlyBudget?: number;
      defaultRateLimitPerHour?: number;
      platformMonthlyCap?: number | null;
      aiEnabled?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    const setClauses = [];

    if ('defaultMonthlyBudget' in body) {
      const b = body.defaultMonthlyBudget;
      if (typeof b !== 'number' || !Number.isFinite(b) || b < 0 || b > MAX_BUDGET) {
        return NextResponse.json(
          { error: `defaultMonthlyBudget must be a number between 0 and ${MAX_BUDGET}`, code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
      setClauses.push(sql`default_monthly_budget = ${Math.round(b * 100) / 100}`);
    }
    if ('defaultRateLimitPerHour' in body) {
      const r = body.defaultRateLimitPerHour;
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > MAX_RATE) {
        return NextResponse.json(
          { error: `defaultRateLimitPerHour must be an integer between 1 and ${MAX_RATE}`, code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
      setClauses.push(sql`default_rate_limit_per_hour = ${r}`);
    }
    if ('platformMonthlyCap' in body) {
      const c = body.platformMonthlyCap;
      if (c !== null) {
        if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > MAX_CAP) {
          return NextResponse.json(
            { error: `platformMonthlyCap must be a number between 0 and ${MAX_CAP}, or null to disable`, code: 'VALIDATION_ERROR' },
            { status: 422 },
          );
        }
        setClauses.push(sql`platform_monthly_cap = ${Math.round(c * 100) / 100}`);
      } else {
        setClauses.push(sql`platform_monthly_cap = ${null}`);
      }
    }
    if ('aiEnabled' in body) {
      if (typeof body.aiEnabled !== 'boolean') {
        return NextResponse.json(
          { error: 'aiEnabled must be a boolean', code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
      setClauses.push(sql`ai_enabled = ${body.aiEnabled}`);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    try {
      const startId = await emitEventStart({
        namespace: 'system',
        type: 'platform_agent_config.updated',
        actor: userActor(adm.userId),
        tenantId: null,
        payload: { fields: Object.keys(body) },
      });

      setClauses.push(sql`updated_by = ${adm.userId}::uuid`);
      setClauses.push(sql`updated_at = now()`);
      const setFragment = setClauses.reduce((acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`));

      // The singleton is seeded by migration 072; UPDATE the one row. Fall back
      // to an INSERT only if the row is somehow absent.
      const updatedRows = await sql<PlatformRow[]>`
        UPDATE platform_agent_config
        SET ${setFragment}
        WHERE id = TRUE
        RETURNING default_monthly_budget, default_rate_limit_per_hour, platform_monthly_cap, ai_enabled
      `;
      let row: PlatformRow | undefined = updatedRows[0];

      if (!row) {
        const insertedRows = await sql<PlatformRow[]>`
          INSERT INTO platform_agent_config
            (id, default_monthly_budget, default_rate_limit_per_hour, platform_monthly_cap, ai_enabled, updated_by)
          VALUES (
            TRUE,
            ${body.defaultMonthlyBudget ?? 50},
            ${body.defaultRateLimitPerHour ?? 50},
            ${body.platformMonthlyCap ?? null},
            ${body.aiEnabled ?? true},
            ${adm.userId}::uuid
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING default_monthly_budget, default_rate_limit_per_hour, platform_monthly_cap, ai_enabled
        `;
        row = insertedRows[0];
      }

      await emitEventEnd(startId, { result: { updatedFields: Object.keys(body) } });

      return NextResponse.json({ data: serialize(row) });
    } catch (dbErr) {
      console.error('[admin/agents/platform-config] PATCH DB error:', dbErr);
      return NextResponse.json({ error: 'Failed to update platform config', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[admin/agents/platform-config] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update platform config', code: 'DB_ERROR' }, { status: 500 });
  }
}
