/**
 * POST /api/admin/workflows/[instanceId]/cancel — Cancel a running/paused instance
 *
 * Sets the instance status to 'cancelled' and records the transition.
 *
 * Auth: master_admin or rfp_admin.
 *
 * Returns: { data: { success: true } }
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

    // ── Cancel the instance (transactional) ──────────────────────
    const cancelResult = await sql.begin(async (tx: any) => {
      const updated = await tx<{ id: string; status: string }[]>`
        UPDATE process_instances
        SET status = 'cancelled', completed_at = now()
        WHERE id = ${instanceId}::uuid
          AND status IN ('running', 'paused', 'pending', 'retrying')
        RETURNING id, status
      `;

      if (updated.length === 0) {
        return { found: false as const };
      }

      // Record transition audit
      await tx`
        INSERT INTO process_instance_transitions
          (instance_id, from_status, to_status, actor, reason, metadata)
        VALUES (
          ${instanceId}::uuid,
          NULL,
          'cancelled',
          ${'admin:' + actorEmail},
          'manual_cancellation',
          '{}'::jsonb
        )
      `;

      return { found: true as const };
    });

    if (!cancelResult.found) {
      return NextResponse.json(
        { error: 'Instance not found or not cancellable (must be running, paused, pending, or retrying)', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: { success: true },
    });
  } catch (err) {
    console.error('[admin/workflows/[instanceId]/cancel] error:', err);
    return NextResponse.json(
      { error: 'Cancel failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
