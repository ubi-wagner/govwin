/**
 * GET /api/admin/agents — Agent monitoring dashboard
 *
 * Returns cross-tenant agent metrics: task queue depth, active tasks,
 * failed tasks, memory counts per agent archetype.
 *
 * Auth: master_admin or rfp_admin.
 *
 * V1 TODO (P2-21): Implement agent monitoring queries.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET() {
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
      role?: unknown;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // TODO: Implement agent monitoring
    //
    // 1. Task queue summary:
    //    SELECT status, count(*)::int AS count
    //    FROM agent_task_queue GROUP BY status
    //
    // 2. Tasks by agent role:
    //    SELECT agent_role, status, count(*)::int AS count
    //    FROM agent_task_queue GROUP BY agent_role, status
    //
    // 3. Memory counts by type:
    //    SELECT agent_role, memory_type, count(*)::int AS count
    //    FROM agent_memories GROUP BY agent_role, memory_type
    //
    // 4. Recent failures (last 10):
    //    SELECT id, agent_role, tool_name, error_message, created_at
    //    FROM agent_task_queue WHERE status = 'failed'
    //    ORDER BY created_at DESC LIMIT 10

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-21',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[admin/agents] error:', err);
    return NextResponse.json(
      { error: 'Agent query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
