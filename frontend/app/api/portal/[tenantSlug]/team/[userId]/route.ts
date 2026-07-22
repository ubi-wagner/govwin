/**
 * Deactivate / reactivate a TEAM MEMBER (tenant employee) — tenant_admin only.
 *
 *   DELETE /api/portal/[tenantSlug]/team/[userId]  → deactivate (revoke home membership)
 *   POST   /api/portal/[tenantSlug]/team/[userId]  → reactivate
 *
 * A member is NEVER hard-deleted — deactivating revokes their home/manual membership
 * (status='revoked'), which removes access now that verifyTenantAccess is purely
 * membership-based, while the users row + all history endure. Reactivating flips it back
 * to 'active'. Same never-delete/reconstitute principle as collaborators, generalized to
 * any role. See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';

type Ctx = { params: Promise<{ tenantSlug: string; userId: string }> };

async function gate(ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const { tenantSlug, userId } = await ctx.params;
  if (!isValidUUID(userId)) return { error: NextResponse.json({ error: 'Invalid user id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!hasRoleAtLeast(role, 'tenant_admin')) return { error: NextResponse.json({ error: 'tenant_admin role required', code: 'FORBIDDEN' }, { status: 403 }) };
  return { actor: u, tenantId, targetUserId: userId };
}

async function setMemberStatus(tenantId: string, userId: string, status: 'active' | 'revoked'): Promise<string | null> {
  // Only home/manual memberships are "team members"; a collaborator membership is managed
  // through the proposal collaborator flow, not here.
  const [row] = await sql<{ role: string }[]>`
    UPDATE user_memberships
    SET status = ${status}
    WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND source IN ('home', 'manual')
    RETURNING role`;
  return row?.role ?? null;
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const g = await gate(ctx);
    if (g.error) return g.error;
    const { actor, tenantId, targetUserId } = g;

    if (targetUserId === actor.id) {
      return NextResponse.json({ error: 'You cannot deactivate yourself', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    // Never leave a company with no active admin.
    const [{ admins }] = await sql<{ admins: number }[]>`
      SELECT count(*)::int AS admins FROM user_memberships
      WHERE tenant_id = ${tenantId} AND role = 'tenant_admin' AND status = 'active'
        AND source IN ('home', 'manual') AND user_id <> ${targetUserId}`;
    const [{ isAdmin }] = await sql<{ isAdmin: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM user_memberships WHERE user_id = ${targetUserId} AND tenant_id = ${tenantId}
          AND role = 'tenant_admin' AND status = 'active' AND source IN ('home', 'manual')
      ) AS "isAdmin"`;
    if (isAdmin && admins === 0) {
      return NextResponse.json({ error: 'Cannot deactivate the last active admin', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const role = await setMemberStatus(tenantId, targetUserId, 'revoked');
    if (!role) return NextResponse.json({ error: 'Team member not found', code: 'NOT_FOUND' }, { status: 404 });

    await emitEventSingle({
      namespace: 'capture',
      type: 'team_member.deactivated',
      actor: userActor(actor.id ?? '', actor.email ?? undefined),
      tenantId,
      payload: { userId: targetUserId, role },
    });
    return NextResponse.json({ data: { active: false } });
  } catch (err) {
    console.error('[portal/team/deactivate] error', err);
    return NextResponse.json({ error: 'Failed to deactivate', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const g = await gate(ctx);
    if (g.error) return g.error;
    const { actor, tenantId, targetUserId } = g;

    const role = await setMemberStatus(tenantId, targetUserId, 'active');
    if (!role) return NextResponse.json({ error: 'Team member not found', code: 'NOT_FOUND' }, { status: 404 });

    await emitEventSingle({
      namespace: 'capture',
      type: 'team_member.reactivated',
      actor: userActor(actor.id ?? '', actor.email ?? undefined),
      tenantId,
      payload: { userId: targetUserId, role },
    });
    return NextResponse.json({ data: { active: true } });
  } catch (err) {
    console.error('[portal/team/reactivate] error', err);
    return NextResponse.json({ error: 'Failed to reactivate', code: 'DB_ERROR' }, { status: 500 });
  }
}

/**
 * PATCH /api/portal/[tenantSlug]/team/[userId]  → change a member's role.
 *
 * Body: { role: 'tenant_admin' | 'tenant_user' }. Promotes/demotes a home/manual member
 * (a partner_user member can be promoted into the team this way too). tenant_admin only.
 * Guards: you can't change your own role (no self-lockout), and you can't demote the last
 * active admin (never leave a company adminless).
 */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const g = await gate(ctx);
    if (g.error) return g.error;
    const { actor, tenantId, targetUserId } = g;

    let body: { role?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const ALLOWED = ['tenant_admin', 'tenant_user'];
    const newRole = typeof body.role === 'string' ? body.role : '';
    if (!ALLOWED.includes(newRole)) {
      return NextResponse.json({ error: 'role must be tenant_admin or tenant_user', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (targetUserId === actor.id) {
      return NextResponse.json({ error: 'You cannot change your own role', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Current role of the target's team (home/manual) membership.
    const [cur] = await sql<{ role: string }[]>`
      SELECT role FROM user_memberships
      WHERE user_id = ${targetUserId} AND tenant_id = ${tenantId} AND source IN ('home', 'manual')
      LIMIT 1`;
    if (!cur) return NextResponse.json({ error: 'Team member not found', code: 'NOT_FOUND' }, { status: 404 });
    if (cur.role === newRole) return NextResponse.json({ data: { role: newRole, changed: false } });

    // Never demote the last active admin.
    if (cur.role === 'tenant_admin' && newRole !== 'tenant_admin') {
      const [{ admins }] = await sql<{ admins: number }[]>`
        SELECT count(*)::int AS admins FROM user_memberships
        WHERE tenant_id = ${tenantId} AND role = 'tenant_admin' AND status = 'active'
          AND source IN ('home', 'manual') AND user_id <> ${targetUserId}`;
      if (admins === 0) {
        return NextResponse.json({ error: 'Cannot demote the last active admin', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
    }

    const [row] = await sql<{ role: string }[]>`
      UPDATE user_memberships SET role = ${newRole}
      WHERE user_id = ${targetUserId} AND tenant_id = ${tenantId} AND source IN ('home', 'manual')
      RETURNING role`;
    if (!row) return NextResponse.json({ error: 'Team member not found', code: 'NOT_FOUND' }, { status: 404 });

    await emitEventSingle({
      namespace: 'capture',
      type: 'team_member.role_changed',
      actor: userActor(actor.id ?? '', actor.email ?? undefined),
      tenantId,
      payload: { userId: targetUserId, fromRole: cur.role, toRole: newRole },
    });
    return NextResponse.json({ data: { role: newRole, changed: true } });
  } catch (err) {
    console.error('[portal/team/role] error', err);
    return NextResponse.json({ error: 'Failed to change role', code: 'DB_ERROR' }, { status: 500 });
  }
}
