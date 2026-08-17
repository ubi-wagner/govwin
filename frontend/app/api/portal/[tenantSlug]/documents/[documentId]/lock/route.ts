/**
 * POST /api/portal/[tenantSlug]/documents/[documentId]/lock
 *
 * "Full lock for download" (#18 branch-and-promote). Marks a document 'final' and promotes
 * its WORKING copies (regenerated from a past proposal) to new FOUNDATION atoms in the
 * library, carrying their derived_from lineage back to the seminal atoms. Non-destructive:
 * the seminal originals are untouched. Audited (library:document.locked).
 *
 * Auth: any tenant member (tenant_user+) with tenant access — it's their own document.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { lockDocumentAndPromote } from '@/lib/documents/lock-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string; documentId: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, documentId } = await ctx.params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!isValidUUID(documentId)) {
      return NextResponse.json({ error: 'Invalid document id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS: tenant_documents is RLS-forced — the own-tenant lookup below returns
    // 0 rows under govtech_app without the context (mig 184).

    // The document must belong to THIS tenant (never trust an id alone).
    let owned: { id: string }[];
    try {
      owned = await sql<{ id: string }[]>`
        SELECT id FROM tenant_documents WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[documents/lock] ownership check failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (owned.length === 0) {
      return NextResponse.json({ error: 'Document not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    let result: { locked: boolean; promoted: number };
    try {
      result = await lockDocumentAndPromote(tenantId, documentId);
    } catch (e) {
      console.error('[documents/lock] lock/promote failed:', e);
      return NextResponse.json({ error: 'Could not lock the document', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!result.locked) {
      return NextResponse.json({ error: 'Document not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'document.locked',
        actor: userActor(su.id, su.email ?? undefined),
        tenantId,
        payload: { documentId, promotedAtoms: result.promoted },
      });
    } catch (e) { console.error('[documents/lock] event emit failed (non-fatal):', e); }

    return NextResponse.json({ data: { locked: true, promotedAtoms: result.promoted } });
  } catch (e) {
    console.error('[documents/lock] POST failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
