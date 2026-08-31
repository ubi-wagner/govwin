import postgres from 'postgres';
import { hasRoleAtLeast, isRole } from './rbac';
import { currentTenantContext, enterTenant } from '@/lib/tenant-context';
// A ZERO-IMPORT LEAF, on purpose: lib/events.ts imports sql from this file, so this file cannot
// import lib/events.ts back. The registry lives on its own so both sides can read it.
import { EVENT_NAMESPACES } from '@/lib/event-namespaces';

// Re-export the choke-point primitives so a portal route can `import { sql,
// verifyTenantAccess, enterTenant } from '@/lib/db'` in ONE line. The RLS cutover
// choke point is the ROUTE BODY (docs/RLS_CUTOVER.md): a route calls
// `enterTenant(tenantId)` in its OWN async frame after the access gate, and the
// context-aware `sql` below then scopes every downstream query (and every lib
// helper the route calls) to that tenant under govtech_app. It CANNOT live inside
// verifyTenantAccess: AsyncLocalStorage context flows parent→child only, so a
// context set inside an awaited helper is reverted when control returns to the route
// (proven — Next wraps each handler in its own AsyncLocalStorage.run).
export { enterTenant, enterBypass } from '@/lib/tenant-context';

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
 * Bypass pool — the OWNER (BYPASSRLS) connection, for reads that must legitimately cross
 * tenants: auth (users lookup before any tenant context), admin cross-tenant aggregates
 * (e.g. the agent-workforce rollup), and owner-only maintenance. In production
 * `DATABASE_URL` points at the non-owner `govtech_app` (NOBYPASSRLS) role and
 * `DATABASE_URL_OWNER` carries the owner string for THIS pool, so `sqlBypass` is the real
 * cross-tenant escape hatch. Where `DATABASE_URL_OWNER` is unset (some local setups) both
 * fall back to one connection. Admin cross-tenant routes reach it via `enterBypass()` (below) or by
 * importing it directly (`import { sqlBypass as sql }`) for fragment/begin routes.
 */
export const sqlBypass = postgres((process.env.DATABASE_URL_OWNER || DATABASE_URL)!, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
  onnotice: () => {},
});

/**
 * Context-aware `sql` (docs/RLS_CUTOVER.md). Transparent Proxy over the raw client, routed by
 * the per-request AsyncLocalStorage context:
 *   • NO context (the default) → EXACT passthrough to rawSql (which connects as govtech_app in prod).
 *   • a TENANT context (enterTenant, set in the route's own frame) → each `sql\`\`` runs inside
 *     a `SET LOCAL app.tenant_id` transaction, so RLS scopes it to that tenant under govtech_app.
 *   • a BYPASS context (enterBypass, set after an admin gate) → each `sql\`\`` is routed to the
 *     owner `sqlBypass` pool, so a privileged admin cross-tenant request AND every lib helper it
 *     calls read across tenants.
 * A no-op only until a request enters a context; once entered, the tenant GUC scopes RLS
 * under govtech_app. (Where both pools resolve to the owner — e.g. local dev — the GUC/route
 * are harmless.) Only the tagged-template CALL is routed —
 * `sql.json/array/begin/…` forward to rawSql. So FRAGMENT-composing (`sql\`${frag}\``) and
 * `sql.begin` routes must use an explicit client (withTenant for tenants, `sqlBypass as sql`
 * for admin) — the Proxy would eager-execute an interpolated fragment.
 */
export const sql: typeof rawSql = new Proxy(rawSql, {
  apply(target, thisArg, args) {
    const first = args[0] as unknown;
    const isTemplate = Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw');
    const ctx = currentTenantContext();
    if (isTemplate && ctx) {
      if (ctx.bypass) {
        // Privileged cross-tenant read: route to the owner pool (DATABASE_URL_OWNER in prod; the same conn where that's unset).
        return (sqlBypass as unknown as (...a: unknown[]) => unknown)(...args);
      }
      if (ctx.tenantId) {
        const tid = ctx.tenantId;
        return (target as unknown as { begin: (fn: (tx: unknown) => unknown) => Promise<unknown> }).begin(async (tx) => {
          const t = tx as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
          await t`SELECT set_config('app.tenant_id', ${tid}, true)` as unknown;
          return (t as unknown as (...a: unknown[]) => unknown)(...args);
        });
      }
    }
    return Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
  get(target, prop) {
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
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
    // T&C default) — access resolved here, not materialized. NOTE: descending does NOT swap
    // their session role (they SHADOW, they don't pin — see /api/enter; only partner_admin
    // pins to tenant_admin). Their role stays rfp_admin/master_admin; the ToDo queue +
    // completeTask treat a descended admin as tenant_admin-equivalent BOUNDED to that one
    // tenant (hierarchical role checks in lib/tasks/tasks.ts), so this coarse gate stays true.
    // (Multi-membership identity P1 — docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.)
    // NOTE: this function does NOT enter the tenant RLS context — it only READS bypass
    // tables (user_memberships, tenants — both RLS-off) to decide access. The context is
    // pinned by the CALLING ROUTE via enterTenant(tenantId) after this returns true (it
    // must run in the route's own frame; see the export comment above). Admins descending
    // into ONE tenant's portal are pinned by that route; admin CROSS-tenant routes use
    // sqlBypass instead.
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
 * Bucket-authoring capability — may this actor create/edit/delete spotlight buckets in
 * `tenantId`? tenant_admin+ (incl. descended admins) always may. A plain tenant_user may
 * be DELEGATED the capability by a tenant_admin — an audited, revocable per-membership grant
 * (mig 181 `user_memberships.can_manage_buckets`). Reads the RLS-off memberships table via
 * `sql`, exactly like verifyTenantAccess (which the caller runs FIRST for tenant access).
 * The grant only matters at the member's OWN tenant; an archived company denies.
 */
export async function canManageBuckets(userId: string, role: string, tenantId: string): Promise<boolean> {
  if (isRole(role) && hasRoleAtLeast(role, 'tenant_admin')) return true;
  try {
    const rows = await sql<{ canManageBuckets: boolean }[]>`
      SELECT m.can_manage_buckets FROM user_memberships m
        JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = ${userId} AND m.tenant_id = ${tenantId}
          AND m.status = 'active' AND t.archived_at IS NULL AND m.can_manage_buckets = true
      LIMIT 1`;
    return rows.length > 0;
  } catch (e) {
    console.error('[canManageBuckets] Error:', e);
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
    // RLS cutover: pin THIS function's own frame to `tenantId` BEFORE the isolated-table read
    // below (proposals is RLS'd) — enterWith flows forward within the same frame, so the
    // bind-check below is scoped correctly under govtech_app. This does NOT cover the CALLING
    // route (context does not flow child→parent): a route that calls verifyProposalAccess must
    // ALSO call enterTenant(tenantId) in its own frame before its own isolated reads.
    // Belt-and-suspenders under live RLS. The bind proves the proposal belongs to tenantId
    // regardless.
    enterTenant(tenantId);
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

/**
 * A domain audit record.
 *
 * ── IT WROTE TO A TABLE THAT WAS DROPPED 74 MIGRATIONS AGO ───────────────────────────────────
 * This inserted into `audit_log` until this fix. Migration 142 dropped that table — deliberately,
 * annotated `→ system_events (live audit trail)` — and nothing updated this function. Because the
 * body is wrapped in a catch that only logs, every call since has failed silently: the INSERT
 * raised `relation "audit_log" does not exist`, the error went to stderr, and the caller carried on
 * believing it had left a record.
 *
 * There are 46 call sites, and ALL of them are the post-award Projects tree — a tree written long
 * after mig 142, against a helper that was already dead. So the entire Projects audit trail
 * (baselines, gate closures, invoice submission, CLIN edits, member assignment) has never recorded
 * one row, and no lens could see it: the function returns void, swallows its own failure, and the
 * pages that matter never read it back.
 *
 * The fix is what mig 142 said to do. `action` is already `namespace.type` at every call site, and
 * every namespace used is registered, so the mapping is mechanical.
 *
 * ── WHY THIS DOES NOT CALL emitEventSingle ───────────────────────────────────────────────────
 * `lib/events.ts` imports `sql` from this file. Importing it back would be a cycle, so the INSERT
 * is mirrored here instead. `event-namespaces` is safe to import — it is a zero-import leaf, which
 * is exactly why it exists. Keep this INSERT in step with `emitEventSingle`.
 */
export async function auditLog(params: { tenantId?: string; userId?: string; action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) {
  try {
    const dot = params.action.indexOf('.');
    const namespace = dot > 0 ? params.action.slice(0, dot) : '';
    const type = dot > 0 ? params.action.slice(dot + 1) : params.action;
    // A row with an unregistered namespace violates system_events_namespace_chk and would throw
    // into the catch below — i.e. it would go silent again, which is the whole bug. Say it instead.
    if (!(EVENT_NAMESPACES as readonly string[]).includes(namespace)) {
      console.error(`[auditLog] action "${params.action}" has no registered namespace — not recorded. `
        + `Use <namespace>.<action_past_tense> with one of: ${EVENT_NAMESPACES.join(', ')}`);
      return;
    }
    await sql`
      INSERT INTO system_events (namespace, type, phase, actor_type, actor_id, tenant_id, payload)
      VALUES (
        ${namespace}, ${type}, 'single',
        ${params.userId ? 'user' : 'system'}, ${params.userId ?? 'system'},
        ${params.tenantId ?? null},
        ${sql.json({
          ...(params.metadata ?? {}),
          ...(params.entityType ? { entityType: params.entityType } : {}),
          ...(params.entityId ? { entityId: params.entityId } : {}),
        } as Parameters<typeof sql.json>[0])}
      )`;
  } catch (e) {
    console.error('[auditLog] Error:', e);
  }
}
