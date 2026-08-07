/**
 * Per-tenant rollup stats for the partner console cards (docs/PARTNER_MANAGER_DESIGN.md §3a).
 * One query over the partner's scope tenants: buckets, pins (live opportunity cards), proposals
 * (live builds), portals, and the admin POC (the tenant's home tenant_admin).
 *
 * BYPASS (owner) pool — a cross-tenant aggregate the partner is authorized to see because the
 * caller has already restricted `tenantIds` to the partner's own scope (owned ∪ managed).
 */
import { sqlBypass } from '@/lib/db';

export interface TenantRollup {
  tenantId: string;
  buckets: number;
  pins: number;
  proposals: number;
  portals: number;
  adminPocName: string | null;
  adminPocEmail: string | null;
}

/** Rollup stats keyed by tenantId. Empty input → empty map (no query). */
export async function tenantRollupStats(tenantIds: string[]): Promise<Map<string, TenantRollup>> {
  if (!tenantIds || tenantIds.length === 0) return new Map();
  const rows = await sqlBypass<TenantRollup[]>`
    SELECT t.id AS "tenantId",
      (SELECT count(*)::int FROM tenant_spotlight_buckets b WHERE b.tenant_id = t.id) AS buckets,
      (SELECT count(*)::int FROM tenant_opportunity_cards c
         WHERE c.tenant_id = t.id AND c.archived_at IS NULL) AS pins,
      (SELECT count(*)::int FROM proposals p
         WHERE p.tenant_id = t.id AND p.archived_at IS NULL) AS proposals,
      (SELECT count(*)::int FROM proposal_portals pp WHERE pp.tenant_id = t.id) AS portals,
      poc.name  AS "adminPocName",
      poc.email AS "adminPocEmail"
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT u.name, u.email
      FROM user_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = t.id AND m.status = 'active'
        AND m.role = 'tenant_admin' AND m.source = 'home'
      ORDER BY m.created_at ASC
      LIMIT 1
    ) poc ON true
    WHERE t.id = ANY(${tenantIds}::uuid[])`;
  return new Map(rows.map((r) => [r.tenantId, r]));
}
