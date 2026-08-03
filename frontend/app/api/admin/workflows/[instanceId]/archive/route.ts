/**
 * POST /api/admin/workflows/[instanceId]/archive — Soft-archive / restore a workflow instance
 *
 *   { action: 'archive' } → set archived_at = now()  (compare-and-swap on archived_at IS NULL).
 *   { action: 'restore' } → set archived_at = NULL    (compare-and-swap on archived_at IS NOT NULL).
 *
 * Archive is a soft, reversible visibility state (docs/ARCHIVABLE_CONTRACT.md): it hides a terminal
 * instance from the admin workflow monitor's active views while keeping the row in indexed Postgres.
 * It is NOT a delete. Every active-view query on process_instances filters `archived_at IS NULL`; the
 * monitor's opt-in `?archived=1` view surfaces archived rows for restore.
 *
 * Auth: master_admin or rfp_admin (platform artifact).
 *
 * Returns: { data: { archived: true } } | { data: { restored: true } } | { error, code }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Parse params ─────────────────────────────────────────────
    const { instanceId } = await ctx.params;
    if (!instanceId || typeof instanceId !== 'string') {
      return NextResponse.json(
        { error: 'Missing instanceId', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(instanceId)) {
      return NextResponse.json(
        { error: 'Invalid instanceId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Parse body ───────────────────────────────────────────────
    let body: { action?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (body.action !== 'archive' && body.action !== 'restore') {
      return NextResponse.json(
        { error: "action must be 'archive' or 'restore'", code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Archive / restore (compare-and-swap on archived_at) ──────
    try {
      if (body.action === 'archive') {
        // 409 if nothing updated (already archived or unknown id).
        const updated = await sql<{ id: string; tenantId: string | null; workflowName: string }[]>`
          UPDATE process_instances
          SET archived_at = now()
          WHERE id = ${instanceId}::uuid AND archived_at IS NULL
          RETURNING id, tenant_id, workflow_name
        `;
        if (updated.length === 0) {
          return NextResponse.json(
            { error: 'Instance not found or already archived', code: 'CONFLICT' },
            { status: 409 },
          );
        }
        try {
          await emitEventSingle({
            namespace: 'system',
            type: 'workflow.archived',
            actor: userActor(sessionUser.id as string, sessionUser.email),
            tenantId: updated[0].tenantId ?? null,
            payload: { instanceId, workflowName: updated[0].workflowName },
          });
        } catch (e) {
          console.error('[admin/workflows/archive] event emission failed:', e);
        }
        return NextResponse.json({ data: { archived: true } });
      }

      // restore — 409 if nothing updated (not archived or unknown id).
      const updated = await sql<{ id: string; tenantId: string | null; workflowName: string }[]>`
        UPDATE process_instances
        SET archived_at = NULL
        WHERE id = ${instanceId}::uuid AND archived_at IS NOT NULL
        RETURNING id, tenant_id, workflow_name
      `;
      if (updated.length === 0) {
        return NextResponse.json(
          { error: 'Instance not found or not archived (nothing to restore)', code: 'CONFLICT' },
          { status: 409 },
        );
      }
      try {
        await emitEventSingle({
          namespace: 'system',
          type: 'workflow.restored',
          actor: userActor(sessionUser.id as string, sessionUser.email),
          tenantId: updated[0].tenantId ?? null,
          payload: { instanceId, workflowName: updated[0].workflowName },
        });
      } catch (e) {
        console.error('[admin/workflows/archive] event emission failed:', e);
      }
      return NextResponse.json({ data: { restored: true } });
    } catch (e) {
      console.error('[admin/workflows/archive] action failed:', e);
      return NextResponse.json(
        { error: 'Archive action failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[admin/workflows/[instanceId]/archive] error:', err);
    return NextResponse.json(
      { error: 'Archive failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
