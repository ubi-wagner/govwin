import { describe, it, expect } from 'vitest';
import { describeImages } from '@/lib/vision';

/** The vision engine is gated on a real ANTHROPIC_API_KEY. With none (the sandbox/CI default) it must
 *  make NO calls and return an empty caption per image, so enrichment degrades cleanly to OCR-only. */
const hasRealKey = !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-noop';

describe('vision engine gate', () => {
  it.skipIf(hasRealKey)('returns none for every image when the key is absent/noop (no calls)', async () => {
    const r = await describeImages([Buffer.from('one'), Buffer.from('two')]);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.engine === 'none' && x.caption === '')).toBe(true);
  });
  it('empty batch → empty result', async () => {
    expect(await describeImages([])).toEqual([]);
  });
});
