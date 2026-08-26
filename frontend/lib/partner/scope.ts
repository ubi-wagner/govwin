/**
 * Partner-manager scoping helpers (docs/PARTNER_MANAGER_DESIGN.md §3, D2/D5).
 *
 * A partner sees ONLY its stable: its own org (kind='partner_org') + the client companies it
 * owns (tenants.owner_id) or manages (an active 'partner_manager' membership). Descend is gated
 * on holding the concrete tenant_admin membership the session will pin to — owning a tenant
 * without a membership grants no portal access (creation/approval always writes the membership).
 *
 * Reads run on the BYPASS (owner) pool — cross-tenant scans of the RLS-off tenants /
 * user_memberships tables (the same ones verifyTenantAccess reads). No tenant context needed.
 */
import { sqlBypass } from '@/lib/db';

export interface ScopeTenant {
  id: string;
  slug: string;
  name: string;
  kind: string;
  relation: 'owner' | 'manager';
  createdAt: string;
}

/** The partner's OWN org (kind='partner_org', owner_id = them), or null if not provisioned yet. */
export async function partnerOwnOrg(userId: string): Promise<ScopeTenant | null> {
  if (!userId) return null;
  const [row] = await sqlBypass<ScopeTenant[]>`
    SELECT id, slug, name, kind, 'owner'::text AS relation, created_at AS "createdAt"
    FROM tenants
    WHERE owner_id = ${userId}::uuid AND kind = 'partner_org' AND archived_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1`;
  return row ?? null;
}

/**
 * The stable — client companies (kind='standard') the partner OWNS or MANAGES. Excludes the
 * partner's own org (shown separately). Empty userId → [] (no query).
 */
export async function partnerScopeTenants(userId: string): Promise<ScopeTenant[]> {
  if (!userId) return [];
  return sqlBypass<ScopeTenant[]>`
    SELECT t.id, t.slug, t.name, t.kind,
           CASE WHEN t.owner_id = ${userId}::uuid THEN 'owner' ELSE 'manager' END AS relation,
           t.created_at AS "createdAt"
    FROM tenants t
    LEFT JOIN user_memberships m
      ON m.tenant_id = t.id AND m.user_id = ${userId}::uuid
         AND m.status = 'active' AND m.source = 'partner_manager'
    WHERE t.archived_at IS NULL AND t.kind = 'standard'
      AND (t.owner_id = ${userId}::uuid OR m.id IS NOT NULL)
    ORDER BY t.created_at DESC`;
}

/**
 * May this partner descend into this tenant? True when they hold the ACTIVE tenant_admin
 * membership the session pin will assume, at a non-archived tenant they are actually in scope for.
 * Empty inputs → false (no query).
 *
 * THIS MUST AGREE WITH partnerScopeTenants. It did not, and the disagreement rendered a dead
 * control: the console lists a company when the partner OWNS it (`t.owner_id = them`) *or* holds a
 * `partner_manager` membership, while this gate accepted only membership `source IN
 * ('home','partner_manager')`. Paul Jackson owns Foundation and holds an active tenant_admin
 * membership there with source `collaborator` — the company-appointed shadow-admin grant that
 * predates the partner-manager model — so /partner rendered "Open workspace →" for a company
 * /api/partner/enter then refused, bouncing him back to /partner with no explanation.
 *
 * Authority still comes from the membership: an owner with no active tenant_admin membership is
 * refused exactly as before, which is the invariant the D2 design states ("owning a tenant without
 * a membership grants no portal access"). What no longer vetoes is the `source` label alone, which
 * records how the membership arose, not what it permits. Scope is now: the tenant is one this
 * partner owns, or one they manage.
 */
export async function partnerCanEnter(userId: string, tenantId: string): Promise<boolean> {
  if (!userId || !tenantId) return false;
  const [row] = await sqlBypass<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM user_memberships m
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${userId}::uuid AND m.tenant_id = ${tenantId}::uuid
        AND m.status = 'active' AND m.role = 'tenant_admin'
        AND t.archived_at IS NULL
        AND (t.owner_id = ${userId}::uuid OR m.source IN ('home','partner_manager'))
    ) AS ok`;
  return !!row?.ok;
}

/**
 * D5 uniqueness: is this email already an ACTIVE tenant owner/admin (a 'home' or 'partner_manager'
 * membership)? Such an email may NOT be a new company's admin. The same email MAY still be a
 * collaborator/partner_user elsewhere — those sources don't count here. Empty email → false.
 */
export async function emailActiveAsTenantAdmin(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const [row] = await sqlBypass<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM user_memberships m
      JOIN users u ON u.id = m.user_id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE lower(u.email) = ${e}
        AND m.status = 'active' AND m.source IN ('home','partner_manager')
        AND t.archived_at IS NULL
    ) AS ok`;
  return !!row?.ok;
}
