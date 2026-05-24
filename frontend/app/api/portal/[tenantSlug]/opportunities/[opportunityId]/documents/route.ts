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
import { getSignedGetUrl } from '@/lib/storage/s3-client';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; opportunityId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, opportunityId } = await ctx.params;
    if (!isValidUUID(opportunityId)) {
      return NextResponse.json(
        { error: 'Invalid opportunity ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

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

    // ── 1. Verify tenant has access to this opportunity ────────
    let pipelineItem: { id: string } | undefined;
    try {
      [pipelineItem] = await sql<{ id: string }[]>`
        SELECT id FROM tenant_pipeline_items
        WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[portal/opportunities/documents] pipeline query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!pipelineItem) {
      // Fall back to checking purchases table
      let purchase: { id: string } | undefined;
      try {
        [purchase] = await sql<{ id: string }[]>`
          SELECT id FROM purchases
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
            AND status = 'completed'
          LIMIT 1
        `;
      } catch (dbErr) {
        console.error('[portal/opportunities/documents] purchase query failed:', dbErr);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
      if (!purchase) {
        return NextResponse.json(
          { error: 'No access to this opportunity', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
    }

    // ── 2. Fetch linked solicitation documents ──────────────
    // Opportunities link to solicitations via solicitation_id.
    // Documents are stored on solicitation_documents via solicitation_id.
    let documents: {
      id: string;
      originalFilename: string;
      documentType: string;
      storageKey: string;
      fileSize: number | null;
      contentType: string | null;
      pageCount: number | null;
      extractedAt: string | null;
      isPrimary: boolean | null;
      documentLabel: string | null;
      createdAt: string;
    }[];
    try {
      documents = await sql<typeof documents>`
        SELECT sd.id, sd.original_filename, sd.document_type, sd.storage_key,
               sd.file_size, sd.content_type, sd.page_count, sd.extracted_at,
               sd.is_primary, sd.document_label, sd.created_at
        FROM solicitation_documents sd
        WHERE sd.solicitation_id = (
          SELECT solicitation_id FROM opportunities
          WHERE id = ${opportunityId}::uuid
          LIMIT 1
        )
        ORDER BY sd.is_primary DESC NULLS LAST, sd.document_type, sd.created_at
        LIMIT 100
      `;
    } catch (dbErr) {
      console.error('[portal/opportunities/documents] documents query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── 3. Generate presigned S3 URLs (1 hour expiry) ───────
    const documentsWithUrls = await Promise.all(
      documents.map(async (doc) => {
        let downloadUrl: string | null = null;
        if (doc.storageKey) {
          try {
            downloadUrl = await getSignedGetUrl(doc.storageKey, 3600);
          } catch (signErr) {
            console.error('[portal/opportunities/documents] sign failed', {
              docId: doc.id,
              key: doc.storageKey,
              err: signErr instanceof Error ? signErr.message : String(signErr),
            });
          }
        }
        return {
          id: doc.id,
          filename: doc.originalFilename,
          documentType: doc.documentType,
          fileSize: doc.fileSize,
          contentType: doc.contentType,
          pageCount: doc.pageCount,
          extractedAt: doc.extractedAt,
          isPrimary: doc.isPrimary ?? false,
          label: doc.documentLabel,
          downloadUrl,
          createdAt: doc.createdAt,
        };
      }),
    );

    return NextResponse.json({ data: { documents: documentsWithUrls } });
  } catch (err) {
    console.error('[portal/opportunities/documents] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch documents', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
