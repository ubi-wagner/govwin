import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { resolveUserAccess, hasProposalVisibility } from '@/lib/proposal-access';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { putObject, getSignedGetUrl } from '@/lib/storage/s3-client';
import { customerProposalPath } from '@/lib/storage/paths';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs
 *
 * List all supporting docs for this proposal (with status and signed URLs).
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
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

    enterTenant(tenantId);

    // CAP-3: verifyTenantAccess ignores membership.scope; gate reads on the scope-aware resolver so a
    // proposal-scoped tenant_user can't list an out-of-scope proposal's supporting docs (+ signed URLs).
    if (!hasProposalVisibility(await resolveUserAccess(sessionUser.id, proposalId, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Verify proposal belongs to tenant ────────────────────
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Fetch supporting docs ────────────────────────────────
    let docs: {
      id: string;
      requirementLabel: string;
      requirementSource: string | null;
      category: string;
      isRequired: boolean;
      storageKey: string | null;
      originalFilename: string | null;
      fileSize: number | null;
      contentType: string | null;
      status: string;
      uploadedBy: string | null;
      uploadedAt: Date | null;
      reviewedBy: string | null;
      reviewedAt: Date | null;
      notes: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[];
    try {
      docs = await sql<typeof docs>`
        SELECT id, requirement_label, requirement_source, category, is_required,
               storage_key, original_filename, file_size, content_type,
               status, uploaded_by, uploaded_at, reviewed_by, reviewed_at,
               notes, created_at, updated_at
        FROM proposal_supporting_docs
        WHERE proposal_id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
        ORDER BY
          CASE category WHEN 'supporting_document' THEN 1 WHEN 'proposal_input' THEN 2 ELSE 3 END,
          requirement_label
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Generate signed URLs for uploaded docs
    const docsWithUrls = await Promise.all(docs.map(async (doc) => ({
      id: doc.id,
      requirementLabel: doc.requirementLabel,
      requirementSource: doc.requirementSource,
      category: doc.category,
      isRequired: doc.isRequired,
      originalFilename: doc.originalFilename,
      fileSize: doc.fileSize,
      contentType: doc.contentType,
      status: doc.status,
      uploadedBy: doc.uploadedBy,
      uploadedAt: doc.uploadedAt,
      reviewedBy: doc.reviewedBy,
      reviewedAt: doc.reviewedAt,
      notes: doc.notes,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      downloadUrl: doc.storageKey ? await getSignedGetUrl(doc.storageKey).catch(() => null) : null,
    })));

    // Summary counts
    const summary = {
      total: docs.length,
      required: docs.filter(d => d.isRequired).length,
      uploaded: docs.filter(d => d.status !== 'missing').length,
      approved: docs.filter(d => d.status === 'approved').length,
      missing: docs.filter(d => d.status === 'missing' && d.isRequired).length,
    };

    return NextResponse.json({
      data: {
        docs: docsWithUrls,
        summary,
      },
    });
  } catch (err) {
    console.error('[portal/proposals/supporting-docs] error:', err);
    return NextResponse.json(
      { error: 'Internal error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs
 *
 * Upload a supporting document via presigned URL workflow.
 * Body JSON: { docId?: string, category?: string, filename: string, contentType: string, fileSize: number }
 * Returns: { data: { uploadUrl: string, docId: string } }
 *
 * If docId is provided, fills that existing slot.
 * If category is provided without docId, creates a new doc entry.
 */
export async function POST(request: Request, ctx: RouteContext) {
  let startId: string | null = null;
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
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

    enterTenant(tenantId);

    // ── Parse body ───────────────────────────────────────────
    let body: {
      docId?: unknown;
      category?: unknown;
      filename?: unknown;
      contentType?: unknown;
      fileSize?: unknown;
      requirementLabel?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    const filename = body.filename;
    if (typeof filename !== 'string' || !filename.trim()) {
      return NextResponse.json(
        { error: 'filename is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (filename.trim().length > 255) {
      return NextResponse.json(
        { error: 'filename exceeds maximum length (255 characters)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const contentType = typeof body.contentType === 'string' ? body.contentType : 'application/octet-stream';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : null;

    // Validate content type against safe MIME types
    const SAFE_MIME_TYPES = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'text/plain',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'application/zip',
      'application/octet-stream',
    ];
    if (!SAFE_MIME_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: 'Unsupported file type', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate file size (50 MB max)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    if (fileSize !== null && fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds maximum (50 MB)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate requirementLabel length
    if (typeof body.requirementLabel === 'string' && body.requirementLabel.length > 500) {
      return NextResponse.json(
        { error: 'requirementLabel exceeds maximum length (500 characters)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Verify proposal belongs to tenant ────────────────────
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Proposal-level access check for non-admin users ───────
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      try {
        const [collab] = await sql<{ userId: string }[]>`
          SELECT user_id FROM proposal_collaborators
          WHERE proposal_id = ${proposalId}::uuid AND user_id = ${sessionUser.id}::uuid
            AND revoked_at IS NULL
          LIMIT 1
        `;
        if (!collab) {
          return NextResponse.json(
            { error: 'You are not a collaborator on this proposal', code: 'FORBIDDEN' },
            { status: 403 },
          );
        }
      } catch (e) {
        console.error('[portal/proposals/supporting-docs] collaborator check failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    }

    // ── Start event for document upload ────────────────────────────
    startId = await emitEventStart({
      namespace: 'proposal',
      type: 'supporting_doc.uploaded',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { proposalId, filename: filename as string },
    });

    let targetDocId: string;

    if (typeof body.docId === 'string' && isValidUUID(body.docId)) {
      // ── Fill an existing doc slot ────────────────────────────
      let existingDoc: { id: string } | undefined;
      try {
        [existingDoc] = await sql<{ id: string }[]>`
          SELECT id FROM proposal_supporting_docs
          WHERE id = ${body.docId}::uuid
            AND proposal_id = ${proposalId}::uuid
            AND tenant_id = ${tenantId}::uuid
          LIMIT 1
        `;
      } catch (e) {
        console.error('[portal/proposals/supporting-docs] doc lookup failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }

      if (!existingDoc) {
        await emitEventEnd(startId, { error: { message: 'Supporting doc slot not found', code: 'NOT_FOUND' } });
        return NextResponse.json(
          { error: 'Supporting doc slot not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
      targetDocId = existingDoc.id;
    } else {
      // ── Create a new doc entry ──────────────────────────────
      const validCategories = ['supporting_document', 'proposal_input', 'other'] as const;
      const category = typeof body.category === 'string' && (validCategories as readonly string[]).includes(body.category)
        ? body.category
        : 'other';
      const label = typeof body.requirementLabel === 'string' && body.requirementLabel.trim()
        ? body.requirementLabel.trim()
        : filename;

      try {
        const [newDoc] = await sql<{ id: string }[]>`
          INSERT INTO proposal_supporting_docs
            (proposal_id, tenant_id, requirement_label, category, is_required, status)
          VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${label}, ${category}, false, 'missing')
          RETURNING id
        `;
        targetDocId = newDoc.id;
      } catch (e) {
        console.error('[portal/proposals/supporting-docs] insert failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    }

    // ── Generate storage key and presigned upload URL ────────
    const storageKey = customerProposalPath(
      tenantSlug,
      proposalId,
      `supporting/${targetDocId}/${filename}`,
    );

    // For presigned URL upload workflow: generate a presigned PUT URL
    // and save metadata. The client uploads directly to S3, then
    // confirms via PATCH to update status.
    // For simplicity, we do a server-side approach: store the metadata now
    // and return a presigned PUT URL.
    const { getSignedPutUrl } = await import('@/lib/storage/s3-client');
    let uploadUrl: string;
    try {
      uploadUrl = await getSignedPutUrl(storageKey, contentType);
    } catch (e) {
      console.error('[portal/proposals/supporting-docs] presign failed:', e);
      return NextResponse.json({ error: 'Storage error', code: 'STORAGE_ERROR' }, { status: 500 });
    }

    // Update the doc row with file metadata and mark as uploaded
    try {
      await sql`
        UPDATE proposal_supporting_docs
        SET storage_key = ${storageKey},
            original_filename = ${filename},
            file_size = ${fileSize},
            content_type = ${contentType},
            status = 'uploaded',
            uploaded_by = ${sessionUser.id}::uuid,
            uploaded_at = now(),
            updated_at = now()
        WHERE id = ${targetDocId}::uuid
          AND tenant_id = ${tenantId}::uuid
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs] update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Determine category/label for the event payload
    const eventCategory = typeof body.category === 'string' ? body.category : 'other';
    const eventLabel = typeof body.requirementLabel === 'string' && body.requirementLabel.trim()
      ? body.requirementLabel.trim()
      : (filename as string);

    await emitEventEnd(startId, {
      result: { proposalId, docId: targetDocId, requirementLabel: eventLabel, filename, category: eventCategory },
    });

    return NextResponse.json({
      data: {
        uploadUrl,
        docId: targetDocId,
        storageKey,
      },
    }, { status: 201 });
  } catch (err) {
    if (startId) {
      await emitEventEnd(startId, { error: { message: err instanceof Error ? err.message : String(err), code: 'HANDLER_THREW' } });
    }
    console.error('[portal/proposals/supporting-docs] error:', err);
    return NextResponse.json(
      { error: 'Internal error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
