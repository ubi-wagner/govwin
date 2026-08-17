/**
 * PUT /api/portal/[tenantSlug]/documents/[documentId]/save
 *
 * Save a standalone document's canvas (Tier 2, #3). Same optimistic-lock contract
 * as the section save the canvas editor already speaks: the client sends the
 * version it loaded as `baseVersion`; the update is a compare-and-swap so a stale
 * write 409s instead of silently clobbering a concurrent save.
 *
 * Body: { content: CanvasDocument, baseVersion?: number }
 * Returns: { data: { documentId, version } }   ·   409 { currentVersion } on conflict
 *
 * Auth: tenant_user+ with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { countNodes } from '@/lib/documents/starter';
import { validateStandaloneCanvas, type CanvasDocument } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string; documentId: string }>;
}

export async function PUT(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, documentId } = await ctx.params;
    if (!isValidUUID(documentId)) {
      return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS: tenant_documents is RLS-forced — without the context this doc's
    // own-tenant lookup returns 0 rows under govtech_app → the save 404s a document the tenant owns.

    let body: { content?: unknown; baseVersion?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    if (body.content === undefined || body.content === null || typeof body.content !== 'object') {
      return NextResponse.json({ error: 'content (CanvasDocument) is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    // Strip the transient AI-revision marker the editor may attach (never persisted).
    if ('__revisionMeta' in (body.content as Record<string, unknown>)) {
      const cleaned = { ...(body.content as Record<string, unknown>) };
      delete cleaned.__revisionMeta;
      body.content = cleaned;
    }
    if (JSON.stringify(body.content).length > 2_000_000) {
      return NextResponse.json({ error: 'Content too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    const content = body.content as CanvasDocument;

    // ── Load the document (tenant-scoped — never trust the id alone) ──
    let doc: { id: string; version: number; status: string; title: string } | undefined;
    try {
      [doc] = await sql<{ id: string; version: number; status: string; title: string }[]>`
        SELECT id, version, status, title FROM tenant_documents
        WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/documents/save] load failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!doc) {
      return NextResponse.json({ error: 'Document not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (doc.status === 'final') {
      return NextResponse.json({ error: 'This document is final and cannot be edited', code: 'DOCUMENT_FINAL' }, { status: 423 });
    }

    // Keep the row title in step with the canvas title when the editor renames it.
    const nextTitle = typeof content?.metadata?.title === 'string' && content.metadata.title.trim()
      ? content.metadata.title.trim().slice(0, 200)
      : doc.title;
    const nodeCount = countNodes(content);

    // Real optimistic lock: swap against the version the CLIENT loaded.
    const base = typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) ? body.baseVersion : doc.version;
    const nextVersion = base + 1;

    let result;
    try {
      result = await sql`
        UPDATE tenant_documents
        SET canvas = ${sql.json(content as unknown as Parameters<typeof sql.json>[0])},
            title = ${nextTitle},
            node_count = ${nodeCount},
            version = ${nextVersion},
            updated_at = now()
        WHERE id = ${documentId}::uuid AND version = ${base}
      `;
    } catch (e) {
      console.error('[portal/documents/save] update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (result.count === 0) {
      let current: { version: number } | undefined;
      try {
        [current] = await sql<{ version: number }[]>`SELECT version FROM tenant_documents WHERE id = ${documentId}::uuid`;
      } catch (e) {
        console.error('[portal/documents/save] version re-fetch failed:', e);
      }
      return NextResponse.json(
        { error: 'This document was changed by someone else since you opened it.', code: 'CONFLICT', currentVersion: current?.version ?? null },
        { status: 409 },
      );
    }

    // Size/format compliance floor (advisory) — the SAME ruler proposals use, run
    // against the document's OWN declared limits (max_pages/max_slides/font/images),
    // so a "2-page flier" that grew to 3 pages, or a deck over its slide cap, is
    // flagged WHILE editing. Non-blocking: standalone docs have no lock gate.
    let complianceWarnings: { code: string; message: string }[] = [];
    try {
      complianceWarnings = validateStandaloneCanvas(content).map((v) => ({ code: v.code, message: v.message }));
    } catch (e) { console.error('[portal/documents/save] compliance check failed (non-fatal):', e); }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'document.updated',
        actor: userActor(su.id, su.email ?? undefined),
        tenantId,
        payload: { documentId, title: nextTitle, version: nextVersion, compliant: complianceWarnings.length === 0 },
      });
    } catch (e) { console.error('[portal/documents/save] event emit failed (non-fatal):', e); }

    return NextResponse.json({ data: { documentId, version: nextVersion, complianceWarnings } });
  } catch (e) {
    console.error('[portal/documents/save] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
