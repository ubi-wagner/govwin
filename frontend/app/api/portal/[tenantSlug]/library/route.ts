/**
 * GET  /api/portal/[tenantSlug]/library       — List library units (filtered, paginated)
 * POST /api/portal/[tenantSlug]/library       — Bulk operations (approve, archive, delete, set_category, add_tags)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle } from '@/lib/events';

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
      { error: 'Authentication required' },
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
      { error: 'Invalid session' },
      { status: 401 },
    );
  }

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 },
    );
  }

  // ---------- Tenant lookup + access check ----------
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { error: 'Tenant not found' },
      { status: 404 },
    );
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Forbidden' },
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
      { error: 'Invalid status. Must be one of: draft, approved, archived' },
      { status: 400 },
    );
  }

  // ---------- Build and execute query ----------
    // Build dynamic filter fragments
    const filters = [sql`tenant_id = ${tenantId}::uuid`];

    if (category) {
      filters.push(sql`category = ${category}`);
    }
    if (status) {
      filters.push(sql`status = ${status}`);
    }
    if (tagsParam) {
      const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        filters.push(sql`tags && ${sql.array(tags)}`);
      }
    }
    if (q) {
      filters.push(sql`content ILIKE ${'%' + q + '%'}`);
    }

    const where = filters.reduce(
      (acc, fragment, i) => (i === 0 ? fragment : sql`${acc} AND ${fragment}`),
    );

    const [countResult] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM library_units WHERE ${where}
    `;
    const total = parseInt(countResult.count, 10);

    const units = await sql`
      SELECT *
      FROM library_units
      WHERE ${where}
      ORDER BY outcome_score DESC NULLS LAST, usage_count DESC, created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return NextResponse.json({ data: { units, total } });
  } catch (err) {
    console.error('[library/list] error', err);
    return NextResponse.json(
      { error: 'Failed to fetch library units' },
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
      { error: 'Authentication required' },
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
      { error: 'Invalid session' },
      { status: 401 },
    );
  }

  // Bulk operations require tenant_admin or above
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 },
    );
  }

  // ---------- Tenant lookup + access check ----------
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { error: 'Tenant not found' },
      { status: 404 },
    );
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Forbidden' },
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
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { action, unitIds, category: newCategory, tags: newTags } = body;

  // ---------- Validate ----------
  if (!action || !Array.isArray(unitIds) || unitIds.length === 0) {
    return NextResponse.json(
      { error: 'action (string) and unitIds (non-empty array) are required' },
      { status: 400 },
    );
  }

  const validActions = ['approve', 'archive', 'delete', 'set_category', 'add_tags'];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
      { status: 400 },
    );
  }

  if (action === 'set_category' && (!newCategory || typeof newCategory !== 'string')) {
    return NextResponse.json(
      { error: 'category (string) is required for set_category action' },
      { status: 400 },
    );
  }

  if (action === 'add_tags' && (!Array.isArray(newTags) || newTags.length === 0)) {
    return NextResponse.json(
      { error: 'tags (non-empty array) is required for add_tags action' },
      { status: 400 },
    );
  }

  // ---------- Execute ----------
    let result: { count: number };

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
          { error: 'Unhandled action' },
          { status: 400 },
        );
    }

    await emitEventSingle({
      namespace: 'library',
      type: `bulk_${action}`,
      actor: { type: 'user', id: sessionUser.id },
      tenantId,
      payload: { action, unitCount: unitIds.length, affected: result },
    });

    return NextResponse.json({ data: { updated: result.count } });
  } catch (err) {
    console.error('[library/bulk] error', err);
    return NextResponse.json(
      { error: 'Bulk operation failed' },
      { status: 500 },
    );
  }
}
