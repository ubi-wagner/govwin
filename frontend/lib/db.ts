import postgres from 'postgres';
import { isTenantWideMember, hasRoleAtLeast, isRole } from './rbac';

// Next.js "Collecting page data" step at build time loads every
// route module with NODE_ENV=production but without runtime secrets
// (Railway only injects those into the running container, not the
// build container). Skip the guard during the build phase; the
// runtime guard still fires when NEXT_PHASE is absent/runtime.
const _isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && !_isBuildPhase) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const sql = postgres(DATABASE_URL!, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  // CRITICAL: postgres.js transform direction semantics —
  //   `from` is applied to column names RECEIVED from the server
  //          (so snake_case `password_hash` → camelCase `passwordHash`
  //          in result rows, matching what auth.ts and every other
  //          caller expects).
  //   `to` is applied to column names SENT to the server
  //        (so if any code references `${sql(['passwordHash'])}` in a
  //        query, it gets converted to `password_hash` on the wire).
  //
  // This was previously configured with `to` and `from` SWAPPED,
  // which meant result rows came back with snake_case keys, and
  // every `user.passwordHash` / `user.isActive` / `user.tempPassword`
  // access in auth.ts returned `undefined`. The `if (!user.passwordHash)
  // return null;` guard in authorize() fired on every login attempt,
  // which is why NextAuth surfaced "Invalid email or password" even
  // when the correct credentials were entered against the correct
  // row — the auth chain never reached the bcrypt.compare step.
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
  onnotice: () => {},
});

export async function getTenantBySlug(slug: string) {
  try {
    const [tenant] = await sql`SELECT id, slug, name, status, product_tier FROM tenants WHERE slug = ${slug} AND status != 'suspended'`;
    return tenant ?? null;
  } catch (e) {
    console.error('[getTenantBySlug] Error:', e);
    return null;
  }
}

export async function verifyTenantAccess(userId: string, role: string, tenantId: string): Promise<boolean> {
  try {
    // RFP-admins hold the DERIVED shadow membership (tenant_admin in every tenant, by
    // T&C default) — access resolved here, not materialized. When they descend into a
    // tenant their session role becomes tenant_admin; this coarse gate stays true.
    // (Multi-membership identity P1 — docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.)
    if (role === 'master_admin' || role === 'rfp_admin') return true;
    // Everyone else: the user's granted role(s) at this tenant — an ACTIVE membership
    // row and/or the legacy users.tenant_id read-through (so access never regresses if a
    // membership wasn't backfilled). Cross-company collaborators pass via the membership
    // row (source='collaborator'); the proposal-scoped verifyProposalAccess is separate.
    const rows = await sql<{ role: string }[]>`
      SELECT role FROM user_memberships
        WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND status = 'active'
      UNION ALL
      SELECT role FROM users
        WHERE id = ${userId} AND tenant_id = ${tenantId} AND is_active = true`;
    if (rows.length === 0) return false;
    // Fail CLOSED on role escalation (singular-session enforcement, defense-in-depth):
    // the session's ACTIVE role must not exceed the role the user was actually granted
    // at THIS tenant. A multi-membership user whose JWT still carries a higher home role
    // (e.g. tenant_admin at their own company) is capped to their real role here (e.g.
    // partner_user as a collaborator), so no cross-tenant privilege bleeds through even
    // if the active-membership rewrite didn't take. See MULTI_MEMBERSHIP_IDENTITY_DESIGN.
    if (!isRole(role)) return false;
    return rows.some((r) => isRole(r.role) && hasRoleAtLeast(r.role, role));
  } catch (e) {
    console.error('[verifyTenantAccess] Error:', e);
    return false;
  }
}

/**
 * Proposal-scoped access gate — the collaborator-aware widening of
 * verifyTenantAccess. Returns true if the actor has tenant-wide access to the
 * proposal's tenant (isTenantWideMember) OR is an ACCEPTED collaborator on THIS
 * specific proposal.
 *
 * Cross-company collaborators (home tenant ≠ proposal tenant) and partner_users
 * pass ONLY through the collaborator branch — so this is the coarse "may this user
 * touch this proposal at all" gate. Callers MUST still enforce the fine-grained
 * per-section scope (edit/comment/view) via resolveUserAccess, gated on
 * `!isTenantWideMember(...)`. See docs/IDENTITY_AUTHZ_MODEL.md §4.
 */
export async function verifyProposalAccess(
  userId: string,
  role: string,
  actorTenantId: string | null | undefined,
  tenantId: string,
  proposalId: string,
): Promise<boolean> {
  try {
    if (isTenantWideMember(role, actorTenantId, tenantId)) return true;
    const [row] = await sql`
      SELECT 1 FROM proposal_collaborators
      WHERE proposal_id = ${proposalId}
        AND user_id = ${userId}
        AND accepted_at IS NOT NULL
        AND revoked_at IS NULL
      LIMIT 1
    `;
    return !!row;
  } catch (e) {
    console.error('[verifyProposalAccess] Error:', e);
    return false;
  }
}

export async function auditLog(params: { tenantId?: string; userId?: string; action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) {
  try {
    await sql`INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, metadata) VALUES (${params.tenantId ?? null}, ${params.userId ?? null}, ${params.action}, ${params.entityType ?? null}, ${params.entityId ?? null}, ${JSON.stringify(params.metadata ?? {})})`;
  } catch (e) {
    console.error('[auditLog] Error:', e);
  }
}
