import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { resolveUserAccess, hasProposalVisibility } from '@/lib/proposal-access';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { getSignedGetUrl, deleteObject } from '@/lib/storage/s3-client';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; docId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]
 *
 * Get single doc detail + signed download URL.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId, docId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(docId)) {
      return NextResponse.json(
        { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
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
    // CAP-3: verifyTenantAccess ignores membership.scope; gate on the scope-aware resolver so a
    // proposal-scoped tenant_user can't fetch a signed download URL for an out-of-scope proposal's doc.
    if (!hasProposalVisibility(await resolveUserAccess(sessionUser.id, proposalId, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Load doc ─────────────────────────────────────────────
    let doc: {
      id: string;
      proposalId: string;
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
    } | undefined;
    try {
      [doc] = await sql<(typeof doc & object)[]>`
        SELECT id, proposal_id, requirement_label, requirement_source,
               category, is_required, storage_key, original_filename,
               file_size, content_type, status, uploaded_by, uploaded_at,
               reviewed_by, reviewed_at, notes,
               created_at, updated_at
        FROM proposal_supporting_docs
        WHERE id = ${docId}::uuid
          AND proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs/detail] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!doc) {
      return NextResponse.json(
        { error: 'Supporting document not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    let downloadUrl: string | null = null;
    if (doc.storageKey) {
      try {
        downloadUrl = await getSignedGetUrl(doc.storageKey);
      } catch (e) {
        console.error('[portal/proposals/supporting-docs/detail] sign failed:', e);
      }
    }

    return NextResponse.json({
      data: {
        id: doc.id,
        proposalId: doc.proposalId,
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
        downloadUrl,
      },
    });
  } catch (err) {
    console.error('[portal/proposals/supporting-docs/detail] error:', err);
    return NextResponse.json(
      { error: 'Internal error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]
 *
 * Update status (reviewed, approved, waived) or notes. Admin-only for status changes.
 * Body JSON: { status?: string, notes?: string }
 */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId, docId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(docId)) {
      return NextResponse.json(
        { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
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

    // Status changes require tenant_admin or above
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

    enterTenant(tenantId); // RLS choke point — covers the doc lookup + UPDATE on proposal_supporting_docs.

    // ── Parse body ───────────────────────────────────────────
    let body: { status?: unknown; notes?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    // ── Validate status ──────────────────────────────────────
    const validStatuses = ['missing', 'uploaded', 'reviewed', 'approved', 'waived'] as const;
    const newStatus = typeof body.status === 'string' && (validStatuses as readonly string[]).includes(body.status)
      ? body.status
      : null;
    const newNotes = typeof body.notes === 'string' ? body.notes : null;

    // ── Validate status transitions ─────────────────────────
    const VALID_TRANSITIONS: Record<string, string[]> = {
      missing: ['uploaded'],
      uploaded: ['reviewed'],
      reviewed: ['approved', 'waived'],
      approved: ['waived'],
      waived: ['reviewed'],
    };

    // Status transitions to reviewed/approved/waived require tenant_admin
    if (newStatus && ['reviewed', 'approved', 'waived'].includes(newStatus)) {
      if (!hasRoleAtLeast(role, 'tenant_admin')) {
        return NextResponse.json(
          { error: 'Admin role required for status changes', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
    }

    if (newNotes !== null && newNotes.length > 5000) {
      return NextResponse.json(
        { error: 'Notes exceed maximum length (5000 chars)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (!newStatus && newNotes === null) {
      return NextResponse.json(
        { error: 'Nothing to update', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Verify doc exists ────────────────────────────────────
    let existingDoc: { id: string; status: string; storageKey: string | null } | undefined;
    try {
      [existingDoc] = await sql<{ id: string; status: string; storageKey: string | null }[]>`
        SELECT id, status, storage_key FROM proposal_supporting_docs
        WHERE id = ${docId}::uuid
          AND proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs/detail] lookup failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!existingDoc) {
      return NextResponse.json(
        { error: 'Supporting document not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Enforce valid status transitions ─────────────────────
    if (newStatus) {
      // Cannot transition to 'uploaded' without an actual file
      if (newStatus === 'uploaded' && !existingDoc.storageKey) {
        return NextResponse.json(
          { error: 'Cannot mark as uploaded without an attached file', code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
      const allowed = VALID_TRANSITIONS[existingDoc.status];
      if (!allowed || !allowed.includes(newStatus)) {
        return NextResponse.json(
          { error: `Cannot transition from '${existingDoc.status}' to '${newStatus}'`, code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
    }

    // ── Start event for status change ─────────────────────────
    const startId = newStatus ? await emitEventStart({
      namespace: 'proposal',
      type: 'supporting_doc.status_changed',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { proposalId, docId, fromStatus: existingDoc.status, toStatus: newStatus },
    }) : '';

    // ── Apply update ─────────────────────────────────────────
    try {
      if (newStatus && newNotes !== null) {
        await sql`
          UPDATE proposal_supporting_docs
          SET status = ${newStatus},
              notes = ${newNotes},
              reviewed_by = ${['reviewed', 'approved', 'waived'].includes(newStatus) ? sessionUser.id : null}::uuid,
              reviewed_at = ${['reviewed', 'approved', 'waived'].includes(newStatus) ? sql`now()` : null},
              updated_at = now()
          WHERE id = ${docId}::uuid AND tenant_id = ${tenantId}::uuid
        `;
      } else if (newStatus) {
        await sql`
          UPDATE proposal_supporting_docs
          SET status = ${newStatus},
              reviewed_by = ${['reviewed', 'approved', 'waived'].includes(newStatus) ? sessionUser.id : null}::uuid,
              reviewed_at = ${['reviewed', 'approved', 'waived'].includes(newStatus) ? sql`now()` : null},
              updated_at = now()
          WHERE id = ${docId}::uuid AND tenant_id = ${tenantId}::uuid
        `;
      } else if (newNotes !== null) {
        await sql`
          UPDATE proposal_supporting_docs
          SET notes = ${newNotes},
              updated_at = now()
          WHERE id = ${docId}::uuid AND tenant_id = ${tenantId}::uuid
        `;
      }
    } catch (e) {
      console.error('[portal/proposals/supporting-docs/detail] update failed:', e);
      if (newStatus) {
        await emitEventEnd(startId, { error: { message: String(e), code: 'DB_ERROR' } });
      }
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (newStatus) {
      await emitEventEnd(startId, {
        result: { proposalId, docId, fromStatus: existingDoc.status, toStatus: newStatus, actorRole: role },
      });
    }

    return NextResponse.json({ data: { id: docId, status: newStatus ?? 'unchanged' } });
  } catch (err) {
    console.error('[portal/proposals/supporting-docs/detail] error:', err);
    return NextResponse.json(
      { error: 'Internal error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]
 *
 * Remove upload (revert to 'missing'). Does NOT delete the row — just clears
 * the upload fields and reverts status. For required docs, they stay as placeholders.
 * For user-created entries, optionally delete the row entirely.
 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId, docId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(docId)) {
      return NextResponse.json(
        { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
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

    enterTenant(tenantId); // RLS choke point — covers the collaborator check, doc lookup, and revert UPDATE.

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
        console.error('[portal/proposals/supporting-docs/detail] collaborator check failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    }

    // ── Find the doc ─────────────────────────────────────────
    let doc: { id: string; storageKey: string | null; isRequired: boolean; requirementLabel: string } | undefined;
    try {
      [doc] = await sql<{ id: string; storageKey: string | null; isRequired: boolean; requirementLabel: string }[]>`
        SELECT id, storage_key, is_required, requirement_label
        FROM proposal_supporting_docs
        WHERE id = ${docId}::uuid
          AND proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs/detail] delete lookup failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!doc) {
      return NextResponse.json(
        { error: 'Supporting document not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Delete the S3 object if it exists
    if (doc.storageKey) {
      try {
        await deleteObject(doc.storageKey);
      } catch (e) {
        console.error('[portal/proposals/supporting-docs/detail] S3 delete failed (non-fatal):', e);
      }
    }

    // Clear upload fields and revert to 'missing'
    try {
      await sql`
        UPDATE proposal_supporting_docs
        SET storage_key = null,
            original_filename = null,
            file_size = null,
            content_type = null,
            status = 'missing',
            uploaded_by = null,
            uploaded_at = null,
            reviewed_by = null,
            reviewed_at = null,
            updated_at = now()
        WHERE id = ${docId}::uuid AND tenant_id = ${tenantId}::uuid
      `;
    } catch (e) {
      console.error('[portal/proposals/supporting-docs/detail] revert failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'supporting_doc.deleted',
        actor: userActor(sessionUser.id),
        tenantId,
        payload: { proposalId, docId, requirementLabel: doc.requirementLabel },
      });
    } catch (e) {
      console.error('[portal/proposals/supporting-docs/detail] event emission failed:', e);
    }

    return NextResponse.json({ data: { id: docId, status: 'missing' } });
  } catch (err) {
    console.error('[portal/proposals/supporting-docs/detail] error:', err);
    return NextResponse.json(
      { error: 'Internal error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
