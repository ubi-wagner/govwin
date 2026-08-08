/**
 * Partner scope guards (docs/PARTNER_MANAGER_DESIGN.md §3, D2/D5).
 * The empty-input short-circuits must fail closed and NOT touch the DB. The live membership
 * scans (own-org, stable, can-enter, email-in-use) are covered by the drive/E2E.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sqlBypass: sqlMock }));

import {
  partnerOwnOrg,
  partnerScopeTenants,
  partnerCanEnter,
  emailActiveAsTenantAdmin,
} from '@/lib/partner/scope';

beforeEach(() => sqlMock.mockReset());

describe('partner scope guards fail closed with no query', () => {
  it('partnerOwnOrg("") → null', async () => {
    expect(await partnerOwnOrg('')).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it('partnerScopeTenants("") → []', async () => {
    expect(await partnerScopeTenants('')).toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it('partnerCanEnter denies on missing userId or tenantId', async () => {
    expect(await partnerCanEnter('', 't1')).toBe(false);
    expect(await partnerCanEnter('u1', '')).toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it('emailActiveAsTenantAdmin("") → false', async () => {
    expect(await emailActiveAsTenantAdmin('   ')).toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
