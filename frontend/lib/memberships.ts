/**
 * Membership reads (multi-membership identity, P1) — see
 * docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 *
 * A person's ACTIVE memberships are the choices they may act as; a session pins
 * exactly ONE (singular authorization). This is the read substrate for the login
 * membership selector and the RFP-admin descend/ascend. It returns only the
 * materialized rows (home + collaborator + manual); the RFP-admin derived shadow
 * set (tenant_admin in every tenant, by T&C) is resolved separately, not stored.
 */
import { sql } from '@/lib/db';

export interface Membership {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
  status: string;
  source: string;
}

/** A user's active, materialized memberships (oldest first — home tends to be first). */
export async function getActiveMemberships(userId: string): Promise<Membership[]> {
  try {
    return await sql<Membership[]>`
      SELECT m.id, m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
             m.role, m.status, m.source
      FROM user_memberships m
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${userId}::uuid AND m.status = 'active'
      ORDER BY m.created_at ASC`;
  } catch (e) {
    console.error('[memberships] getActiveMemberships failed:', e);
    return [];
  }
}

/** True iff the user holds an active membership for the tenant (materialized only). */
export async function hasActiveMembership(userId: string, tenantId: string): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT 1 FROM user_memberships
      WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'active'
      LIMIT 1`;
    return !!row;
  } catch (e) {
    console.error('[memberships] hasActiveMembership failed:', e);
    return false;
  }
}
