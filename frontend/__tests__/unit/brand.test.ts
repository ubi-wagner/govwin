import { describe, it, expect } from 'vitest';
import { oppBrandAccent, brandMandatoryTable, TVSF_BRAND, UNMODIFIABLE_ROW_RE } from '@/lib/proposal/brand';
import type { TableContent } from '@/lib/types/canvas-document';

describe('oppBrandAccent — OPP-sheet brand accent (contextual, never global)', () => {
  it('lights up the Third-Frontier navy for a TVSF opportunity (by programType)', () => {
    expect(oppBrandAccent({ programType: 'tvsf' })).toBe(TVSF_BRAND.headerBg);
    expect(oppBrandAccent({ programType: 'TVSF' })).toBe(TVSF_BRAND.headerBg); // case-insensitive
  });

  it('lights up by agency name (Ohio Third Frontier)', () => {
    expect(oppBrandAccent({ agency: 'Ohio Third Frontier' })).toBe(TVSF_BRAND.headerBg);
    expect(oppBrandAccent({ agency: 'ohio third frontier' })).toBe(TVSF_BRAND.headerBg);
  });

  it('gives a DoD/NSF/DOE card NO accent (default chrome)', () => {
    expect(oppBrandAccent({ agency: 'Department of Defense', programType: 'sbir' })).toBeNull();
    expect(oppBrandAccent({ agency: 'NSF', programType: 'sttr' })).toBeNull();
    expect(oppBrandAccent({ agency: 'DOE', programType: 'baa' })).toBeNull();
  });

  it('is null-safe for missing / partial opportunity data', () => {
    expect(oppBrandAccent(null)).toBeNull();
    expect(oppBrandAccent(undefined)).toBeNull();
    expect(oppBrandAccent({})).toBeNull();
    expect(oppBrandAccent({ agency: null, programType: null })).toBeNull();
  });
});

describe('brandMandatoryTable — header band + shaded unmodifiable rows', () => {
  it('applies the navy header band (fill + white text + bold) and shades total/fixed rows', () => {
    const t: TableContent = {
      headers: ['($1,000s)', '2027', '2028'],
      rows: [
        ['Print-as-a-service (per job)', '120', '700'],
        ['Total revenues', '320', '700'],
        ['Gross profit', '245', '262'],
        ['Net profit', '(305)', '(788)'],
      ],
    } as unknown as TableContent;
    brandMandatoryTable(t);
    // header band
    const h0 = t.headers![0] as { style?: { bg?: string; fg?: string; bold?: boolean } };
    expect(h0.style?.bg).toBe(TVSF_BRAND.headerBg);
    expect(h0.style?.fg).toBe(TVSF_BRAND.headerFg);
    expect(h0.style?.bold).toBe(true);
    // a normal (modifiable) row is untouched
    const normal = t.rows[0][0] as { style?: { bg?: string } };
    expect(normal?.style?.bg).toBeUndefined();
    // the unmodifiable/total rows are shaded + bold
    for (const i of [1, 2, 3]) {
      const cell = t.rows[i][0] as { style?: { bg?: string; bold?: boolean } };
      expect(cell.style?.bg).toBe(TVSF_BRAND.lockedBg);
      expect(cell.style?.bold).toBe(true);
    }
  });

  it('UNMODIFIABLE_ROW_RE matches the fixed OTF categories, not the fill-in lines', () => {
    for (const label of ['Total revenues', 'Gross profit', 'Net profit', 'Equity Investment', 'Total other expenses']) {
      expect(UNMODIFIABLE_ROW_RE.test(label)).toBe(true);
    }
    for (const label of ['Print-as-a-service (per job)', 'Licensing', 'Cost of Goods Sold', 'R & D, including IP']) {
      expect(UNMODIFIABLE_ROW_RE.test(label)).toBe(false);
    }
  });
});
