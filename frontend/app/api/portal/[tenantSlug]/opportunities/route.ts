/**
 * GET  /api/portal/[tenantSlug]/opportunities — Scored opportunity list for tenant
 * POST /api/portal/[tenantSlug]/opportunities — Bulk actions (not V1)
 *
 * Returns opportunities scored against tenant profile from tenant_pipeline_items.
 * Supports filters: program_type, agency, close_date range, score threshold.
 * Paginated with limit/offset.
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-02): Implement the SQL queries below.
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
    const programType = url.searchParams.get('program_type');
    const agency = url.searchParams.get('agency');
    const minScore = parseFloat(url.searchParams.get('min_score') ?? '0');
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);
    const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement scored opportunity list
    //
    // SELECT o.id, o.title, o.agency, o.office, o.program_type,
    //        o.close_date, o.naics_codes, o.set_aside_type,
    //        tpi.score, tpi.is_pinned, tpi.thumb_direction,
    //        cs.solicitation_type, cs.status AS curation_status
    // FROM tenant_pipeline_items tpi
    // JOIN opportunities o ON o.id = tpi.opportunity_id
    // LEFT JOIN curated_solicitations cs ON cs.opportunity_id = o.id
    // WHERE tpi.tenant_id = ${tenantId}::uuid
    //   AND tpi.score >= ${minScore}
    //   [AND o.program_type = ${programType}]
    //   [AND o.agency = ${agency}]
    // ORDER BY tpi.score DESC, o.close_date ASC
    // LIMIT ${limit} OFFSET ${offset}
    //
    // Also return total count for pagination.

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-02',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/opportunities] error:', err);
    return NextResponse.json(
      { error: 'Failed to query opportunities', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  return NextResponse.json({
    error: 'Not implemented — see V1_TODO.md P2-02',
    code: 'NOT_IMPLEMENTED',
  }, { status: 501 });
}
