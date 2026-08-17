/**
 * DELETE /api/portal/[tenantSlug]/managers/[membershipId]
 *
 * Revoke a partner-manager grant (CAP-2 — the ungrant half of the partner-manager lifecycle;
 * docs/PARTNER_MANAGER_DESIGN.md §8 invariant 4: "manager removal revokes a membership — never
 * delete"). A tenant_admin of THIS company flips the `partner_manager` membership status
 * active → revoked. `lib/partner/scope.ts` + the Managers table both filter status='active', so the
 * company immediately drops out of that partner's managed stable — access is cut, the row is kept.
 *
 * Auth: tenant_admin+ WITH access to this tenant. sqlBypass with a strict WHERE (this tenant's
 * ACTIVE partner_manager membership only) — the row belongs to the partner user (cross-scope), and
 * the compare-and-swap makes a double-revoke a no-op 404. Mirrors the grant's finder event.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, sqlBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';

export async function DELETE(_request: Request, { params }: { params: Promise<{ tenantSlug: string; membershipId: string }> }) {
  try {
    const { tenantSlug, membershipId } = await params;
    if (!isValidUUID(membershipId)) {
      return NextResponse.json({ error: 'Invalid membership id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Only a company admin can remove a manager', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // CAS revoke — only an ACTIVE partner_manager membership for THIS tenant. Never deleted.
    let rows: Array<{ userId: string }>;
    try {
      rows = await sqlBypass<Array<{ userId: string }>>`
        UPDATE user_memberships
        SET status = 'revoked'
        WHERE id = ${membershipId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND source = 'partner_manager'
          AND status = 'active'
        RETURNING user_id AS "userId"`;
    } catch (dbErr) {
      console.error('[portal/managers] revoke failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Manager membership not found or already revoked', code: 'NOT_FOUND' }, { status: 404 });
    }

    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'partner.manager_revoked',
        actor: userActor(u.id, u.email ?? undefined),
        tenantId,
        payload: { membershipId, revokedUserId: rows[0].userId },
      });
    } catch (evtErr) {
      console.error('[portal/managers] manager_revoked emit failed (non-fatal):', evtErr);
    }

    return NextResponse.json({ data: { revoked: true } });
  } catch (error) {
    console.error('[portal/managers] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove manager', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
