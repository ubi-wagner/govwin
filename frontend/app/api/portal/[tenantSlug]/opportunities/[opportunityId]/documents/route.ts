/**
 * GET /api/portal/[tenantSlug]/opportunities/[opportunityId]/documents
 *
 * Returns signed S3 URLs for solicitation documents linked to this opportunity.
 * Tenant must have an active subscription or a purchase for this opportunity.
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-04): Implement document URL generation.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string; opportunityId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, opportunityId } = await ctx.params;

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

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement document listing with signed URLs
    //
    // 1. Verify tenant has access to this opportunity:
    //    SELECT id FROM tenant_pipeline_items
    //    WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
    //    OR check purchases table for active purchase
    //
    // 2. Fetch linked solicitation documents:
    //    SELECT sd.id, sd.original_filename, sd.document_type, sd.storage_key,
    //           sd.page_count, sd.extracted_at
    //    FROM solicitation_documents sd
    //    JOIN curated_solicitations cs ON cs.id = sd.solicitation_id
    //    WHERE cs.opportunity_id = ${opportunityId}::uuid
    //    ORDER BY sd.document_type, sd.created_at
    //
    // 3. Generate presigned S3 URLs for each document:
    //    Use AWS SDK getSignedUrl with 1-hour expiry
    //
    // 4. Return { data: { documents: [...] } }

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-04',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/opportunities/documents] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch documents', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
