import { describe, expect, it } from 'vitest';
import {
  hasRoleAtLeast,
  isAdmin,
  isMasterAdmin,
  isRole,
  canManageTenant,
  canForceAdvanceInstance,
  requiredRoleForPath,
  getLandingPath,
  isTenantWideMember,
} from '@/lib/rbac';

describe('isRole', () => {
  it('accepts all five canonical roles', () => {
    for (const r of ['master_admin', 'rfp_admin', 'tenant_admin', 'tenant_user', 'partner_user']) {
      expect(isRole(r)).toBe(true);
    }
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isRole('admin')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe('hasRoleAtLeast', () => {
  it('master_admin satisfies every role', () => {
    expect(hasRoleAtLeast('master_admin', 'master_admin')).toBe(true);
    expect(hasRoleAtLeast('master_admin', 'rfp_admin')).toBe(true);
    expect(hasRoleAtLeast('master_admin', 'tenant_admin')).toBe(true);
    expect(hasRoleAtLeast('master_admin', 'tenant_user')).toBe(true);
    expect(hasRoleAtLeast('master_admin', 'partner_user')).toBe(true);
  });

  it('rfp_admin satisfies tenant roles but not master_admin', () => {
    expect(hasRoleAtLeast('rfp_admin', 'master_admin')).toBe(false);
    expect(hasRoleAtLeast('rfp_admin', 'rfp_admin')).toBe(true);
    expect(hasRoleAtLeast('rfp_admin', 'tenant_admin')).toBe(true);
    expect(hasRoleAtLeast('rfp_admin', 'tenant_user')).toBe(true);
    expect(hasRoleAtLeast('rfp_admin', 'partner_user')).toBe(true);
  });

  it('tenant_admin satisfies tenant_user and partner_user only', () => {
    expect(hasRoleAtLeast('tenant_admin', 'master_admin')).toBe(false);
    expect(hasRoleAtLeast('tenant_admin', 'rfp_admin')).toBe(false);
    expect(hasRoleAtLeast('tenant_admin', 'tenant_admin')).toBe(true);
    expect(hasRoleAtLeast('tenant_admin', 'tenant_user')).toBe(true);
    expect(hasRoleAtLeast('tenant_admin', 'partner_user')).toBe(true);
  });

  it('partner_user only satisfies partner_user', () => {
    expect(hasRoleAtLeast('partner_user', 'master_admin')).toBe(false);
    expect(hasRoleAtLeast('partner_user', 'rfp_admin')).toBe(false);
    expect(hasRoleAtLeast('partner_user', 'tenant_admin')).toBe(false);
    expect(hasRoleAtLeast('partner_user', 'tenant_user')).toBe(false);
    expect(hasRoleAtLeast('partner_user', 'partner_user')).toBe(true);
  });
});

describe('isAdmin', () => {
  it('returns true for master_admin and rfp_admin only', () => {
    expect(isAdmin('master_admin')).toBe(true);
    expect(isAdmin('rfp_admin')).toBe(true);
    expect(isAdmin('tenant_admin')).toBe(false);
    expect(isAdmin('tenant_user')).toBe(false);
    expect(isAdmin('partner_user')).toBe(false);
  });
});

describe('isMasterAdmin', () => {
  it('is exact match for master_admin', () => {
    expect(isMasterAdmin('master_admin')).toBe(true);
    expect(isMasterAdmin('rfp_admin')).toBe(false);
  });
});

describe('canManageTenant', () => {
  it('requires at least tenant_admin', () => {
    expect(canManageTenant('master_admin')).toBe(true);
    expect(canManageTenant('rfp_admin')).toBe(true);
    expect(canManageTenant('tenant_admin')).toBe(true);
    expect(canManageTenant('tenant_user')).toBe(false);
    expect(canManageTenant('partner_user')).toBe(false);
  });
});

describe('canForceAdvanceInstance', () => {
  it('lets system admins advance ANY instance (own/other/admin-owned)', () => {
    for (const role of ['master_admin', 'rfp_admin'] as const) {
      expect(canForceAdvanceInstance(role, null, null)).toBe(true);
      expect(canForceAdvanceInstance(role, null, 'tenant-1')).toBe(true);
      expect(canForceAdvanceInstance(role, 'tenant-9', 'tenant-1')).toBe(true);
    }
  });

  it('lets a tenant_admin advance ONLY their own tenant (the later customer path)', () => {
    expect(canForceAdvanceInstance('tenant_admin', 'tenant-1', 'tenant-1')).toBe(true);
    expect(canForceAdvanceInstance('tenant_admin', 'tenant-1', 'tenant-2')).toBe(false);
    expect(canForceAdvanceInstance('tenant_admin', 'tenant-1', null)).toBe(false);
    expect(canForceAdvanceInstance('tenant_admin', null, null)).toBe(false);
  });

  it('denies tenant_user and partner_user outright', () => {
    expect(canForceAdvanceInstance('tenant_user', 'tenant-1', 'tenant-1')).toBe(false);
    expect(canForceAdvanceInstance('partner_user', 'tenant-1', 'tenant-1')).toBe(false);
  });
});

describe('requiredRoleForPath', () => {
  it('maps /admin to rfp_admin', () => {
    expect(requiredRoleForPath('/admin')).toBe('rfp_admin');
    expect(requiredRoleForPath('/admin/tenants')).toBe('rfp_admin');
    expect(requiredRoleForPath('/api/admin/users')).toBe('rfp_admin');
  });

  it('maps /portal to partner_user (lowest tenant role)', () => {
    expect(requiredRoleForPath('/portal')).toBe('partner_user');
    expect(requiredRoleForPath('/portal/acme')).toBe('partner_user');
    expect(requiredRoleForPath('/api/portal/tenants')).toBe('partner_user');
  });

  it('maps /dashboard to tenant_user', () => {
    expect(requiredRoleForPath('/dashboard')).toBe('tenant_user');
  });

  it('returns null for paths without a mapping', () => {
    expect(requiredRoleForPath('/')).toBeNull();
    expect(requiredRoleForPath('/login')).toBeNull();
    expect(requiredRoleForPath('/api/health')).toBeNull();
  });

  it('does not match a prefix substring (no /admin-xyz false positives)', () => {
    expect(requiredRoleForPath('/administrator')).toBeNull();
    expect(requiredRoleForPath('/portal-help')).toBeNull();
  });
});

describe('getLandingPath', () => {
  it('sends master_admin to /admin/dashboard regardless of tenant', () => {
    expect(getLandingPath('master_admin', null)).toBe('/admin/dashboard');
    expect(getLandingPath('master_admin', 'acme')).toBe('/admin/dashboard');
  });

  it('sends rfp_admin to /admin/dashboard', () => {
    expect(getLandingPath('rfp_admin', null)).toBe('/admin/dashboard');
    expect(getLandingPath('rfp_admin', 'acme')).toBe('/admin/dashboard');
  });

  it('sends tenant_admin to /portal/<slug>/dashboard', () => {
    expect(getLandingPath('tenant_admin', 'apex-defense')).toBe('/portal/apex-defense/dashboard');
  });

  it('sends tenant_user to /portal/<slug>/dashboard', () => {
    expect(getLandingPath('tenant_user', 'apex-defense')).toBe('/portal/apex-defense/dashboard');
  });

  it('sends partner_user to /portal/<slug>/proposals', () => {
    expect(getLandingPath('partner_user', 'apex-defense')).toBe('/portal/apex-defense/proposals');
  });

  it('returns null for tenant roles with no slug', () => {
    expect(getLandingPath('tenant_admin', null)).toBeNull();
    expect(getLandingPath('tenant_user', null)).toBeNull();
    expect(getLandingPath('partner_user', null)).toBeNull();
  });
});

describe('isTenantWideMember', () => {
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('platform admins get tenant-wide access to any tenant', () => {
    expect(isTenantWideMember('master_admin', null, A)).toBe(true);
    expect(isTenantWideMember('rfp_admin', null, A)).toBe(true);
    expect(isTenantWideMember('rfp_admin', B, A)).toBe(true);
  });

  it('tenant_admin/tenant_user are tenant-wide ONLY for their own tenant', () => {
    expect(isTenantWideMember('tenant_admin', A, A)).toBe(true);
    expect(isTenantWideMember('tenant_user', A, A)).toBe(true);
    // cross-company: an admin/user of B is NOT tenant-wide over A (must be scoped)
    expect(isTenantWideMember('tenant_admin', B, A)).toBe(false);
    expect(isTenantWideMember('tenant_user', B, A)).toBe(false);
  });

  it('partner_user is NEVER tenant-wide, even in their own tenant', () => {
    expect(isTenantWideMember('partner_user', A, A)).toBe(false);
    expect(isTenantWideMember('partner_user', B, A)).toBe(false);
  });

  it('null/undefined home tenant is never tenant-wide for non-admins', () => {
    expect(isTenantWideMember('tenant_admin', null, A)).toBe(false);
    expect(isTenantWideMember('tenant_user', undefined, A)).toBe(false);
  });
});
