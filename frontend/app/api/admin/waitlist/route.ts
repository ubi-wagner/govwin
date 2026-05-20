/**
 * GET /api/admin/waitlist — Waitlist management
 *
 * Returns waitlist entries with status, email, created_at.
 * Supports filtering by status.
 *
 * Auth: master_admin or rfp_admin.
 *
 * V1 TODO (P2-24): Implement waitlist management query.
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

    // ── Parse query params ───────────────────────────────────────
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');

    // TODO: Implement waitlist query
    //
    // SELECT w.id, w.email, w.company_name, w.status, w.created_at
    // FROM waitlist w
    // [WHERE w.status = ${statusFilter}]
    // ORDER BY w.created_at DESC
    // LIMIT 100

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-24',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[admin/waitlist] error:', err);
    return NextResponse.json(
      { error: 'Waitlist query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
