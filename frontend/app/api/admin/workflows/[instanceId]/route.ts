/**
 * GET /api/admin/workflows/[instanceId] — Get instance detail with transitions
 *
 * Auth: master_admin or rfp_admin.
 *
 * Returns: { data: { instance, transitions } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────
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

    // ── Parse params ─────────────────────────────────────────────
    const { instanceId } = await ctx.params;
    if (!instanceId || typeof instanceId !== 'string') {
      return NextResponse.json(
        { error: 'Missing instanceId', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(instanceId)) {
      return NextResponse.json(
        { error: 'Invalid instanceId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Fetch instance ───────────────────────────────────────────
    const instances = await sql<{
      id: string;
      workflowName: string;
      triggerEventId: string | null;
      correlationId: string;
      status: string;
      currentStep: string | null;
      currentStepIndex: number;
      stepResults: Record<string, unknown> | null;
      stepStatus: Record<string, string> | null;
      startedAt: string | null;
      completedAt: string | null;
      lastHeartbeatAt: string | null;
      deadline: string | null;
      retryCount: number;
      maxRetries: number;
      lastError: string | null;
      lastErrorStep: string | null;
      recoveredFrom: string | null;
      tenantId: string | null;
      actorId: string | null;
      actorEmail: string | null;
      payload: Record<string, unknown> | null;
      source: string;
      createdAt: string;
      updatedAt: string;
    }[]>`
      SELECT id, workflow_name, trigger_event_id, correlation_id,
             status, current_step, current_step_index,
             step_results, step_status,
             started_at, completed_at, last_heartbeat_at, deadline,
             retry_count, max_retries, last_error, last_error_step,
             recovered_from, tenant_id, actor_id, actor_email,
             payload, source, created_at, updated_at
      FROM process_instances
      WHERE id = ${instanceId}::uuid
    `;

    if (instances.length === 0) {
      return NextResponse.json(
        { error: 'Instance not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Fetch transitions ────────────────────────────────────────
    const transitions = await sql<{
      id: string;
      instanceId: string;
      fromStatus: string | null;
      toStatus: string;
      stepName: string | null;
      actor: string | null;
      reason: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: string;
    }[]>`
      SELECT id, instance_id, from_status, to_status, step_name,
             actor, reason, metadata, created_at
      FROM process_instance_transitions
      WHERE instance_id = ${instanceId}::uuid
      ORDER BY created_at ASC
    `;

    return NextResponse.json({
      data: {
        instance: instances[0],
        transitions,
      },
    });
  } catch (err) {
    console.error('[admin/workflows/[instanceId]] error:', err);
    return NextResponse.json(
      { error: 'Instance query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
