/**
 * GET  /api/portal/[tenantSlug]/proposals — Tenant proposal list
 * POST /api/portal/[tenantSlug]/proposals — Not used (see /proposals/create)
 *
 * Returns paginated list of tenant proposals with stage, title, opportunity
 * title, section count, created_at. Filterable by stage.
 *
 * Auth: tenant_user or above with tenant access.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

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
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Tenant lookup + access ───────────────────────────────────
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Parse query params ───────────────────────────────────────
    const url = new URL(request.url);
    const stageFilter = url.searchParams.get('stage');
    const sort = url.searchParams.get('sort') ?? 'updated_desc';
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 200);
    const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    if (stageFilter && !['draft', 'review', 'final', 'submitted', 'archived'].includes(stageFilter)) {
      return NextResponse.json(
        { error: 'Invalid stage filter', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    try {
      const filters = [sql`p.tenant_id = ${tenantId}::uuid`];
      if (stageFilter) {
        filters.push(sql`p.stage = ${stageFilter}`);
      }

      const where = filters.reduce(
        (acc, fragment, i) => (i === 0 ? fragment : sql`${acc} AND ${fragment}`),
      );

      // Count
      const [countResult] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM proposals p WHERE ${where}
      `;
      const total = parseInt(countResult.count, 10);

      // Sort order
      const orderClause =
        sort === 'created_asc' ? sql`p.created_at ASC` :
        sort === 'created_desc' ? sql`p.created_at DESC` :
        sort === 'updated_asc' ? sql`p.updated_at ASC` :
        sql`p.updated_at DESC`;

      // Main query
      const proposals = await sql`
        SELECT
          p.id,
          p.title,
          p.stage,
          p.is_locked,
          p.created_at,
          p.updated_at,
          o.title AS solicitation_title,
          o.agency,
          o.close_date,
          (SELECT count(*)::int FROM proposal_sections WHERE proposal_id = p.id) AS section_count
        FROM proposals p
        LEFT JOIN opportunities o ON o.id = p.opportunity_id
        WHERE ${where}
        ORDER BY ${orderClause}
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      return NextResponse.json({ data: { proposals, total } });
    } catch (dbErr) {
      console.error('[portal/proposals] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to query proposals', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/proposals] error:', err);
    return NextResponse.json(
      { error: 'Failed to query proposals', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(_request: Request, _ctx: RouteContext) {
  return NextResponse.json(
    { error: 'This endpoint does not accept POST requests. To create a proposal, use POST /api/portal/{tenantSlug}/proposals/create', code: 'WRONG_ENDPOINT' },
    { status: 400 },
  );
}
