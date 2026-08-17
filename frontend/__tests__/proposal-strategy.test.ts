/**
 * Capture-strategy reader (#1) — lib/proposal/strategy.ts.
 *
 * The OnProposalCreated advisory steps land their text at different nesting depths across the
 * fabric's paths (result.result.text · result.text · text · plain string). These tests pin that
 * digStepText finds it in all of them, and that buildProposalStrategy drops empty sections +
 * sets hasAny correctly (so the panel self-hides).
 */
import { describe, expect, it } from 'vitest';
import { digStepText, buildProposalStrategy } from '@/lib/proposal/strategy';

describe('digStepText — variable agent-output nesting', () => {
  it('finds text nested at result.result.text (AI_INVOKE step shape)', () => {
    expect(digStepText({ result: { result: { text: '  Win themes: X, Y  ' } } })).toBe('Win themes: X, Y');
  });
  it('finds text at result.text (queue shape)', () => {
    expect(digStepText({ result: { text: 'brief' } })).toBe('brief');
  });
  it('finds a bare {text}', () => {
    expect(digStepText({ text: 'hello' })).toBe('hello');
  });
  it('accepts a plain string', () => {
    expect(digStepText('just a string')).toBe('just a string');
  });
  it('returns null for empty / missing / non-text', () => {
    expect(digStepText(null)).toBeNull();
    expect(digStepText({ result: { result: {} } })).toBeNull();
    expect(digStepText({ text: '   ' })).toBeNull();
    expect(digStepText({ foo: 'bar' })).toBeNull();
  });
});

describe('buildProposalStrategy', () => {
  it('renders produced sections in display order and drops empties; hasAny true', () => {
    const sr = {
      ai_capture_strategy: { result: { result: { text: 'Strategy body' } } },
      ai_research_scout: { result: { text: 'Research brief' } },
      ai_pp_matcher: { result: { result: { text: '' } } }, // empty → dropped
      // ai_cost_estimator absent → dropped
    };
    const out = buildProposalStrategy(sr, '2026-08-17T00:00:00Z');
    expect(out.hasAny).toBe(true);
    expect(out.sections.map((s) => s.key)).toEqual(['strategy', 'research']); // order + empties dropped
    expect(out.sections[0].text).toBe('Strategy body');
    expect(out.generatedAt).toBe('2026-08-17T00:00:00Z');
  });
  it('hasAny is false when nothing rendered (panel self-hides)', () => {
    expect(buildProposalStrategy({}, null).hasAny).toBe(false);
    expect(buildProposalStrategy(null, null).sections).toEqual([]);
    expect(buildProposalStrategy({ ai_capture_strategy: { result: {} } }, null).hasAny).toBe(false);
  });
});
