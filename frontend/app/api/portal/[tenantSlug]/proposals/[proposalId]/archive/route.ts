/**
 * Archive lifecycle — POST /api/portal/[tenantSlug]/proposals/[proposalId]/archive
 *   { action: 'restore' } → un-archive back to 'submitted'.
 *   { action: 'delete' }  → permanently delete an archived proposal (FK-safe: financial/audit rows
 *                           are unlinked + preserved, transient rows removed, the proposal deleted).
 *
 * Auth: tenant_admin or above with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { archiveProposal, restoreProposal } from '@/lib/proposal-archive';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(user.role) ? user.role : null;
    if (!role || !user.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
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
    enterTenant(tenantId);

    let body: { action?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.action !== 'archive' && body.action !== 'restore') {
      return NextResponse.json({ error: "action must be 'archive' or 'restore'", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const actor = { actorId: user.id, actorEmail: user.email ?? null, role };
    try {
      if (body.action === 'archive') {
        const { archived, workflowsArchived } = await archiveProposal({ ...actor, proposalId, tenantId });
        if (!archived) {
          return NextResponse.json({ error: 'Portal is already archived (or not found)', code: 'CONFLICT' }, { status: 409 });
        }
        return NextResponse.json({ data: { archived: true, workflowsArchived } });
      }
      const { restored } = await restoreProposal({ ...actor, proposalId, tenantId });
      if (!restored) {
        return NextResponse.json({ error: 'Portal is not archived (nothing to restore)', code: 'CONFLICT' }, { status: 409 });
      }
      return NextResponse.json({ data: { restored: true } });
    } catch (e) {
      console.error('[proposals/archive] action failed', e);
      return NextResponse.json({ error: 'Archive action failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[proposals/archive] POST error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
