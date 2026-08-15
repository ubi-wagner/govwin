/**
 * The canonical spotlight-bucket scorer lock (docs/BUCKET_LOCKDOWN.md T2). `scoreCard` had ZERO
 * direct coverage — correctness rested on comment-discipline parity with the Python port. This
 * suite mirrors pipeline/tests/test_rescore.py case-for-case (same inputs → same outputs), so the
 * two implementations are pinned together, plus the new keyword-precision + clamp guards.
 */
import { describe, it, expect } from 'vitest';
import { scoreCard, keywordHit } from '@/lib/bucket-ranking';

const NOW_MS = 1_700_000_000_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const close = (days: number) => ({ closeDate: iso(NOW_MS + days * DAY) });

describe('scoreCard — parity with the Python port', () => {
  it('empty criteria → 0', () => {
    expect(scoreCard({}, {}, NOW_MS)).toEqual({ score: 0, factors: {} });
  });

  it('keyword fraction (1 of 2 hit → 50)', () => {
    const r = scoreCard({ title: 'AI Radar' }, { keywords: ['ai', 'quantum'] }, NOW_MS);
    expect(r).toEqual({ score: 50, factors: { keyword: 50 } });
  });

  it('naics + agency weighted average → 75', () => {
    const r = scoreCard(
      { agency: 'DARPA', naicsCodes: ['541715'] },
      { naics: ['541715', '518210'], agencies: ['darpa'] },
      NOW_MS,
    );
    expect(r).toEqual({ score: 75, factors: { naics: 50, agency: 100 } });
  });

  it('spotlightSummary is authoritative matching text', () => {
    const r = scoreCard({ spotlightSummary: 'hypersonic propulsion' }, { keywords: ['hypersonic'] }, NOW_MS);
    expect(r).toEqual({ score: 100, factors: { keyword: 100 } });
  });

  it('programType exact match (hit=100, miss=0)', () => {
    expect(scoreCard({ programType: 'sbir_phase_1' }, { programTypes: ['sbir_phase_1'] }, NOW_MS).score).toBe(100);
    expect(scoreCard({ programType: 'sttr' }, { programTypes: ['sbir_phase_1'] }, NOW_MS).score).toBe(0);
  });

  it('accessibility gated on useAccessibility', () => {
    expect(scoreCard({ setAsideType: '8(a)' }, { setAsides: ['8(a)'] }, NOW_MS)).toEqual({ score: 0, factors: {} });
    const on = scoreCard({ setAsideType: '8(a) set-aside' }, { setAsides: ['8(a)'], useAccessibility: true }, NOW_MS);
    expect(on).toEqual({ score: 100, factors: { accessibility: 100 } });
  });

  it('timeline decay bands', () => {
    expect(scoreCard(close(15), { useTimeline: true }, NOW_MS).factors).toEqual({ timeline: 100 });
    expect(scoreCard(close(45), { useTimeline: true }, NOW_MS).factors).toEqual({ timeline: 60 });
    expect(scoreCard(close(75), { useTimeline: true }, NOW_MS).factors).toEqual({ timeline: 30 });
    expect(scoreCard(close(120), { useTimeline: true }, NOW_MS).factors).toEqual({ timeline: 10 });
    expect(scoreCard(close(-1), { useTimeline: true }, NOW_MS).factors).toEqual({ timeline: 0 });
  });

  it('custom weights (keyword v=1 w=3, naics v=0 w=1 → 75)', () => {
    const r = scoreCard(
      { title: 'quantum', naicsCodes: [] },
      { keywords: ['quantum'], naics: ['541715'], weights: { keyword: 3, naics: 1 } },
      NOW_MS,
    );
    expect(r.score).toBe(75);
  });

  it('Math.round half-up (1 of 40 → 2.5 → 3)', () => {
    const kws = Array.from({ length: 40 }, (_, i) => `kw${i}`);
    const r = scoreCard({ title: 'kw0 only' }, { keywords: kws }, NOW_MS);
    expect(r).toEqual({ score: 3, factors: { keyword: 3 } });
  });
});

describe('keyword precision (T2 lock-down)', () => {
  it('short token matches on a word boundary, not substring', () => {
    expect(keywordHit('ai radar systems', 'ai')).toBe(true);
    expect(keywordHit('email marketing', 'ai')).toBe(false);   // was a substring false-positive
    expect(keywordHit('html and css', 'ml')).toBe(false);
    expect(keywordHit('using ml pipelines', 'ml')).toBe(true);
  });

  it('multi-word phrases stay fuzzy substring', () => {
    expect(keywordHit('concrete 3d printing at scale', '3d print')).toBe(true);
    expect(keywordHit('advanced manufacturing', 'manufacturing')).toBe(true);
  });

  it('a bucket of short tokens no longer false-scores an unrelated card', () => {
    // "ai"/"ml" against an email-marketing card → 0 (was 100 under substring).
    const r = scoreCard({ title: 'Email marketing platform' }, { keywords: ['ai', 'ml'] }, NOW_MS);
    expect(r.score).toBe(0);
  });
});

describe('score stays in [0,100] (clamp belt for the mig 180 CHECK)', () => {
  it('never exceeds 100 even with a large weight', () => {
    const r = scoreCard({ title: 'quantum radar' }, { keywords: ['quantum', 'radar'], weights: { keyword: 9999 } }, NOW_MS);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBe(100);
  });
});
