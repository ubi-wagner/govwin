/**
 * GET /api/admin/workflows — List workflow instances (active + recent)
 *
 * Query params:
 *   - status: filter by status (optional)
 *   - hours: lookback window for recent instances (default 24)
 *   - limit: max results per category (default 50)
 *
 * Auth: master_admin or rfp_admin.
 *
 * Returns: { data: { active: ProcessInstance[], recent: ProcessInstance[] } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET(request: Request) {
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

    // ── Parse query params ───────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');
    const hours = Math.min(Math.max(parseInt(searchParams.get('hours') ?? '24', 10) || 24, 1), 168);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1), 200);

    // Validate statusFilter
    const VALID_STATUSES = ['pending', 'running', 'paused', 'retrying', 'completed', 'failed', 'cancelled'] as const;
    if (statusFilter && !(VALID_STATUSES as readonly string[]).includes(statusFilter)) {
      return NextResponse.json(
        { error: `Invalid status filter. Must be one of: ${VALID_STATUSES.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Active instances ─────────────────────────────────────────
    const active = statusFilter
      ? await sql<{
          id: string;
          workflowName: string;
          status: string;
          currentStep: string | null;
          currentStepIndex: number;
          startedAt: string | null;
          lastHeartbeatAt: string | null;
          tenantId: string | null;
          source: string;
          stepStatus: Record<string, string> | null;
          retryCount: number;
          lastError: string | null;
        }[]>`
          SELECT id, workflow_name, status, current_step, current_step_index,
                 started_at, last_heartbeat_at, tenant_id, source,
                 step_status, retry_count, last_error
          FROM process_instances
          WHERE status = ${statusFilter}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql<{
          id: string;
          workflowName: string;
          status: string;
          currentStep: string | null;
          currentStepIndex: number;
          startedAt: string | null;
          lastHeartbeatAt: string | null;
          tenantId: string | null;
          source: string;
          stepStatus: Record<string, string> | null;
          retryCount: number;
          lastError: string | null;
        }[]>`
          SELECT id, workflow_name, status, current_step, current_step_index,
                 started_at, last_heartbeat_at, tenant_id, source,
                 step_status, retry_count, last_error
          FROM process_instances
          WHERE status IN ('running', 'paused', 'pending', 'retrying')
          ORDER BY started_at DESC
          LIMIT ${limit}
        `;

    // ── Recent instances ─────────────────────────────────────────
    const recent = await sql<{
      id: string;
      workflowName: string;
      status: string;
      currentStep: string | null;
      startedAt: string | null;
      completedAt: string | null;
      tenantId: string | null;
      source: string;
      stepStatus: Record<string, string> | null;
      retryCount: number;
      lastError: string | null;
      lastErrorStep: string | null;
      recoveredFrom: string | null;
    }[]>`
      SELECT id, workflow_name, status, current_step,
             started_at, completed_at, tenant_id, source,
             step_status, retry_count, last_error, last_error_step,
             recovered_from
      FROM process_instances
      WHERE created_at > now() - ${hours + ' hours'}::interval
        AND status IN ('completed', 'failed', 'cancelled')
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      data: { active, recent },
    });
  } catch (err) {
    console.error('[admin/workflows] error:', err);
    return NextResponse.json(
      { error: 'Workflow query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
