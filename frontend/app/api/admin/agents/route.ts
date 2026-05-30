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

    try {
      // 1. Task queue summary by status
      const taskCounts = await sql<{ status: string; count: number }[]>`
        SELECT status, count(*)::int AS count
        FROM agent_task_queue
        GROUP BY status
      `;

      // 2. Tasks by agent role and status
      const tasksByRole = await sql<{ agentRole: string; status: string; count: number }[]>`
        SELECT agent_role, status, count(*)::int AS count
        FROM agent_task_queue
        GROUP BY agent_role, status
        ORDER BY agent_role, status
      `;

      // 3. Recent failures (last 10)
      const recentFailures = await sql<{
        id: string;
        agentRole: string;
        taskType: string;
        error: string | null;
        createdAt: string;
      }[]>`
        SELECT id, agent_role, task_type, error, created_at
        FROM agent_task_queue
        WHERE status = 'failed'
        ORDER BY created_at DESC
        LIMIT 10
      `;

      // 4. Recent tool invocation events (from system_events)
      const recentToolEvents = await sql<{
        id: string;
        type: string;
        phase: string;
        payload: unknown;
        createdAt: string;
      }[]>`
        SELECT id, type, phase, payload, created_at
        FROM system_events
        WHERE namespace = 'tool'
        ORDER BY created_at DESC
        LIMIT 20
      `;

      return NextResponse.json({
        data: {
          taskCounts,
          tasksByRole,
          recentFailures,
          recentToolEvents,
        },
      });
    } catch (err) {
      console.error('[AGENTS] DB query failed:', err);
      return NextResponse.json({ error: 'Database query failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[admin/agents] error:', err);
    return NextResponse.json(
      { error: 'Agent query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
