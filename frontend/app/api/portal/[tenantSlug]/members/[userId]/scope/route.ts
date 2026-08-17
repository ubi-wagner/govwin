/**
 * PATCH /api/portal/[tenantSlug]/members/[userId]/scope   (CAP-3)
 *
 * A tenant_admin scopes an internal tenant_user's proposal access: tenant-wide (default) OR limited
 * to a chosen set of proposals. Persisted in the membership `scope` jsonb
 * ({ proposalScoped, proposals[] }) — the single source of truth `resolveUserAccess` +
 * the proposals list both read. RESTRICTING only: an unscoped user stays tenant-wide.
 *
 * Auth: tenant_admin+ WITH access to this tenant. Only an ACTIVE tenant_user membership can be
 * scoped (never an admin). Proposal ids are validated against THIS tenant, so a scope can't smuggle
 * in a foreign proposal. sqlBypass for the membership write (the target row is another user's).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, sqlBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; userId: string }> }) {
  try {
    const { tenantSlug, userId } = await params;
    if (!isValidUUID(userId)) {
      return NextResponse.json({ error: 'Invalid user id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Only a company admin can scope a member', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { proposalScoped?: unknown; proposals?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const proposalScoped = body.proposalScoped === true;
    const requestedIds = Array.isArray(body.proposals) ? (body.proposals as unknown[]).filter((p): p is string => typeof p === 'string' && isValidUUID(p)) : [];

    // Validate the requested proposals belong to THIS tenant (drop any that don't) — a scope can
    // never smuggle in a foreign proposal id.
    let validIds: string[] = [];
    try {
      if (proposalScoped && requestedIds.length > 0) {
        const rows = await sqlBypass<Array<{ id: string }>>`
          SELECT id FROM proposals WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${requestedIds}::uuid[])`;
        validIds = rows.map((r) => r.id);
      }
    } catch (dbErr) {
      console.error('[portal/members/scope] proposal validation failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    const scope = proposalScoped ? { proposalScoped: true, proposals: validIds } : {};

    // Write ONLY to an active tenant_user membership for this tenant (never an admin).
    let updated: Array<{ id: string }>;
    try {
      updated = await sqlBypass<Array<{ id: string }>>`
        UPDATE user_memberships
        SET scope = ${sqlBypass.json(scope)}
        WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
          AND status = 'active' AND role = 'tenant_user'
        RETURNING id`;
    } catch (dbErr) {
      console.error('[portal/members/scope] scope write failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (updated.length === 0) {
      return NextResponse.json({ error: 'No active team-member membership found to scope', code: 'NOT_FOUND' }, { status: 404 });
    }

    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'member.scope_updated',
        actor: userActor(u.id, u.email ?? undefined),
        tenantId,
        payload: { targetUserId: userId, proposalScoped, proposalCount: validIds.length },
      });
    } catch (evtErr) {
      console.error('[portal/members/scope] member.scope_updated emit failed (non-fatal):', evtErr);
    }

    return NextResponse.json({ data: { proposalScoped, proposals: validIds } });
  } catch (error) {
    console.error('[portal/members/scope] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update member scope', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
