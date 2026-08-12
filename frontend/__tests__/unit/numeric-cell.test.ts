import { describe, it, expect } from 'vitest';
import { parseNumericText, isNumericCell } from '@/lib/numeric-cell';

describe('parseNumericText — one shared money/percent/magnitude parser', () => {
  it('parses $, thousands commas, and plain digits', () => {
    expect(parseNumericText('$6,000')).toBe(6000);
    expect(parseNumericText('42500')).toBe(42500);
    expect(parseNumericText('$85.75')).toBe(85.75);
  });
  it('expands K/M/B magnitude suffixes (the sttr-split gap)', () => {
    expect(parseNumericText('$1.2M')).toBe(1_200_000);
    expect(parseNumericText('800K')).toBe(800_000);
    expect(parseNumericText('1.5B')).toBe(1_500_000_000);
  });
  it('reads a trailing percent as a fraction', () => {
    expect(parseNumericText('35.0%')).toBe(0.35);
    expect(parseNumericText('7%')).toBe(0.07);
  });
  it('handles accounting negatives and rejects non-numbers', () => {
    expect(parseNumericText('(5,000)')).toBe(-5000);
    expect(parseNumericText('Personnel')).toBeUndefined();
    expect(parseNumericText('')).toBeUndefined();
    expect(parseNumericText(null)).toBeUndefined();
    expect(parseNumericText('TBD')).toBeUndefined();
  });
  it('isNumericCell recognizes numeric cells by value / cell_type / number_format', () => {
    expect(isNumericCell({ value: 5 })).toBe(true);
    expect(isNumericCell({ cell_type: 'currency' })).toBe(true);
    expect(isNumericCell({ number_format: '$#,##0' })).toBe(true);
    expect(isNumericCell({ text: 'Personnel' } as never)).toBe(false);
    expect(isNumericCell(null)).toBe(false);
  });
});
