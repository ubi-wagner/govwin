import { describe, expect, it } from 'vitest';
import {
  hasRoleAtLeast,
  isAdmin,
  isMasterAdmin,
  isRole,
  canManageTenant,
  requiredRoleForPath,
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

describe('requiredRoleForPath', () => {
  it('maps /admin to rfp_admin', () => {
    expect(requiredRoleForPath('/admin')).toBe('rfp_admin');
    expect(requiredRoleForPath('/admin/tenants')).toBe('rfp_admin');
    expect(requiredRoleForPath('/api/admin/users')).toBe('rfp_admin');
  });

  it('maps /portal and /dashboard to tenant_user', () => {
    expect(requiredRoleForPath('/portal')).toBe('tenant_user');
    expect(requiredRoleForPath('/portal/acme')).toBe('tenant_user');
    expect(requiredRoleForPath('/api/portal/tenants')).toBe('tenant_user');
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
