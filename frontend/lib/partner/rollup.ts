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
  /** Open ToDos inside the company (the "notify up" signal for the console) — the tenant-role bucket
   *  tasks a descended manager (tenant_admin) would see + complete. Drives the console attention badge. */
  openTodos: number;
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
      -- Open ToDos the descended manager (tenant_admin) would see: this tenant's tenant-role bucket
      -- tasks that are still open. Mirrors listOpenTasksForActor's tenant branch (hierarchical roles),
      -- so the console count matches what surfaces once they descend. Admin-bucket tasks are excluded
      -- (not the manager's concern).
      -- The assignee_user_id IS NOT NULL arm MUST match lib/partner/todos.ts:45 — the two run on
      -- (no backticks in here: this is inside a tagged template, and one would end the literal)
      -- the same screen, this one as the "N open to-dos" badge and that one as the list beneath it.
      -- Without it a ToDo named to a PERSON (no role) rendered in the feed but went uncounted, and
      -- the console read "7 open to-dos" above a list of 8.
      (SELECT count(*)::int FROM tasks tk
         WHERE tk.tenant_id = t.id AND tk.status IN ('open', 'in_progress')
           AND (tk.assignee_role IN ('tenant_admin', 'tenant_user', 'partner_user')
                OR tk.assignee_user_id IS NOT NULL)) AS "openTodos",
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
