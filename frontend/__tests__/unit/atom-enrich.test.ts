import { describe, it, expect } from 'vitest';
import { cleanOcr } from '@/lib/atom-enrich';

/** cleanOcr squeezes raw OCR output into a compact, storable string for the atom's content/summary. */
describe('cleanOcr', () => {
  it('collapses space/tab runs and trims', () => {
    expect(cleanOcr('  Direct   Labor\t 59200  ')).toBe('Direct Labor 59200');
  });
  it('collapses blank lines but keeps single newlines (structure without noise)', () => {
    expect(cleanOcr('Line 1\n\n\nLine 2')).toBe('Line 1\nLine 2');
  });
  it('strips whitespace hugging newlines', () => {
    expect(cleanOcr('Row A  \n   Row B')).toBe('Row A\nRow B');
  });
  it('caps very long text', () => {
    expect(cleanOcr('x'.repeat(9000)).length).toBeLessThanOrEqual(4000);
  });
  it('whitespace-only in → empty out', () => {
    expect(cleanOcr('   \n  \t ')).toBe('');
  });
});
