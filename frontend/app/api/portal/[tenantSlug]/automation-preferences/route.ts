/**
 * GET   /api/portal/[tenantSlug]/automation-preferences — the tenant's automation choices
 * PATCH /api/portal/[tenantSlug]/automation-preferences — set them (customer admin)
 *
 * The customer admin's automation setup (configured at portal purchase, editable
 * later). Gates the milestone automations driven by the emitted proposal events.
 * Auth: tenant_admin or above with tenant access.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

// The settable boolean toggles (snake_case DB column ⇄ camelCase API field).
const TOGGLES: Record<string, string> = {
  notifyTeamOnDocumentLocked: 'notify_team_on_document_locked',
  notifyCollaboratorsGetReady: 'notify_collaborators_get_ready',
  notifyOnStageAdvanced: 'notify_on_stage_advanced',
  notifyOnNewPriorityOpp: 'notify_on_new_priority_opp',
  aiReviewOnAdvance: 'ai_review_on_advance',
  autoAdvanceWhenAllLocked: 'auto_advance_when_all_locked',
};

const DEFAULTS = {
  notifyTeamOnDocumentLocked: true,
  notifyCollaboratorsGetReady: true,
  notifyOnStageAdvanced: true,
  notifyOnNewPriorityOpp: true,
  aiReviewOnAdvance: true,
  autoAdvanceWhenAllLocked: false,
};

interface PrefRow {
  notifyTeamOnDocumentLocked: boolean;
  notifyCollaboratorsGetReady: boolean;
  notifyOnStageAdvanced: boolean;
  notifyOnNewPriorityOpp: boolean;
  aiReviewOnAdvance: boolean;
  autoAdvanceWhenAllLocked: boolean;
  configuredAt: string | null;
}

async function resolveCtx(ctx: RouteContext): Promise<
  | { ok: true; tenantId: string; userId: string; email?: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; email?: string; role?: unknown };
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
  const hasAccess = await verifyTenantAccess(u.id, role, tenantId);
  if (!hasAccess) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true, tenantId, userId: u.id, email: u.email };
}

export async function GET(_request: Request, ctx: RouteContext) {
  const r = await resolveCtx(ctx);
  if (!r.ok) return r.res;

  try {
    const [row] = await sql<PrefRow[]>`
      SELECT notify_team_on_document_locked, notify_collaborators_get_ready,
             notify_on_stage_advanced, notify_on_new_priority_opp,
             ai_review_on_advance, auto_advance_when_all_locked, configured_at
      FROM tenant_automation_preferences
      WHERE tenant_id = ${r.tenantId}::uuid
    `;
    return NextResponse.json({
      data: {
        preferences: row ?? DEFAULTS,
        configured: !!row?.configuredAt,
      },
    });
  } catch (e) {
    console.error('[portal/automation-preferences] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load preferences', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const r = await resolveCtx(ctx);
  if (!r.ok) return r.res;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
  }

  // Collect only the recognized booleans that were provided.
  const provided: Array<[string, boolean]> = [];
  for (const [field, col] of Object.entries(TOGGLES)) {
    if (field in body) {
      if (typeof body[field] !== 'boolean') {
        return NextResponse.json({ error: `${field} must be a boolean`, code: 'VALIDATION_ERROR' }, { status: 422 });
      }
      provided.push([col, body[field] as boolean]);
    }
  }
  if (provided.length === 0) {
    return NextResponse.json({ error: 'No valid preference fields to update', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    // Ensure a row exists (defaults), then update the provided fields + mark configured.
    await sql`
      INSERT INTO tenant_automation_preferences (tenant_id)
      VALUES (${r.tenantId}::uuid)
      ON CONFLICT (tenant_id) DO NOTHING
    `;
    const setClauses = provided.map(([col, val]) => sql`${sql(col)} = ${val}`);
    setClauses.push(sql`configured_at = now()`);
    setClauses.push(sql`updated_at = now()`);
    const setFragment = setClauses.reduce((acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`));

    const [row] = await sql<PrefRow[]>`
      UPDATE tenant_automation_preferences
      SET ${setFragment}
      WHERE tenant_id = ${r.tenantId}::uuid
      RETURNING notify_team_on_document_locked, notify_collaborators_get_ready,
                notify_on_stage_advanced, notify_on_new_priority_opp,
                ai_review_on_advance, auto_advance_when_all_locked, configured_at
    `;

    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'automation_preferences.updated',
        actor: userActor(r.userId, r.email),
        tenantId: r.tenantId,
        payload: { fields: provided.map(([c]) => c) },
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ data: { preferences: row, configured: true } });
  } catch (e) {
    console.error('[portal/automation-preferences] PATCH failed:', e);
    return NextResponse.json({ error: 'Failed to save preferences', code: 'DB_ERROR' }, { status: 500 });
  }
}
