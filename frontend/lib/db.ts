import postgres from 'postgres';
import { hasRoleAtLeast, isRole } from './rbac';
import { currentTenantContext } from '@/lib/tenant-context';

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

const rawSql = postgres(DATABASE_URL!, {
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

/**
 * Context-aware `sql` (docs/RLS_CUTOVER.md). Transparent Proxy over the raw client:
 *   • no context (every path today) OR a bypass context → EXACT passthrough to rawSql.
 *   • an active tenant context (enterTenant) → each `sql\`\`` query runs inside a
 *     `SET LOCAL app.tenant_id` transaction, so RLS scopes it under the govtech_app role.
 * Inert until a request enters a tenant context AND the app connects as govtech_app; under
 * the owner connection the GUC is harmless (owner bypasses RLS). Only the tagged-template
 * CALL is wrapped — helpers (sql.json/array/begin/…) forward unchanged.
 */
export const sql: typeof rawSql = new Proxy(rawSql, {
  apply(target, thisArg, args) {
    const first = args[0] as unknown;
    const isTemplate = Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw');
    const ctx = currentTenantContext();
    if (isTemplate && ctx && ctx.tenantId && !ctx.bypass) {
      const tid = ctx.tenantId;
      return (target as unknown as { begin: (fn: (tx: unknown) => unknown) => Promise<unknown> }).begin(async (tx) => {
        const t = tx as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
        await t`SELECT set_config('app.tenant_id', ${tid}, true)` as unknown;
        return (t as unknown as (...a: unknown[]) => unknown)(...args);
      });
    }
    return Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
  get(target, prop) {
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});

/**
 * Bypass pool — the OWNER (BYPASSRLS) connection, for reads that must legitimately cross
 * tenants: auth (users lookup before any tenant context), admin cross-tenant aggregates
 * (e.g. the agent-workforce rollup), and owner-only maintenance. Post-NOBYPASSRLS-cutover
 * (docs/RLS_CUTOVER.md) `DATABASE_URL` points at the non-owner `govtech_app` role and
 * `DATABASE_URL_OWNER` carries the owner string for THIS pool. Pre-cutover both env vars
 * resolve to the same connection, so `sqlBypass` is identical to `sql` today — inert until
 * the flip. Use it explicitly in admin cross-tenant read paths as they migrate.
 */
export const sqlBypass = postgres((process.env.DATABASE_URL_OWNER || DATABASE_URL)!, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 10,
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
    // Everyone else: access is PURELY membership-based (identity P4 — the legacy
    // users.tenant_id read-through is retired). An ACTIVE membership at a NON-archived
    // tenant grants access; anything else (revoked/inactive membership, or an archived
    // company) denies. This is what makes deactivation real: revoking a membership
    // actually removes access, with no legacy branch silently re-granting it. Every
    // user-creation path writes a membership and mig 111 backfilled all pre-existing
    // users, so nothing regresses. Cross-company collaborators pass via their
    // source='collaborator' membership; the proposal-scoped verifyProposalAccess is
    // separate. Archived tenants (license slumber) deny here without touching per-user
    // state, so renewal restores everyone exactly. Admins short-circuit above.
    const rows = await sql<{ role: string }[]>`
      SELECT m.role FROM user_memberships m
        JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = ${userId} AND m.tenant_id = ${tenantId}
          AND m.status = 'active' AND t.archived_at IS NULL`;
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
    // The proposal MUST belong to `tenantId` FIRST. Without this bind, a tenant-wide member of
    // tenant A could pass tenant B's proposalId under their OWN slug (→ tenantId=A) and
    // isTenantWideMember(A) would wave them straight through to B's proposal — a cross-tenant READ
    // (RLS-audit leak #2). Binding here fixes every caller, not just the ones that add their own
    // proposals-WHERE-tenant belt.
    const [inTenant] = await sql`
      SELECT 1 FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `;
    if (!inTenant) return false;
    // Tenant-wide access must be confirmed against the ACTIVE MEMBERSHIP LEDGER (verifyTenantAccess),
    // NOT the session role/tenantId (isTenantWideMember). Team deactivation revokes only the
    // membership row — users.is_active / role / tenant_id and the session are untouched — so a
    // session-trusting check let a deactivated member keep proposal edit/export access (identity-
    // audit HIGH: offboarding bypass). verifyTenantAccess denies a revoked membership; admins keep
    // god-view. `actorTenantId` is now vestigial (kept for the call signature).
    void actorTenantId;
    if (await verifyTenantAccess(userId, role, tenantId)) return true;
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
    await sql`INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, metadata) VALUES (${params.tenantId ?? null}, ${params.userId ?? null}, ${params.action}, ${params.entityType ?? null}, ${params.entityId ?? null}, ${sql.json((params.metadata ?? {}) as Parameters<typeof sql.json>[0])})`;
  } catch (e) {
    console.error('[auditLog] Error:', e);
  }
}
