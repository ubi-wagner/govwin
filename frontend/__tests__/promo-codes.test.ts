/**
 * Comp-code issuance. A comp code IS the payment — redeeming one opens a proposal portal without a
 * card — so the two things worth pinning are the shape of a generated code (it gets read off a
 * screen and typed by hand) and the state machine the admin list sorts by.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sqlBypass: sqlMock }));

import { generateCode, codeState, issuePromoCodes, MAX_BATCH } from '@/lib/promo-codes';

beforeEach(() => sqlMock.mockReset());

describe('generateCode', () => {
  it('is XXXXX-XXXXX from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toMatch(/^[ACDEFGHJKMNPQRTUVWXYZ234679]{5}-[ACDEFGHJKMNPQRTUVWXYZ234679]{5}$/);
      // The whole point of the alphabet: none of the pairs a human confuses when reading aloud.
      expect(c).not.toMatch(/[0O1IL5S8B]/);
    }
  });

  it('does not repeat across a large batch', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateCode()));
    expect(seen.size).toBe(2000);
  });
});

describe('codeState', () => {
  const base = { revokedAt: null, expiresAt: null, usedCount: 0, maxUses: 1, firstRedeemedAt: null };
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it('a fresh single-use code is outstanding', () => {
    expect(codeState({ ...base, expiresAt: future })).toBe('outstanding');
  });

  it('once redeemed, a single-use code reads exhausted rather than redeemed', () => {
    // Both are true; "used up" is the one that answers "can this still buy anything".
    expect(codeState({ ...base, usedCount: 1, firstRedeemedAt: past })).toBe('exhausted');
  });

  it('a multi-use code with uses left reads redeemed after its first use', () => {
    expect(codeState({ ...base, maxUses: 5, usedCount: 1, firstRedeemedAt: past })).toBe('redeemed');
  });

  it('revoked beats every other state', () => {
    expect(codeState({ ...base, revokedAt: past, usedCount: 9, expiresAt: past })).toBe('revoked');
  });

  it('an unlimited code never exhausts', () => {
    expect(codeState({ ...base, maxUses: null, usedCount: 999, firstRedeemedAt: past })).toBe('redeemed');
  });

  it('expiry only applies when it has actually passed', () => {
    expect(codeState({ ...base, expiresAt: future })).toBe('outstanding');
    expect(codeState({ ...base, expiresAt: past })).toBe('expired');
  });
});

describe('issuePromoCodes', () => {
  const row = [{ id: 'c1', createdAt: '2026-08-20T00:00:00Z', expiresAt: '2026-09-19T00:00:00Z' }];

  it('clamps a runaway count to MAX_BATCH', async () => {
    sqlMock.mockResolvedValue(row);
    const made = await issuePromoCodes({ count: 10_000, issuedBy: 'u1' });
    expect(made.length).toBe(MAX_BATCH);
  });

  it('never mints a code that is dead on arrival', async () => {
    sqlMock.mockResolvedValue(row);
    // maxUses 0 would pass `used_count < max_uses` never — the code could not be redeemed once.
    const made = await issuePromoCodes({ count: 1, maxUses: 0, issuedBy: 'u1' });
    expect(made[0].maxUses).toBe(1);
  });

  it('keeps an explicit null as unlimited, distinct from the default', async () => {
    sqlMock.mockResolvedValue(row);
    const unlimited = await issuePromoCodes({ count: 1, maxUses: null, issuedBy: 'u1' });
    expect(unlimited[0].maxUses).toBeNull();
    const defaulted = await issuePromoCodes({ count: 1, issuedBy: 'u1' });
    expect(defaulted[0].maxUses).toBe(1);
  });

  it('returns the expiry the DATABASE stored, not one it guessed', async () => {
    sqlMock.mockResolvedValue(row);
    const made = await issuePromoCodes({ count: 1, issuedBy: 'u1' });
    expect(made[0].expiresAt).toBe('2026-09-19T00:00:00Z');
  });

  it('retries a unique collision instead of dropping the code', async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce(row); // first insert conflicts
    const made = await issuePromoCodes({ count: 1, issuedBy: 'u1' });
    expect(made.length).toBe(1);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
