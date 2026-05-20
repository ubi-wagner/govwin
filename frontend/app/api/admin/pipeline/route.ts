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

    // TODO: Implement pipeline monitoring
    //
    // 1. Job counts by status:
    //    SELECT status, count(*)::int AS count FROM pipeline_jobs GROUP BY status
    //
    // 2. Recent jobs (last 20):
    //    SELECT id, job_type, status, priority, metadata, created_at, started_at, completed_at,
    //           EXTRACT(EPOCH FROM (completed_at - started_at))::int AS duration_seconds
    //    FROM pipeline_jobs ORDER BY created_at DESC LIMIT 20
    //
    // 3. Schedule status:
    //    SELECT id, name, source_type, cron_expression, is_active, last_run_at, next_run_at
    //    FROM pipeline_schedules ORDER BY name

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-20',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[admin/pipeline] error:', err);
    return NextResponse.json(
      { error: 'Pipeline query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
