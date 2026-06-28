/**
 * R0.3 — card read-model normaliser.
 *
 * coerceOriginCard guards the postgres.js jsonb nuance: a value written via
 * `${JSON.stringify(x)}::jsonb` reads back as a STRING, while `sql.json()` /
 * DDL defaults read back parsed. The create route writes origin_card via
 * `sql.json()`, but the read-model must tolerate either form (and malformed
 * data) so the card never throws on assembly.
 */
import { describe, expect, it, vi } from 'vitest';

// card.ts imports @/lib/db (which throws without DATABASE_URL at import time).
// coerceOriginCard is pure and never touches sql, so a trivial mock suffices.
vi.mock('@/lib/db', () => ({ sql: Object.assign(vi.fn(), { json: vi.fn() }) }));

import { coerceOriginCard } from '@/lib/cards/card';

describe('coerceOriginCard', () => {
  it('passes a real object through unchanged', () => {
    const obj = { opportunity: { agency: 'DARPA' }, bucket: { key: 'tech', score: 88 } };
    expect(coerceOriginCard(obj)).toBe(obj);
  });

  it('parses the string form (JSON.stringify::jsonb read-back)', () => {
    const s = JSON.stringify({ opportunity: { agency: 'NAVY' }, frozenAt: '2026-06-28T00:00:00Z' });
    const out = coerceOriginCard(s);
    expect(out.opportunity?.agency).toBe('NAVY');
    expect(out.frozenAt).toBe('2026-06-28T00:00:00Z');
  });

  it('returns {} for null / undefined (no freeze, e.g. admin-granted)', () => {
    expect(coerceOriginCard(null)).toEqual({});
    expect(coerceOriginCard(undefined)).toEqual({});
  });

  it('returns {} for the empty-default jsonb', () => {
    expect(coerceOriginCard({})).toEqual({});
    expect(coerceOriginCard('{}')).toEqual({});
  });

  it('returns {} for malformed JSON rather than throwing', () => {
    expect(coerceOriginCard('{not valid json')).toEqual({});
    expect(coerceOriginCard('')).toEqual({});
  });

  it('returns {} for non-object JSON (a bare number/array is not a card)', () => {
    expect(coerceOriginCard('42')).toEqual({});
    // a JSON array parses to typeof 'object' but is not a card — reject it so the
    // guard means "is it a card", not merely "is it non-null"
    expect(coerceOriginCard('[1,2,3]')).toEqual({});
    expect(coerceOriginCard([1, 2, 3] as unknown as never)).toEqual({});
  });
});
