/**
 * HITL P2 — the role-hierarchy expectations the ToDo visibility/completion logic depends on
 * (lib/tasks/tasks.ts). Pure (no DB); the live cross-tenant/escalation proof is
 * scratchpad/drive-hitl-p2.mts (15/15). This locks the hierarchy against an rbac regression.
 */
import { describe, it, expect } from 'vitest';
import { hasRoleAtLeast } from '@/lib/rbac';

const TENANT_ROLES = ['tenant_admin', 'tenant_user', 'partner_user'] as const;
const visibleTenantRoles = (role: Parameters<typeof hasRoleAtLeast>[0]) =>
  TENANT_ROLES.filter((r) => hasRoleAtLeast(role, r));

describe('HITL role hierarchy (ToDo visibility + completion)', () => {
  it('tenant_admin sees/acts on tenant_admin + tenant_user (+ partner_user) ToDos', () => {
    expect(visibleTenantRoles('tenant_admin')).toEqual(['tenant_admin', 'tenant_user', 'partner_user']);
    expect(hasRoleAtLeast('tenant_admin', 'tenant_user')).toBe(true);
  });
  it('tenant_user does NOT see/act on tenant_admin ToDos (no upward escalation)', () => {
    expect(visibleTenantRoles('tenant_user')).not.toContain('tenant_admin');
    expect(hasRoleAtLeast('tenant_user', 'tenant_admin')).toBe(false);
  });
  it('a descended admin (rfp_admin) can act as tenant_admin — but a tenant role can NEVER act as admin', () => {
    expect(hasRoleAtLeast('rfp_admin', 'tenant_admin')).toBe(true);   // shadow-admin capability
    expect(hasRoleAtLeast('master_admin', 'tenant_admin')).toBe(true);
    expect(hasRoleAtLeast('tenant_admin', 'rfp_admin')).toBe(false);  // no escalation to admin
    expect(hasRoleAtLeast('tenant_admin', 'master_admin')).toBe(false);
  });
});
