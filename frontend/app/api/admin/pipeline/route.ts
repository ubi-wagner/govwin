/**
 * GET /api/admin/pipeline — Pipeline job monitoring
 *
 * Returns pipeline job stats: queued/running/completed/failed counts,
 * recent jobs with duration. Also shows pipeline_schedules status.
 *
 * Auth: master_admin or rfp_admin.
 *
 * V1 TODO (P2-20): Implement pipeline monitoring queries.
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

    // 1. Job counts by status
    const jobCounts = await sql<{ status: string; count: number }[]>`
      SELECT status, count(*)::int AS count
      FROM pipeline_jobs
      GROUP BY status
    `;

    // 2. Recent jobs (last 50)
    const recentJobs = await sql<{
      id: string;
      source: string;
      runType: string;
      status: string;
      workerId: string | null;
      result: unknown;
      error: string | null;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
      durationSeconds: number | null;
    }[]>`
      SELECT id, source, run_type, status, worker_id,
             result, error, started_at, completed_at, created_at,
             EXTRACT(EPOCH FROM (completed_at - started_at))::int AS duration_seconds
      FROM pipeline_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `;

    // 3. Schedule status
    const schedules = await sql<{
      id: string;
      source: string;
      runType: string;
      cronExpression: string;
      enabled: boolean;
      lastRunAt: string | null;
      nextRunAt: string | null;
      createdAt: string;
    }[]>`
      SELECT id, source, run_type, cron_expression, enabled,
             last_run_at, next_run_at, created_at
      FROM pipeline_schedules
      ORDER BY source
    `;

    return NextResponse.json({
      data: {
        jobCounts,
        recentJobs,
        schedules,
      },
    });
  } catch (err) {
    console.error('[admin/pipeline] error:', err);
    return NextResponse.json(
      { error: 'Pipeline query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
