/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/amendments/[amendmentId]/document
 *
 * The amendment's announcing document (mig 190 `solicitation_amendments.document_id`),
 * for the tenant told "Amendment 0002 changed the page limit" who could not previously
 * OPEN Amendment 0002. Access is FLAG-GATED: the tenant may fetch the document only for
 * an amendment that was fanned onto THIS proposal of THEIRS — a bare amendment id from
 * another solicitation (or a tenant never flagged) is a 404, so this never becomes a
 * generic read into the admin document store.
 *
 * Returns a 15-minute signed GET URL (the house pattern — rfp-document/[id]/signed-url).
 * Auth: tenant_user+ with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { getSignedGetUrl } from '@/lib/storage/s3-client';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; amendmentId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId, amendmentId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(amendmentId)) {
      return NextResponse.json({ error: 'Invalid ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(user.role) ? user.role : null;
    if (!role || !user.id || !hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(user.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point — in the handler's own frame.

    try {
      // The flag IS the grant: this tenant, this proposal, this amendment — and the
      // amendment must actually carry a document.
      const [row] = await sql<Array<{ storageKey: string | null; originalFilename: string | null }>>`
        SELECT d.storage_key AS "storageKey", d.original_filename AS "originalFilename"
        FROM proposal_amendment_flags f
        JOIN solicitation_amendments a ON a.id = f.amendment_id
        LEFT JOIN solicitation_documents d ON d.id = a.document_id
        WHERE f.proposal_id = ${proposalId}::uuid
          AND f.tenant_id = ${tenantId}::uuid
          AND f.amendment_id = ${amendmentId}::uuid
        LIMIT 1
      `;
      if (!row) {
        return NextResponse.json({ error: 'Amendment not found for this proposal', code: 'NOT_FOUND' }, { status: 404 });
      }
      if (!row.storageKey) {
        return NextResponse.json({ error: 'This amendment has no attached document', code: 'NOT_FOUND' }, { status: 404 });
      }
      const url = await getSignedGetUrl(row.storageKey, 15 * 60);
      return NextResponse.json({ data: { url, filename: row.originalFilename } });
    } catch (e) {
      console.error('[amendment-document] lookup failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[amendment-document] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
