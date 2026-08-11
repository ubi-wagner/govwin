import { describe, it, expect } from 'vitest';
import { proposeDemoRegions } from '@/lib/propose-regions';

/**
 * BOX-2 — the vision stand-in that seeds boxes for the human to confirm. It must always propose
 * regions that sit fully inside the frame (a box running off the edge would crop garbage), be
 * deterministic, and never emit slivers.
 */
describe('BOX-2: proposeDemoRegions (vision stand-in)', () => {
  it('proposes figure + table regions fully inside the frame', () => {
    const r = proposeDemoRegions(1000, 800);
    expect(r.length).toBe(2);
    expect(r.map((x) => x.kind).sort()).toEqual(['figure', 'table']);
    for (const b of r) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1000);
      expect(b.y + b.h).toBeLessThanOrEqual(800);
      expect(b.w).toBeGreaterThan(8);
      expect(b.h).toBeGreaterThan(8);
      expect(b.title).toMatch(/Suggested/);
    }
  });

  it('is deterministic', () => {
    expect(proposeDemoRegions(640, 480)).toEqual(proposeDemoRegions(640, 480));
  });

  it('clamps tiny frames to bounds without off-frame boxes', () => {
    for (const b of proposeDemoRegions(30, 30)) {
      expect(b.x + b.w).toBeLessThanOrEqual(30);
      expect(b.y + b.h).toBeLessThanOrEqual(30);
    }
  });
});
