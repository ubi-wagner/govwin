/**
 * GET   /api/admin/automation-framework — the platform automation framework (mig 126).
 * PATCH /api/admin/automation-framework — tune it (RFP-Pipeline admin only).
 *
 * The "this changes the framework" control plane (#190 §12, decision ⑦): the hard-to-tenant
 * defaults + ceilings the resolver resolves DOWN to — the curation SLA, max buckets, default
 * nudge cadence, and the agent budget CEILING (a tenant policy may only lower below it).
 * master_admin / rfp_admin only. Global config (no RLS).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import type { Role } from '@/lib/rbac';

interface FrameworkRow {
  curationSlaMinutes: number;
  defaultNudgeDays: number[];
  defaultDueInMinutes: number;
  maxBucketsPerTenant: number;
  maxNudgesPerGate: number;
  agentMonthlyBudgetCeilingUsd: string; // NUMERIC comes back as a string
  agentAutoRunDefault: boolean;
  overlayFrameworks: unknown;
  updatedAt: string;
}

async function requireAdmin(): Promise<
  | { ok: true; userId: string; email?: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, res: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: Role };
  if (u.role !== 'master_admin' && u.role !== 'rfp_admin') {
    return { ok: false, res: NextResponse.json({ error: 'RFP Pipeline admin access required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true, userId: u.id!, email: u.email };
}

export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  try {
    const [row] = await sql<FrameworkRow[]>`
      SELECT curation_sla_minutes AS "curationSlaMinutes", default_nudge_days AS "defaultNudgeDays",
             default_due_in_minutes AS "defaultDueInMinutes", max_buckets_per_tenant AS "maxBucketsPerTenant",
             max_nudges_per_gate AS "maxNudgesPerGate", agent_monthly_budget_ceiling_usd AS "agentMonthlyBudgetCeilingUsd",
             agent_auto_run_default AS "agentAutoRunDefault", overlay_frameworks AS "overlayFrameworks",
             updated_at AS "updatedAt"
      FROM automation_framework WHERE id = 1
    `;
    if (!row) return NextResponse.json({ error: 'Framework not initialized', code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ data: { framework: row } });
  } catch (e) {
    console.error('[automation-framework] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load framework', code: 'DB_ERROR' }, { status: 500 });
  }
}

// Bounded positive-int fields the resolver ACTUALLY enforces; guards keep the framework sane.
// default_due_in_minutes / default_nudge_days are the reserved lowest-tier fallback columns —
// shadowed by per-gate defaults today, so the resolver never reads them. They are intentionally
// NOT accepted here: persisting them was a silent no-op that read as an editable control
// (adversarial-sweep A2). GET still surfaces them read-only; wiring the tier is a future change.
const INT_FIELDS: Record<string, string> = {
  curationSlaMinutes: 'curation_sla_minutes',
  maxBucketsPerTenant: 'max_buckets_per_tenant',
  maxNudgesPerGate: 'max_nudges_per_gate',
};

export async function PATCH(request: Request) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
  }

  const sets: ReturnType<typeof sql>[] = [];
  for (const [field, col] of Object.entries(INT_FIELDS)) {
    if (field in body) {
      const v = body[field];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 525600) {
        return NextResponse.json({ error: `${field} must be a positive integer (minutes/count)`, code: 'VALIDATION_ERROR' }, { status: 422 });
      }
      sets.push(sql`${sql(col)} = ${Math.floor(v)}`);
    }
  }
  if ('agentMonthlyBudgetCeilingUsd' in body) {
    const v = Number(body.agentMonthlyBudgetCeilingUsd);
    // Must be > 0: a 0 ceiling would cap every tenant's budget to $0 and silently
    // disable ALL agents platform-wide (found by the #190 adversarial sweep). To turn
    // agents off, use agentAutoRunDefault / the per-trigger enable, not the ceiling.
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ error: 'agentMonthlyBudgetCeilingUsd must be greater than 0 (use the auto-run toggle to disable agents)', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    sets.push(sql`agent_monthly_budget_ceiling_usd = ${v}`);
  }
  if ('agentAutoRunDefault' in body) {
    if (typeof body.agentAutoRunDefault !== 'boolean') {
      return NextResponse.json({ error: 'agentAutoRunDefault must be a boolean', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    sets.push(sql`agent_auto_run_default = ${body.agentAutoRunDefault}`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No valid framework fields to update', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    sets.push(sql`updated_by = ${a.userId}::uuid`);
    const setFragment = sets.reduce((acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`));
    const [row] = await sql<FrameworkRow[]>`
      UPDATE automation_framework SET ${setFragment} WHERE id = 1
      RETURNING curation_sla_minutes AS "curationSlaMinutes", default_nudge_days AS "defaultNudgeDays",
                default_due_in_minutes AS "defaultDueInMinutes", max_buckets_per_tenant AS "maxBucketsPerTenant",
                max_nudges_per_gate AS "maxNudgesPerGate", agent_monthly_budget_ceiling_usd AS "agentMonthlyBudgetCeilingUsd",
                agent_auto_run_default AS "agentAutoRunDefault", overlay_frameworks AS "overlayFrameworks",
                updated_at AS "updatedAt"
    `;
    try {
      await emitEventSingle({
        namespace: 'system', type: 'automation_framework.updated',
        actor: { type: 'user', id: a.userId, email: a.email ?? undefined },
        tenantId: null, // admin/platform event
        payload: { fields: sets.length - 1 },
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ data: { framework: row } });
  } catch (e) {
    console.error('[automation-framework] PATCH failed:', e);
    return NextResponse.json({ error: 'Failed to save framework', code: 'DB_ERROR' }, { status: 500 });
  }
}
