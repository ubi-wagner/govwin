/**
 * coerceJsonb — guards the postgres.js jsonb read nuance (write via
 * JSON.stringify::jsonb reads back as a STRING; sql.json / DDL default reads
 * back parsed). This is the root of the gate_config / step_status / preset bugs.
 */
import { describe, expect, it } from 'vitest';
import { coerceJsonb } from '@/lib/jsonb';

describe('coerceJsonb', () => {
  it('passes a real array/object through', () => {
    expect(coerceJsonb(['draft', 'final'], [])).toEqual(['draft', 'final']);
    expect(coerceJsonb({ a: 1 }, {})).toEqual({ a: 1 });
  });
  it('parses the JSON-text STRING form (the bug case)', () => {
    // exactly what `${JSON.stringify(['draft','final'])}::jsonb` reads back as
    expect(coerceJsonb<string[]>('["draft","final"]', [])).toEqual(['draft', 'final']);
    expect(coerceJsonb<Record<string, string>>('{"s1":"completed"}', {})).toEqual({ s1: 'completed' });
  });
  it('the coerced value supports real array ops (not char-iteration)', () => {
    const gates = coerceJsonb<string[]>('["draft","review","final"]', ['draft', 'final']);
    expect(gates.indexOf('review')).toBe(1);   // not a substring index
    expect(gates.length).toBe(3);              // not the char count
    expect(gates[gates.indexOf('review') + 1]).toBe('final'); // a stage, not a char
  });
  it('returns the fallback on null / parse-failure', () => {
    expect(coerceJsonb(null, ['draft', 'final'])).toEqual(['draft', 'final']);
    expect(coerceJsonb(undefined, {})).toEqual({});
    expect(coerceJsonb('{bad json', [])).toEqual([]);
    expect(coerceJsonb('null', ['x'])).toEqual(['x']); // parsed null → fallback
  });
});
