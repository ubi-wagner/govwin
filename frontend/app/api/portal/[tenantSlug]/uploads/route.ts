/**
 * GET  /api/portal/[tenantSlug]/uploads — List uploaded files
 * POST /api/portal/[tenantSlug]/uploads — Upload a file to S3 + create library_unit
 *
 * Handles file uploads for tenant library. Files are stored in S3 under
 * customers/{tenantId}/uploads/ and a library_units row is created with
 * source_type='upload'.
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-09): Implement file upload and listing.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

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

    // TODO: List uploaded library units for this tenant
    // SELECT id, title, category, source_type, status, created_at
    // FROM library_units
    // WHERE tenant_id = ${tenantId}::uuid AND source_type = 'upload'
    // ORDER BY created_at DESC

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-09',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/uploads/list] error:', err);
    return NextResponse.json(
      { error: 'Failed to list uploads', code: 'DB_ERROR' },
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
      email?: string;
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

    // TODO: Implement file upload
    //
    // 1. Parse multipart/form-data from request
    // 2. Validate file type (PDF, DOCX, TXT, XLSX)
    // 3. Upload to S3: customers/{tenantId}/uploads/{uuid}/{filename}
    // 4. Create library_units row:
    //    INSERT INTO library_units (
    //      id, tenant_id, title, content, source_type, status,
    //      storage_key, original_filename, created_at, updated_at
    //    ) VALUES (...)
    // 5. Emit library:unit.uploaded event
    // 6. Return { data: { id, title, storageKey } }

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-09',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/uploads/create] error:', err);
    return NextResponse.json(
      { error: 'Upload failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
