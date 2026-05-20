/**
 * GET  /api/portal/[tenantSlug]/opportunities — Scored opportunity list for tenant
 * POST /api/portal/[tenantSlug]/opportunities — Bulk actions (pin/unpin/pass)
 *
 * Returns opportunities scored against tenant profile from tenant_pipeline_items.
 * Supports filters: status, sort, search, limit/offset.
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
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const sort = url.searchParams.get('sort') ?? 'score_desc';
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 200);
    const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    // ── Build query filters ──────────────────────────────────────
    try {
      const filters = [sql`tpi.tenant_id = ${tenantId}::uuid`];

      if (status && ['unreviewed', 'pursuing', 'monitoring', 'passed'].includes(status)) {
        filters.push(sql`tpi.pursuit_status = ${status}`);
      }

      if (search) {
        const escaped = search.replace(/[%_\\]/g, '\\$&');
        const pattern = `%${escaped}%`;
        filters.push(sql`(o.title ILIKE ${pattern} OR o.agency ILIKE ${pattern} OR o.topic_number ILIKE ${pattern})`);
      }

      const where = filters.reduce(
        (acc, fragment, i) => (i === 0 ? fragment : sql`${acc} AND ${fragment}`),
      );

      // Count
      const [countResult] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM tenant_pipeline_items tpi
        JOIN opportunities o ON o.id = tpi.opportunity_id
        WHERE ${where}
      `;
      const total = parseInt(countResult.count, 10);

      // Sort order
      const orderClause =
        sort === 'date_asc' ? sql`o.close_date ASC NULLS LAST` :
        sort === 'date_desc' ? sql`o.close_date DESC NULLS LAST` :
        sort === 'score_asc' ? sql`tpi.total_score ASC` :
        sql`tpi.total_score DESC`;

      // Main query
      const items = await sql`
        SELECT
          tpi.id,
          o.title AS solicitation_title,
          o.agency,
          o.close_date,
          tpi.total_score AS score,
          tpi.pursuit_status AS status,
          tpi.is_pinned,
          tpi.created_at AS matched_at,
          o.topic_number,
          o.program_type,
          o.solicitation_number,
          cs.solicitation_type
        FROM tenant_pipeline_items tpi
        JOIN opportunities o ON o.id = tpi.opportunity_id
        LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id
        WHERE ${where}
        ORDER BY ${orderClause}
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      return NextResponse.json({ data: { items, total } });
    } catch (dbErr) {
      console.error('[portal/opportunities] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to query opportunities', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/opportunities] error:', err);
    return NextResponse.json(
      { error: 'Failed to query opportunities', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, ctx: RouteContext) {
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

    // ── Parse body ───────────────────────────────────────────────
    let body: { action?: string; itemIds?: string[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    const { action, itemIds } = body;
    if (!action || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'action (string) and itemIds (non-empty array) are required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    try {
      let result: { count: number };

      switch (action) {
        case 'pin':
          result = await sql`
            UPDATE tenant_pipeline_items SET is_pinned = true, updated_at = now()
            WHERE id = ANY(${itemIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;
        case 'unpin':
          result = await sql`
            UPDATE tenant_pipeline_items SET is_pinned = false, updated_at = now()
            WHERE id = ANY(${itemIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;
        case 'pursue':
          result = await sql`
            UPDATE tenant_pipeline_items SET pursuit_status = 'pursuing', updated_at = now()
            WHERE id = ANY(${itemIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;
        case 'pass':
          result = await sql`
            UPDATE tenant_pipeline_items SET pursuit_status = 'passed', updated_at = now()
            WHERE id = ANY(${itemIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;
        case 'monitor':
          result = await sql`
            UPDATE tenant_pipeline_items SET pursuit_status = 'monitoring', updated_at = now()
            WHERE id = ANY(${itemIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;
        default:
          return NextResponse.json(
            { error: 'Invalid action. Must be one of: pin, unpin, pursue, pass, monitor', code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
      }

      return NextResponse.json({ data: { updated: result.count } });
    } catch (dbErr) {
      console.error('[portal/opportunities] bulk action DB error:', dbErr);
      return NextResponse.json(
        { error: 'Bulk action failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/opportunities] POST error:', err);
    return NextResponse.json(
      { error: 'Operation failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
