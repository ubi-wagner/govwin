/**
 * DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/collaborators/[collaboratorId]
 *
 * Revokes all stage access for a collaborator. Sets access_revoked_at on all
 * collaborator_stage_access rows and removes the proposal_collaborators record.
 *
 * Auth: tenant_admin only (canManageTeam enforced).
 * Returns: { data: { collaboratorId, revokedAt } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; collaboratorId: string }>;
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'tenant_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, proposalId, collaboratorId } = await ctx.params;

    if (!isValidUUID(proposalId) || !isValidUUID(collaboratorId)) {
      return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Verify collaborator belongs to this proposal + tenant
    let collab: { id: string; userId: string | null; email: string } | undefined;
    try {
      [collab] = await sql<{ id: string; userId: string | null; email: string }[]>`
        SELECT pc.id, pc.user_id, pc.email
        FROM proposal_collaborators pc
        JOIN proposals p ON p.id = pc.proposal_id
        WHERE pc.id = ${collaboratorId}::uuid
          AND pc.proposal_id = ${proposalId}::uuid
          AND p.tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[collaborators/delete] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!collab) {
      return NextResponse.json({ error: 'Collaborator not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const revokedAt = new Date().toISOString();

    // Soft-revoke stage access (keep the rows — access reads filter access_revoked_at).
    try {
      await sql`
        UPDATE collaborator_stage_access
        SET access_revoked_at = now()
        WHERE collaborator_id = ${collaboratorId}::uuid
          AND proposal_id = ${proposalId}::uuid
          AND access_revoked_at IS NULL
      `;
    } catch (e) {
      console.error('[collaborators/delete] stage access revoke failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Collaborators are NEVER hard-deleted — mark inactive (revoked_at) so the full
    // history is preserved (they may have contributed once and that record must
    // endure). Access-granting reads filter revoked_at IS NULL; the Team list still
    // shows them (badged inactive); a re-invite reactivates this same row.
    try {
      await sql`
        UPDATE proposal_collaborators
        SET revoked_at = now()
        WHERE id = ${collaboratorId}::uuid
          AND proposal_id = ${proposalId}::uuid
      `;
    } catch (e) {
      console.error('[collaborators/delete] collaborator revoke failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Multi-membership hygiene: if this was the collaborator's LAST active collaboration
    // at this tenant, revoke their 'collaborator' membership so they no longer reach the
    // portal. The source guard means a home/manual membership (e.g. they are actually an
    // admin here) is NEVER revoked. Best-effort — the collaborator is already removed.
    // See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
    let membershipRevoked = false;
    if (collab.userId) {
      try {
        const [stillCollaborating] = await sql`
          SELECT 1 FROM proposal_collaborators pc
          JOIN proposals p ON p.id = pc.proposal_id
          WHERE pc.user_id = ${collab.userId}::uuid AND p.tenant_id = ${tenantId}::uuid
            AND pc.revoked_at IS NULL
          LIMIT 1
        `;
        if (!stillCollaborating) {
          const revoked = await sql`
            UPDATE user_memberships
            SET status = 'revoked'
            WHERE user_id = ${collab.userId}::uuid AND tenant_id = ${tenantId}::uuid
              AND source = 'collaborator' AND status = 'active'
            RETURNING id
          `;
          membershipRevoked = revoked.length > 0;
        }
      } catch (e) {
        console.error('[collaborators/delete] membership revoke check failed:', e);
      }
    }

    // Emit event
    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'collaborator.access_revoked',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: { proposalId, collaboratorId, collaboratorEmail: collab.email, revokedAt, membershipRevoked },
      });
    } catch {
      // Best-effort
    }

    return NextResponse.json({ data: { collaboratorId, revokedAt, membershipRevoked } });
  } catch (e) {
    console.error('[collaborators/delete] DELETE error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
