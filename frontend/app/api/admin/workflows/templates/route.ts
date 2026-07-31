/**
 * GET  /api/admin/workflows/templates — the workflow TEMPLATE CATALOG.
 * PATCH /api/admin/workflows/templates — toggle a template active/inactive (audited).
 *
 * The catalog (process_templates) is the roster of every workflow the running build
 * defines — code is the source of truth, reflected here by the pipeline's boot-time
 * sync_template_catalog. This surface lets an admin SEE the full roster (not just live
 * instances) and flip the activation switch that gates whether new instances launch.
 *
 * Each row is joined to a per-template instance rollup (running/paused/completed/failed)
 * so the admin sees, at a glance, which templates are firing and how they're faring.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const sessionUser = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // Catalog + per-template instance rollup. Counts cast ::int (postgres.js returns
    // int8 as a string). last_launched_at gives recency even for never-active templates.
    const templates = await sql<{
      workflowName: string;
      description: string | null;
      triggerKey: string | null;
      source: string | null;
      active: boolean;
      activeDate: string | null;
      inactiveDate: string | null;
      inactivatedBy: string | null;
      lastSeenAt: string | null;
      running: number;
      paused: number;
      completed: number;
      failed: number;
      total: number;
      lastLaunchedAt: string | null;
    }[]>`
      SELECT t.workflow_name,
             t.description,
             t.trigger_key,
             t.source,
             t.active,
             t.active_date,
             t.inactive_date,
             t.inactivated_by,
             t.last_seen_at,
             COALESCE(i.running, 0)::int   AS running,
             COALESCE(i.paused, 0)::int    AS paused,
             COALESCE(i.completed, 0)::int AS completed,
             COALESCE(i.failed, 0)::int    AS failed,
             COALESCE(i.total, 0)::int     AS total,
             i.last_launched_at
      FROM process_templates t
      LEFT JOIN (
        SELECT workflow_name,
               count(*) FILTER (WHERE status IN ('running', 'pending', 'retrying')) AS running,
               count(*) FILTER (WHERE status = 'paused')                            AS paused,
               count(*) FILTER (WHERE status = 'completed')                         AS completed,
               count(*) FILTER (WHERE status = 'failed')                            AS failed,
               count(*)                                                             AS total,
               max(created_at)                                                      AS last_launched_at
        FROM process_instances
        GROUP BY workflow_name
      ) i ON i.workflow_name = t.workflow_name
      ORDER BY t.active DESC, t.workflow_name ASC
    `;

    return NextResponse.json({ data: { templates } });
  } catch (err) {
    console.error('[admin/workflows/templates GET] error:', err);
    return NextResponse.json(
      { error: 'Template catalog query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const sessionUser = session.user as { id?: string; email?: string | null; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const workflowName = typeof b.workflowName === 'string' ? b.workflowName.trim() : '';
    if (!workflowName) {
      return NextResponse.json(
        { error: 'workflowName is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (typeof b.active !== 'boolean') {
      return NextResponse.json(
        { error: 'active must be a boolean', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const active = b.active;
    const actorEmail = sessionUser.email ?? null;

    // Flip the activation switch + stamp the audit columns. Deactivation records who and
    // when (inactivated_by / inactive_date); reactivation clears them and stamps active_date.
    // Two explicit branches (clearer than a CASE, no fragment-interpolation ambiguity).
    let updated: { workflowName: string; active: boolean } | undefined;
    try {
      if (active) {
        [updated] = await sql<{ workflowName: string; active: boolean }[]>`
          UPDATE process_templates
          SET active = true, active_date = now(), inactive_date = NULL,
              inactivated_by = NULL, updated_at = now()
          WHERE workflow_name = ${workflowName}
          RETURNING workflow_name, active
        `;
      } else {
        [updated] = await sql<{ workflowName: string; active: boolean }[]>`
          UPDATE process_templates
          SET active = false, inactive_date = now(),
              inactivated_by = ${actorEmail}, updated_at = now()
          WHERE workflow_name = ${workflowName}
          RETURNING workflow_name, active
        `;
      }
    } catch (dbErr) {
      console.error('[admin/workflows/templates PATCH] update failed:', dbErr);
      return NextResponse.json(
        { error: 'Template update failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Template not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Audit the toggle into the unified event stream (admin action → tenantId null).
    // Best-effort: emission never blocks the state change (emitEventSingle never throws).
    await emitEventSingle({
      namespace: 'finder',
      type: active ? 'process_template.activated' : 'process_template.deactivated',
      actor: userActor(sessionUser.id ?? '', actorEmail ?? undefined),
      tenantId: null,
      payload: { workflowName },
    });

    return NextResponse.json({ data: { workflowName: updated.workflowName, active: updated.active } });
  } catch (err) {
    console.error('[admin/workflows/templates PATCH] error:', err);
    return NextResponse.json(
      { error: 'Template toggle failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
