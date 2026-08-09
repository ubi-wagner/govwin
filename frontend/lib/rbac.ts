/**
 * Role-based access control helpers — the single source of truth for
 * role hierarchy checks. Middleware and API routes both consume
 * hasRoleAtLeast / canAccess to decide whether a request proceeds.
 *
 * See docs/DECISIONS.md D001 for the role hierarchy definition.
 *
 * ROLES/Role live here (not in auth.ts) so unit tests can import rbac
 * without pulling the next-auth runtime into the test environment.
 */
export const ROLES = [
  'master_admin',
  'rfp_admin',
  'partner_admin',
  'tenant_admin',
  'tenant_user',
  'partner_user',
] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  master_admin: 100,
  rfp_admin: 80,
  // EconDev partner-admin: owner-scoped. Deliberately BELOW rfp_admin (80) so it never
  // satisfies the /admin god-view guard (fail-closed); it reaches only the owner-scoped
  // /partner surface + tenant portals it holds a membership on. See docs/ECONDEV_PARTNER_ADMIN.md.
  partner_admin: 50,
  tenant_admin: 60,
  tenant_user: 40,
  partner_user: 20,
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Returns true if the actor's role is at or above the required role
 * in the hierarchy. master_admin satisfies any required role,
 * partner_user only satisfies partner_user.
 */
export function hasRoleAtLeast(actorRole: Role, requiredRole: Role): boolean {
  return ROLE_RANK[actorRole] >= ROLE_RANK[requiredRole];
}

/**
 * Convenience predicates for the common capability checks.
 */
export function isAdmin(role: Role): boolean {
  return hasRoleAtLeast(role, 'rfp_admin');
}

export function isMasterAdmin(role: Role): boolean {
  return role === 'master_admin';
}

export function canManageTenant(role: Role): boolean {
  return hasRoleAtLeast(role, 'tenant_admin');
}

/**
 * EconDev partner-admin: an owner-scoped platform role that runs a stable of client
 * companies as tenants. NOT a global operator — it can only see/manage tenants it owns
 * (tenants.owner_id) via the /partner surface, and build inside them through a
 * tenant_admin membership. rfp_admin+ also qualify (platform operators oversee everything).
 */
export function canManagePartnerTenants(role: Role): boolean {
  return role === 'partner_admin' || hasRoleAtLeast(role, 'rfp_admin');
}

/**
 * Force-advance authorization — may `actorRole` advance (resume) a paused
 * HITL process instance owned by `instanceTenantId`, acting as the human the
 * workflow was waiting for?
 *
 *   master_admin / rfp_admin  → any instance (system operators).
 *   tenant_admin              → ONLY instances belonging to their OWN tenant.
 *   tenant_user / partner_user → never.
 *
 * The tenant_admin branch is wired now so the customer-admin portal route can
 * adopt it without rework — it just isn't exposed by a route yet. `actorTenantId`
 * is the caller's tenant (null for system admins); `instanceTenantId` is the
 * process instance's tenant (null for admin/system instances).
 */
export function canForceAdvanceInstance(
  actorRole: Role,
  actorTenantId: string | null,
  instanceTenantId: string | null,
): boolean {
  if (hasRoleAtLeast(actorRole, 'rfp_admin')) {
    return true;
  }
  if (actorRole === 'tenant_admin') {
    return actorTenantId != null && actorTenantId === instanceTenantId;
  }
  return false;
}

/**
 * Tenant-WIDE access predicate — does this actor get access to everything in
 * `tenantId` by virtue of being a platform admin or a HOME member of that tenant?
 *
 *   master_admin / rfp_admin     → yes (platform operators / god-view)
 *   tenant_admin / tenant_user   → yes ONLY for their own tenant
 *   partner_user                 → never (always section-scoped)
 *   home tenant ≠ this tenant    → never (cross-company collaborator → scoped)
 *
 * This is the discriminator between "sees the whole tenant" and "must be scoped to
 * explicit proposal_collaborators grants." The scoped side covers BOTH partner_user
 * AND a cross-company collaborator — e.g. an admin at their own company invited onto
 * another company's proposal. Proposal routes use this instead of a bare global-role
 * check so that a `tenant_admin` of company B does NOT inherit admin power over
 * company A's proposal. See docs/IDENTITY_AUTHZ_MODEL.md §4.
 */
export function isTenantWideMember(
  role: string,
  actorTenantId: string | null | undefined,
  tenantId: string,
): boolean {
  if (role === 'master_admin' || role === 'rfp_admin') return true;
  if (
    (role === 'tenant_admin' || role === 'tenant_user') &&
    actorTenantId != null &&
    actorTenantId === tenantId
  ) {
    return true;
  }
  return false;
}

/**
 * Path-based permission lookup — maps top-level URL segments to the
 * minimum role required. Used by middleware.ts to short-circuit
 * obviously-privileged paths before hitting layout server components.
 */
const PATH_MIN_ROLE: Array<{ prefix: string; role: Role }> = [
  // More specific (longer) prefixes MUST come first — requiredRoleForPath
  // returns the first match. '/admin/system' and '/api/admin/system' are
  // master_admin-only; they'd otherwise be shadowed by the general
  // '/admin' rfp_admin entry below.
  { prefix: '/admin/system', role: 'master_admin' },
  { prefix: '/api/admin/system', role: 'master_admin' },
  { prefix: '/admin', role: 'rfp_admin' },
  { prefix: '/api/admin', role: 'rfp_admin' },
  // The Architecture Explorer static asset (embedded on /admin/architecture) exposes the full
  // schema structure — gate it to rfp_admin like the page, not just any authenticated user.
  { prefix: '/architecture', role: 'rfp_admin' },
  // EconDev partner-admin surface (owner-scoped; handlers re-check owner_id + canManagePartnerTenants).
  { prefix: '/partner', role: 'partner_admin' },
  { prefix: '/api/partner', role: 'partner_admin' },
  { prefix: '/portal', role: 'partner_user' },
  { prefix: '/api/portal', role: 'partner_user' },
  { prefix: '/dashboard', role: 'tenant_user' },
];

export function requiredRoleForPath(pathname: string): Role | null {
  for (const { prefix, role } of PATH_MIN_ROLE) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return role;
    }
  }
  return null;
}

/**
 * Role + tenant aware landing path for a freshly authenticated user.
 * Used by /portal/page.tsx (the post-login dispatcher) and by the
 * login page's post-sign-in redirect to send each role to their
 * correct starting point instead of dumping everyone onto a generic
 * stub page.
 *
 * Rules:
 *   master_admin / rfp_admin      → /admin/dashboard
 *   tenant_admin / tenant_user    → /portal/<slug>/dashboard (if slug set)
 *   partner_user                  → /portal/<slug>/proposals  (if slug set)
 *   any role with no tenant slug  → null (caller should show
 *                                   a "no workspace assigned" message)
 */
export function getLandingPath(
  role: Role,
  tenantSlug: string | null,
): string | null {
  if (role === 'master_admin' || role === 'rfp_admin') {
    return '/admin/dashboard';
  }
  // Partner-managers land on their console (their org + stable), not a single portal.
  if (role === 'partner_admin') {
    return '/partner';
  }
  if (tenantSlug) {
    // Partner users land on the proposals list (restricted sidebar);
    // tenant admins and tenant users land on the dashboard.
    if (role === 'partner_user') {
      return `/portal/${tenantSlug}/proposals`;
    }
    return `/portal/${tenantSlug}/dashboard`;
  }
  return null;
}
