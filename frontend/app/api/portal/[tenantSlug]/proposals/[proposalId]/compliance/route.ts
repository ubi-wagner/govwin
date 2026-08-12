import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { getObjectBuffer } from '@/lib/storage/s3-client';
import { customerProposalPath } from '@/lib/storage/paths';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/compliance
 *
 * Returns the frozen compliance.json snapshot from the proposal's S3 folder.
 * This snapshot is created during proposal provisioning.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    // Partner-containment: the compliance matrix is a proposal-wide read for tenant members
    // (tenant_user+); external collaborators (partner_user) pass verifyTenantAccess on their
    // membership, so a role floor is required to keep them out of proposals they're not on.
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point: pin tenant context in the handler's own frame

    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Verify proposal belongs to tenant
    const [proposal] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // The compliance MATRIX is the LIVE proposal_compliance_matrix: one requirement row
    // per required item, whose status advances not_addressed → satisfied as sections
    // lock/unlock. It is the authoritative source (the proposal workspace reads it
    // directly too), so this endpoint reads it from the DB.
    //
    // The frozen compliance.json object-storage snapshot is DIFFERENT data — the
    // format-rules spec (font/margins/page-limits) captured at provision for audit. It is
    // NOT a matrix (no items, no live status), so it must never stand in for the matrix:
    // returning it drops every requirement row and never reflects lock advancement. That
    // is exactly what happened once real object storage actually persisted the file (the
    // old S3-first read only ever fell through to the DB because storage was a no-op in
    // the sandbox). Read the matrix from the DB; attach the frozen format spec alongside
    // under `formatSpec` so no audit data is lost.
    let items: Array<{
      id: string;
      requirementText: string;
      status: string;
      notes: string | null;
      sectionId: string | null;
    }> = [];
    try {
      items = await sql<{
        id: string;
        requirementText: string;
        status: string;
        notes: string | null;
        sectionId: string | null;
      }[]>`
        SELECT id, requirement_text, status, notes, section_id
        FROM proposal_compliance_matrix
        WHERE proposal_id = ${proposalId}::uuid
        ORDER BY requirement_text ASC
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/compliance] matrix read error:', dbErr);
      return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Best-effort: attach the frozen format-rules spec (audit snapshot) if present.
    let formatSpec: unknown = null;
    try {
      const buffer = await getObjectBuffer(customerProposalPath(tenantSlug, proposalId, 'compliance.json'));
      if (buffer) formatSpec = JSON.parse(buffer.toString('utf-8'));
    } catch (s3Err) {
      console.error('[api/portal/proposals/compliance] format-spec read error (non-fatal):', s3Err);
    }

    return NextResponse.json({ data: { items, source: 'database', formatSpec } });
  } catch (e) {
    console.error('[api/portal/proposals/compliance] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
