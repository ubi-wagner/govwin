import { describe, it, expect } from 'vitest';
import { formatByCode, formatCellDisplay, NUMBER_FORMATS } from '@/lib/numeric-cell';

describe('formatByCode — Excel-code number display', () => {
  it('currency with cents', () => expect(formatByCode(59200, '$#,##0.00')).toBe('$59,200.00'));
  it('currency whole', () => expect(formatByCode(59200, '$#,##0')).toBe('$59,200'));
  it('thousands', () => expect(formatByCode(59200, '#,##0')).toBe('59,200'));
  it('percent (fraction ×100)', () => expect(formatByCode(0.32, '0%')).toBe('32%'));
  it('percent with one decimal', () => expect(formatByCode(0.325, '0.0%')).toBe('32.5%'));
  it('negative currency keeps the sign', () => expect(formatByCode(-5000, '$#,##0')).toBe('-$5,000'));
  it('empty code → the bare number', () => expect(formatByCode(185, '')).toBe('185'));
});

describe('formatCellDisplay — read-view cell text', () => {
  it('formats a number_format cell from its value', () =>
    expect(formatCellDisplay({ text: '185', value: 185, number_format: '$#,##0' })).toBe('$185'));
  it('a plain/label cell shows its raw text', () =>
    expect(formatCellDisplay({ text: 'Principal Investigator', value: null })).toBe('Principal Investigator'));
  it('a bare string passes through', () => expect(formatCellDisplay('TOTAL')).toBe('TOTAL'));
  it('every preset code round-trips through formatByCode without throwing', () => {
    for (const f of NUMBER_FORMATS) expect(typeof formatByCode(1234.5, f.code)).toBe('string');
  });
});
