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
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql, enterBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { launchTemplate } from '@/lib/process/launch-template';

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
    const rawStatus = searchParams.get('status');
    // Archived view (opt-in): `?archived=1` (or `?status=archived`) surfaces soft-archived
    // instances (archived_at IS NOT NULL) that the default active views hide. (docs/ARCHIVABLE_CONTRACT.md)
    const archivedParam = (searchParams.get('archived') ?? '').toLowerCase();
    const showArchived =
      archivedParam === '1' || archivedParam === 'true' || archivedParam === 'yes' || rawStatus === 'archived';
    // In the archived view the status filter does not apply.
    const statusFilter = showArchived ? null : rawStatus;
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

    // ── Archived view (opt-in) ───────────────────────────────────
    // Soft-archived instances, most-recently-archived first, returned in the `recent` slot so the
    // monitor's Archived toggle can render + restore them. `active` is empty in this view.
    if (showArchived) {
      const archived = await sql<{
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
        archivedAt: string | null;
      }[]>`
        SELECT id, workflow_name, status, current_step,
               started_at, completed_at, tenant_id, source,
               step_status, retry_count, last_error, last_error_step,
               recovered_from, archived_at
        FROM process_instances
        WHERE archived_at IS NOT NULL
        ORDER BY archived_at DESC
        LIMIT ${limit}
      `;
      return NextResponse.json({ data: { active: [], recent: archived } });
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
            AND archived_at IS NULL
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
            AND archived_at IS NULL
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
        AND archived_at IS NULL
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

/**
 * POST /api/admin/workflows — Launch a process template by name with an overlay.
 *
 * Body: { workflowName: string, overlay?: object, tenantId?: string | null }
 * Auth: master_admin or rfp_admin.
 *
 * Emits the template's trigger event with the overlay as payload; the pipeline
 * creates the process_instance (overlay frozen) on its next poll. Returns the
 * trigger event id for correlation — NOT an instance id (creation is async).
 *
 * Returns: { data: { eventId, workflowName, trigger } } | { error, code }
 */
export async function POST(request: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string | null;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    // Cross-tenant helper (launchTemplate) uses global sql — route it to the owner pool. (docs/RLS_CUTOVER.md)
    enterBypass();

    // ── Validate input ────────────────────────────────────────────
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
    const overlay =
      b.overlay && typeof b.overlay === 'object' && !Array.isArray(b.overlay)
        ? (b.overlay as Record<string, unknown>)
        : {};
    const tenantId = typeof b.tenantId === 'string' ? b.tenantId : null;

    // ── Launch ────────────────────────────────────────────────────
    const result = await launchTemplate({
      workflowName,
      overlay,
      actor: {
        id: sessionUser.id ?? '',
        email: sessionUser.email ?? null,
        role,
        tenantId: sessionUser.tenantId ?? null,
      },
      tenantId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      );
    }
    return NextResponse.json({ data: result.data });
  } catch (err) {
    console.error('[admin/workflows POST] error:', err);
    return NextResponse.json(
      { error: 'Launch failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
