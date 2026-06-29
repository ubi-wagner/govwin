/**
 * GET  /api/portal/[tenantSlug]/library       — List library units (filtered, paginated)
 * POST /api/portal/[tenantSlug]/library       — Bulk operations (approve, archive, delete, set_category, add_tags)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd } from '@/lib/events';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  try {
  const { tenantSlug } = await params;

  // ---------- Auth ----------
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

  // ---------- Tenant lookup + access check ----------
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

  // ---------- Parse query params ----------
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const tagsParam = url.searchParams.get('tags');
  const q = url.searchParams.get('q');

  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);
  const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  // Validate status if provided
  if (status && !['draft', 'approved', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: 'Invalid status. Must be one of: draft, approved, archived', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  // ---------- Build and execute query ----------
    // Build dynamic filter fragments
    const filters = [sql`lu.tenant_id = ${tenantId}::uuid`];

    if (category) {
      filters.push(sql`lu.category = ${category}`);
    }
    if (status) {
      filters.push(sql`lu.status = ${status}`);
    }
    if (tagsParam) {
      const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        filters.push(sql`lu.tags && ${sql.array(tags)}`);
      }
    }
    if (q) {
      filters.push(sql`lu.content ILIKE ${'%' + q.replace(/[%_\\]/g, '\\$&') + '%'}`);
    }

    // ---------- Source type filter ----------
    const sourceFilter = url.searchParams.get('source');
    if (sourceFilter && ['upload', 'harvest', 'ai', 'manual'].includes(sourceFilter)) {
      filters.push(sql`lu.source_type = ${sourceFilter}`);
    }

    // ---------- Outcome filter ----------
    const outcomeFilter = url.searchParams.get('outcome');
    if (outcomeFilter && ['pending', 'awarded', 'rejected', 'withdrawn'].includes(outcomeFilter)) {
      filters.push(sql`lu.outcome = ${outcomeFilter}`);
    }

    const where = filters.reduce(
      (acc, fragment, i) => (i === 0 ? fragment : sql`${acc} AND ${fragment}`),
    );

    // ---------- Sort ----------
    const sortParam = url.searchParams.get('sort');
    const validSorts = ['outcome_score', 'created_at', 'usage_count'];
    const sortColumn = sortParam && validSorts.includes(sortParam) ? sortParam : 'outcome_score';

    let total: number;
    let units: Record<string, unknown>[];
    try {
      const [countResult] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM library_units lu WHERE ${where}
      `;
      total = parseInt(countResult.count, 10);

      units = await sql`
        SELECT lu.*,
               p.title AS proposal_title
        FROM library_units lu
        LEFT JOIN proposals p ON lu.original_proposal_id = p.id
        WHERE ${where}
        ORDER BY
          ${sortColumn === 'usage_count' ? sql`lu.usage_count DESC NULLS LAST` :
            sortColumn === 'created_at' ? sql`lu.created_at DESC` :
            sql`lu.outcome_score DESC NULLS LAST`},
          lu.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
    } catch (dbErr) {
      console.error('[library/list] DB query failed', dbErr);
      return NextResponse.json(
        { error: 'Failed to query library units', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: { units, total } });
  } catch (err) {
    console.error('[library/list] error', err);
    return NextResponse.json(
      { error: 'Failed to fetch library units', code: 'STORAGE_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  try {
  const { tenantSlug } = await params;

  // ---------- Auth ----------
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

  // Bulk operations require tenant_admin or above
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    return NextResponse.json(
      { error: 'Insufficient permissions', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  // ---------- Tenant lookup + access check ----------
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

  // ---------- Parse body ----------
  let body: {
    action?: string;
    unitIds?: string[];
    category?: string;
    tags?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const { action, unitIds, category: newCategory, tags: newTags } = body;

  // ---------- Validate ----------
  if (!action || !Array.isArray(unitIds) || unitIds.length === 0 || !unitIds.every((id) => typeof id === 'string' && isValidUUID(id))) {
    return NextResponse.json(
      { error: 'action (string) and unitIds (non-empty array) are required', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const validActions = ['approve', 'archive', 'delete', 'set_category', 'add_tags'];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(', ')}`, code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  if (action === 'set_category' && (!newCategory || typeof newCategory !== 'string')) {
    return NextResponse.json(
      { error: 'category (string) is required for set_category action', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  if (action === 'add_tags' && (!Array.isArray(newTags) || newTags.length === 0)) {
    return NextResponse.json(
      { error: 'tags (non-empty array) is required for add_tags action', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  // ── Start event for bulk library operation ──────────────────────
    const startId = await emitEventStart({
      namespace: 'library',
      type: `unit.${action === 'approve' ? 'approved' : action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : action === 'set_category' ? 'categorized' : 'tagged'}`,
      actor: { type: 'user', id: sessionUser.id },
      tenantId,
      payload: { action, unitCount: unitIds.length },
    });

  // ---------- Execute ----------
    let result: { count: number };

    try {
      switch (action) {
        case 'approve':
          result = await sql`
            UPDATE library_units
            SET status = 'approved', updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'archive':
          result = await sql`
            UPDATE library_units
            SET status = 'archived', updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'delete':
          result = await sql`
            DELETE FROM library_units
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'set_category':
          result = await sql`
            UPDATE library_units
            SET category = ${newCategory!}, updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'add_tags':
          result = await sql`
            UPDATE library_units
            SET tags = tags || ${sql.array(newTags!)}, updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        default:
          return NextResponse.json(
            { error: 'Unhandled action', code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
      }
    } catch (e) {
      console.error('[library/bulk] query failed:', e);
      await emitEventEnd(startId, { error: { message: String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitEventEnd(startId, {
      result: { correlationId: randomUUID(), action, unitCount: unitIds.length, affected: result.count },
    });

    return NextResponse.json({ data: { updated: result.count } });
  } catch (err) {
    console.error('[library/bulk] error', err);
    return NextResponse.json(
      { error: 'Bulk operation failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
