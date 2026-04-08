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
  'tenant_admin',
  'tenant_user',
  'partner_user',
] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  master_admin: 100,
  rfp_admin: 80,
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
 * Path-based permission lookup — maps top-level URL segments to the
 * minimum role required. Used by middleware.ts to short-circuit
 * obviously-privileged paths before hitting layout server components.
 */
const PATH_MIN_ROLE: Array<{ prefix: string; role: Role }> = [
  { prefix: '/admin', role: 'rfp_admin' },
  { prefix: '/api/admin', role: 'rfp_admin' },
  { prefix: '/portal', role: 'tenant_user' },
  { prefix: '/api/portal', role: 'tenant_user' },
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
 *   partner_user                  → /portal/<slug>/dashboard (if slug set)
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
  if (tenantSlug) {
    return `/portal/${tenantSlug}/dashboard`;
  }
  return null;
}
