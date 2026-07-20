import { describe, expect, it } from 'vitest';
import { interpolate, conditionsMatch } from '@/lib/automation/match';

describe('interpolate — {key} substitution from the event payload', () => {
  it('fills known keys and blanks unknown ones', () => {
    expect(interpolate('Review application from {company_name}', { company_name: 'Acme' }))
      .toBe('Review application from Acme');
    expect(interpolate('Review scout changes: {source_name}', {})).toBe('Review scout changes: ');
  });
  it('coerces non-string values and leaves plain text intact', () => {
    expect(interpolate('n={count}', { count: 3 })).toBe('n=3');
    expect(interpolate('no placeholders', { a: 1 })).toBe('no placeholders');
  });
});

describe('conditionsMatch — flat subset match against payload', () => {
  it('empty/absent conditions always match', () => {
    expect(conditionsMatch({}, { a: 1 })).toBe(true);
    expect(conditionsMatch(null, { a: 1 })).toBe(true);
    expect(conditionsMatch(undefined, {})).toBe(true);
  });
  it('matches when every condition key equals the payload value', () => {
    expect(conditionsMatch({ program_type: 'sbir' }, { program_type: 'sbir', other: 1 })).toBe(true);
  });
  it('fails when any condition mismatches or is missing', () => {
    expect(conditionsMatch({ program_type: 'sbir' }, { program_type: 'sttr' })).toBe(false);
    expect(conditionsMatch({ program_type: 'sbir' }, {})).toBe(false);
  });
  it('deep-compares object conditions', () => {
    expect(conditionsMatch({ meta: { k: 1 } }, { meta: { k: 1 } })).toBe(true);
    expect(conditionsMatch({ meta: { k: 1 } }, { meta: { k: 2 } })).toBe(false);
  });
});
