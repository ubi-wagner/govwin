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
    const search = url.searchParams.get('search') ?? '';
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '100', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 100 : rawLimit), 500);

    // The waitlist table has: id, email, company_name, metadata, created_at
    // (no status column — all entries are pending by default)
    type WaitlistRow = {
      id: string;
      email: string;
      companyName: string | null;
      metadata: unknown;
      createdAt: string;
    };

    let entries: WaitlistRow[];

    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      const pattern = `%${escaped}%`;
      entries = await sql<WaitlistRow[]>`
        SELECT id, email, company_name, metadata, created_at
        FROM waitlist
        WHERE email ILIKE ${pattern}
           OR company_name ILIKE ${pattern}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      entries = await sql<WaitlistRow[]>`
        SELECT id, email, company_name, metadata, created_at
        FROM waitlist
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    // Total count for the admin dashboard
    const totalResult = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM waitlist
    `;

    return NextResponse.json({
      data: {
        entries,
        total: totalResult[0]?.count ?? 0,
      },
    });
  } catch (err) {
    console.error('[admin/waitlist] error:', err);
    return NextResponse.json(
      { error: 'Waitlist query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
