/**
 * Partner add-company name matching (docs/PARTNER_MANAGER_DESIGN.md §4, D6).
 * Pure-logic + guard branches: threshold resolution, normalization, and the empty-input
 * short-circuits that must NOT touch the DB. The live similarity() scan is covered by the drive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sqlBypass: sqlMock }));

import {
  resolveNameMatchThreshold,
  normalizeCompanyName,
  findSimilarTenants,
  findExactTenant,
} from '@/lib/tenants/name-match';

beforeEach(() => sqlMock.mockReset());

describe('resolveNameMatchThreshold', () => {
  it('defaults to 0.45 when unset/blank/NaN', () => {
    expect(resolveNameMatchThreshold(undefined)).toBe(0.45);
    expect(resolveNameMatchThreshold('')).toBe(0.45);
    expect(resolveNameMatchThreshold('abc')).toBe(0.45);
  });
  it('accepts a valid in-range override', () => {
    expect(resolveNameMatchThreshold('0.6')).toBe(0.6);
    expect(resolveNameMatchThreshold('1')).toBe(1);
  });
  it('rejects out-of-range values (clamps to default)', () => {
    expect(resolveNameMatchThreshold('0')).toBe(0.45);
    expect(resolveNameMatchThreshold('-0.2')).toBe(0.45);
    expect(resolveNameMatchThreshold('1.5')).toBe(0.45);
  });
});

describe('normalizeCompanyName', () => {
  it('is case/punctuation-insensitive and drops legal suffixes + article', () => {
    expect(normalizeCompanyName("The Entrepreneurs' Center")).toBe('entrepreneurs center');
    expect(normalizeCompanyName('Entrepreneurs Center, LLC')).toBe('entrepreneurs center');
    expect(normalizeCompanyName('Foundation Inc.')).toBe('foundation');
  });
  it('collapses whitespace', () => {
    expect(normalizeCompanyName('  Acme   Robotics  ')).toBe('acme robotics');
  });
});

describe('empty-input guards never hit the DB', () => {
  it('findSimilarTenants("") → [] with no query', async () => {
    expect(await findSimilarTenants('   ')).toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it('findExactTenant("") → null with no query', async () => {
    expect(await findExactTenant('')).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
