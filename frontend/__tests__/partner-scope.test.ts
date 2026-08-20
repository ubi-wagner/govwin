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

describe('partnerCanEnter admits exactly what the console lists', () => {
  /** The tagged-template call reassembled into one string, so the predicate can be asserted. */
  const lastQuery = () => (sqlMock.mock.calls.at(-1)?.[0] as string[]).join('?');

  it('accepts an OWNED tenant regardless of how the membership arose', async () => {
    sqlMock.mockResolvedValueOnce([{ ok: true }]);
    expect(await partnerCanEnter('u1', 't1')).toBe(true);
    // The bug this replaces: the gate accepted only source IN ('home','partner_manager'), so a
    // partner who OWNS a company but holds the older `collaborator` shadow-admin membership saw
    // "Open workspace →" on /partner and was bounced back to /partner on clicking it.
    expect(lastQuery()).toMatch(/t\.owner_id = .*OR m\.source IN \('home','partner_manager'\)/s);
  });

  it('still requires an ACTIVE tenant_admin membership at a live tenant', async () => {
    sqlMock.mockResolvedValueOnce([{ ok: false }]);
    expect(await partnerCanEnter('u1', 't1')).toBe(false);
    const q = lastQuery();
    // Ownership widened the SCOPE, not the authority: these three are the invariant.
    expect(q).toMatch(/m\.status = 'active'/);
    expect(q).toMatch(/m\.role = 'tenant_admin'/);
    expect(q).toMatch(/t\.archived_at IS NULL/);
  });
});
