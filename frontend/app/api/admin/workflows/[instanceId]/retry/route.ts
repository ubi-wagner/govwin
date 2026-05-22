/**
 * POST /api/admin/workflows/[instanceId]/retry — Retry a failed instance
 *
 * Creates a new process_instance that recovers from the failed one.
 * Previously completed steps are preserved; execution resumes from
 * the first non-completed step.
 *
 * Auth: master_admin or rfp_admin.
 *
 * Returns: { data: { newInstanceId } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
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

    const actorEmail = sessionUser.email ?? 'unknown';

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

    // ── Fetch the failed instance ────────────────────────────────
    const instances = await sql<{
      id: string;
      workflowName: string;
      triggerEventId: string | null;
      payload: Record<string, unknown> | null;
      tenantId: string | null;
      actorId: string | null;
      actorEmail: string | null;
      stepResults: Record<string, unknown> | null;
      stepStatus: Record<string, string> | null;
      retryCount: number;
      maxRetries: number;
      source: string;
      status: string;
    }[]>`
      SELECT id, workflow_name, trigger_event_id, payload,
             tenant_id, actor_id, actor_email,
             step_results, step_status, retry_count, max_retries,
             source, status
      FROM process_instances
      WHERE id = ${instanceId}::uuid
        AND status IN ('failed', 'cancelled')
    `;

    if (instances.length === 0) {
      return NextResponse.json(
        { error: 'Instance not found or not retryable (must be failed or cancelled)', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const original = instances[0];

    // Check retry limit
    if (original.retryCount >= original.maxRetries) {
      return NextResponse.json(
        { error: `Max retries (${original.maxRetries}) exceeded`, code: 'CONFLICT' },
        { status: 409 },
      );
    }

    // ── Create recovery instance ─────────────────────────────────
    const newInstances = await sql<{ id: string }[]>`
      INSERT INTO process_instances
        (workflow_name, trigger_event_id, status, payload,
         tenant_id, actor_id, actor_email, source,
         step_results, step_status, retry_count, recovered_from,
         deadline)
      VALUES (
        ${original.workflowName},
        ${null},
        'retrying',
        ${JSON.stringify(original.payload ?? {})}::jsonb,
        ${original.tenantId},
        ${original.actorId},
        ${original.actorEmail},
        ${original.source},
        ${JSON.stringify(original.stepResults ?? {})}::jsonb,
        ${JSON.stringify(original.stepStatus ?? {})}::jsonb,
        ${original.retryCount + 1},
        ${instanceId}::uuid,
        now() + interval '1 hour'
      )
      RETURNING id
    `;

    const newId = newInstances[0].id;

    // Record transition audit
    await sql`
      INSERT INTO process_instance_transitions
        (instance_id, from_status, to_status, actor, reason, metadata)
      VALUES (
        ${newId}::uuid,
        NULL,
        'retrying',
        ${'admin:' + actorEmail},
        ${'retry_from:' + instanceId},
        '{}'::jsonb
      )
    `;

    return NextResponse.json({
      data: { newInstanceId: newId },
    }, { status: 201 });
  } catch (err) {
    console.error('[admin/workflows/[instanceId]/retry] error:', err);
    return NextResponse.json(
      { error: 'Retry failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
