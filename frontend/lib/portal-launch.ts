/**
 * Portal launch + shadow-admin + guardrail flow (greenfield L3, mig 097).
 *
 * A PORTAL binds a card to a proposal build (multi-proposal via label). At purchase
 * we assume a scoped SHADOW-ADMIN grant (T&C) so RFP admins can jumpstart/strawman
 * INSIDE the tenant space — until the customer admin reviews + ACCEPTS the guardrail
 * template, which freezes the guardrails on the portal and launches it. The customer
 * can revoke shadow access at any time. This replaces the unbounded god-view with a
 * per-portal, auditable, revocable grant.
 */

import { withTenant } from '@/lib/rls';
import { sql } from '@/lib/db';

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

/** Create a portal for a card (status guardrails_pending). Multi-proposal via label. */
export async function createPortal(
  tenantId: string,
  opportunityId: string,
  proposalId: string | null,
  label: string,
  createdBy: string | null,
): Promise<{ portalId: string } | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      INSERT INTO proposal_portals (tenant_id, opportunity_id, proposal_id, label, created_by)
      VALUES (${tenantId}::uuid, ${opportunityId}::uuid, ${proposalId}, ${label}, ${createdBy})
      ON CONFLICT (tenant_id, opportunity_id, label) DO NOTHING
      RETURNING id
    `;
    return rows.length > 0 ? { portalId: rows[0].id } : null;
  });
}

/** Bind a provisioned proposal to the portal (the V0→V1 substrate). Idempotent: only fills a null. */
export async function linkPortalProposal(tenantId: string, portalId: string, proposalId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      UPDATE proposal_portals SET proposal_id = ${proposalId}::uuid
      WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid AND proposal_id IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  });
}

/** Assume the T&C shadow-admin grant at purchase (role-based when admin_user_id is null). */
export async function assumeShadowAdmin(
  tenantId: string,
  portalId: string,
  opts: { adminUserId?: string | null; adminEmail?: string | null; source?: 't_and_c' | 'invite'; grantedBy?: string | null },
): Promise<{ grantId: string }> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx<Array<{ id: string }>>`
      INSERT INTO shadow_admin_grants (tenant_id, portal_id, admin_user_id, admin_email, source, granted_by)
      VALUES (${tenantId}::uuid, ${portalId}::uuid, ${opts.adminUserId ?? null}, ${opts.adminEmail ?? null},
              ${opts.source ?? 't_and_c'}, ${opts.grantedBy ?? null})
      RETURNING id
    `;
    return { grantId: row.id };
  });
}

/** Is this admin allowed to act on this portal? (scoped replacement for the god-view). */
export async function portalAdminAccess(tenantId: string, portalId: string, adminUserId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      SELECT id FROM shadow_admin_grants
      WHERE tenant_id = ${tenantId}::uuid AND portal_id = ${portalId}::uuid AND active = true
        AND (admin_user_id = ${adminUserId}::uuid OR admin_user_id IS NULL)
      LIMIT 1
    `;
    return rows.length > 0;
  });
}

/** Customer admin accepts the guardrails: freeze config on the portal + launch it. */
export async function acceptGuardrails(
  tenantId: string,
  portalId: string,
  guardrailConfig: unknown,
  opts: { revokeShadow?: boolean; acceptedBy?: string | null } = {},
): Promise<{ launched: boolean }> {
  return withTenant(tenantId, async (tx) => {
    const updated = await tx<Array<{ id: string }>>`
      UPDATE proposal_portals
      SET guardrail_config = ${jsonParam(guardrailConfig)},
          status = 'launched', launched_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid AND status = 'guardrails_pending'
      RETURNING id
    `;
    if (updated.length === 0) return { launched: false };
    // On accept, the customer may keep or drop shadow access (their choice).
    if (opts.revokeShadow) {
      await tx`
        UPDATE shadow_admin_grants SET active = false, revoked_by = ${opts.acceptedBy ?? null}, revoked_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND portal_id = ${portalId}::uuid AND active = true
      `;
    }
    return { launched: true };
  });
}

/** Customer revokes shadow-admin access (stop us seeing their material). Reversible via re-invite. */
export async function revokeShadowAdmin(tenantId: string, portalId: string, revokedBy: string | null): Promise<{ revoked: number }> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      UPDATE shadow_admin_grants SET active = false, revoked_by = ${revokedBy}, revoked_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND portal_id = ${portalId}::uuid AND active = true
      RETURNING id
    `;
    return { revoked: rows.length };
  });
}

/** Advance a portal's lifecycle (execute → closeout → archived / abandoned). */
export async function setPortalStatus(tenantId: string, portalId: string, status: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx`UPDATE proposal_portals SET status = ${status} WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid`;
  });
}
