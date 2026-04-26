/**
 * GET    /api/portal/[tenantSlug]/library/[unitId]  — Fetch one library unit
 * PATCH  /api/portal/[tenantSlug]/library/[unitId]  — Update a library unit
 * DELETE /api/portal/[tenantSlug]/library/[unitId]  — Delete a library unit
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle } from '@/lib/events';

type RouteParams = { params: Promise<{ tenantSlug: string; unitId: string }> };

/** Shared auth + tenant verification, returns context or an error response. */
async function authorize(request: Request, { params }: RouteParams, minRole: Role) {
  const { tenantSlug, unitId } = await params;

  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }

  if (!hasRoleAtLeast(role, minRole)) {
    return { error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) };
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { tenantId, unitId, role, userId: sessionUser.id };
}

export async function GET(
  request: Request,
  routeParams: RouteParams,
) {
  const ctx = await authorize(request, routeParams, 'tenant_user');
  if ('error' in ctx) return ctx.error;

  try {
    const [unit] = await sql`
      SELECT * FROM library_units
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (!unit) {
      return NextResponse.json(
        { error: 'Library unit not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: unit });
  } catch (err) {
    console.error('[library/unit/get] DB query failed', err);
    return NextResponse.json(
      { error: 'Failed to fetch library unit' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  routeParams: RouteParams,
) {
  const ctx = await authorize(request, routeParams, 'tenant_user');
  if ('error' in ctx) return ctx.error;

  // ---------- Parse body ----------
  let body: {
    content?: string;
    category?: string;
    subcategory?: string;
    tags?: string[];
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // ---------- Validate ----------
  const allowedFields = ['content', 'category', 'subcategory', 'tags', 'status'];
  const updates: Array<ReturnType<typeof sql>> = [];

  if (body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }
    updates.push(sql`content = ${body.content}`);
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string') {
      return NextResponse.json({ error: 'category must be a string' }, { status: 400 });
    }
    updates.push(sql`category = ${body.category}`);
  }

  if (body.subcategory !== undefined) {
    if (typeof body.subcategory !== 'string') {
      return NextResponse.json({ error: 'subcategory must be a string' }, { status: 400 });
    }
    updates.push(sql`subcategory = ${body.subcategory}`);
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'tags must be an array' }, { status: 400 });
    }
    updates.push(sql`tags = ${sql.array(body.tags)}`);
  }

  if (body.status !== undefined) {
    if (!['draft', 'approved', 'archived'].includes(body.status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be one of: draft, approved, archived' },
        { status: 400 },
      );
    }
    updates.push(sql`status = ${body.status}`);
  }

  // Check that at least one valid field was provided
  const providedKeys = Object.keys(body).filter((k) => allowedFields.includes(k));
  if (providedKeys.length === 0) {
    return NextResponse.json(
      { error: `No valid fields to update. Allowed: ${allowedFields.join(', ')}` },
      { status: 400 },
    );
  }

  // Always update the timestamp
  updates.push(sql`updated_at = now()`);

  // ---------- Execute ----------
  try {
    const setClause = updates.reduce(
      (acc, fragment, i) => (i === 0 ? fragment : sql`${acc}, ${fragment}`),
    );

    const result = await sql`
      UPDATE library_units
      SET ${setClause}
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Library unit not found' },
        { status: 404 },
      );
    }

    await emitEventSingle({
      namespace: 'library',
      type: 'unit_updated',
      actor: { type: 'user', id: ctx.userId },
      tenantId: ctx.tenantId,
      payload: { unitId: ctx.unitId, updatedFields: providedKeys },
    });

    return NextResponse.json({ data: { updated: true } });
  } catch (err) {
    console.error('[library/unit/patch] DB update failed', err);
    return NextResponse.json(
      { error: 'Failed to update library unit' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  routeParams: RouteParams,
) {
  const ctx = await authorize(request, routeParams, 'tenant_admin');
  if ('error' in ctx) return ctx.error;

  try {
    const result = await sql`
      DELETE FROM library_units
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Library unit not found' },
        { status: 404 },
      );
    }

    await emitEventSingle({
      namespace: 'library',
      type: 'unit_deleted',
      actor: { type: 'user', id: ctx.userId },
      tenantId: ctx.tenantId,
      payload: { unitId: ctx.unitId },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[library/unit/delete] DB delete failed', err);
    return NextResponse.json(
      { error: 'Failed to delete library unit' },
      { status: 500 },
    );
  }
}
