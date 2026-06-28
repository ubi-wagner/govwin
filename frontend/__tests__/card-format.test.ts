/**
 * R4 — opportunity card presentation helpers (pure, no React/DB).
 */
import { describe, expect, it } from 'vitest';
import { complianceProgress, stageMeta, bucketLabel, toneClass } from '@/components/cards/card-format';
import type { ComplianceSummary } from '@/lib/cards/card';

function summary(p: Partial<ComplianceSummary>): ComplianceSummary {
  return {
    total: 0, mandatory: 0, satisfied: 0, partial: 0, notAddressed: 0,
    notApplicable: 0, mandatorySatisfied: 0, mandatoryApplicable: 0, percentComplete: 0, ...p,
  };
}

describe('complianceProgress', () => {
  it('reads an empty matrix as neutral, not complete', () => {
    const r = complianceProgress(summary({ mandatoryApplicable: 0 }));
    expect(r.empty).toBe(true);
    expect(r.pct).toBe(0);
    expect(r.tone).toBe('gray');
  });

  it('reads "all mandatory are N/A" as neutral too (no applicable burden)', () => {
    const r = complianceProgress(summary({ mandatory: 3, mandatoryApplicable: 0, notApplicable: 3 }));
    expect(r.empty).toBe(true);
    expect(r.tone).toBe('gray');
  });

  it('bar % and label share the mandatory-applicable denominator', () => {
    // 1 of 4 applicable satisfied → 25%, label "1/4" (NOT "1/5" even with an N/A)
    const r = complianceProgress(summary({ mandatory: 5, mandatoryApplicable: 4, mandatorySatisfied: 1, notApplicable: 1, percentComplete: 25 }));
    expect(r.tone).toBe('red');
    expect(r.pct).toBe(25);
    expect(r.label).toBe('1/4 mandatory satisfied');
  });

  it('is amber from 50% to <100%', () => {
    expect(complianceProgress(summary({ mandatoryApplicable: 4, mandatorySatisfied: 2, percentComplete: 50 })).tone).toBe('amber');
    expect(complianceProgress(summary({ mandatoryApplicable: 4, mandatorySatisfied: 3, percentComplete: 75 })).tone).toBe('amber');
  });

  it('is green at 100%', () => {
    const r = complianceProgress(summary({ mandatoryApplicable: 4, mandatorySatisfied: 4, percentComplete: 100 }));
    expect(r.tone).toBe('green');
    expect(r.pct).toBe(100);
  });

  it('clamps an out-of-range percent', () => {
    expect(complianceProgress(summary({ mandatoryApplicable: 1, percentComplete: 250 })).pct).toBe(100);
    expect(complianceProgress(summary({ mandatoryApplicable: 1, percentComplete: -5 })).pct).toBe(0);
  });
});

describe('stageMeta', () => {
  it('maps known stages', () => {
    expect(stageMeta('draft').label).toBe('Draft');
    expect(stageMeta('submitted').tone).toBe('green');
    expect(stageMeta('archived').tone).toBe('gray');
  });
  it('falls back gracefully for an unknown stage', () => {
    expect(stageMeta('weird').label).toBe('weird');
    expect(stageMeta('').label).toBe('unknown');
  });
});

describe('bucketLabel', () => {
  it('maps the mig-081 taxonomy', () => {
    expect(bucketLabel('technology_innovation')).toBe('Technology & Innovation');
    expect(bucketLabel('prior_funding')).toBe('Prior Funding');
  });
  it('returns null for null and echoes an unknown key', () => {
    expect(bucketLabel(null)).toBeNull();
    expect(bucketLabel('custom')).toBe('custom');
  });
});

describe('toneClass', () => {
  it('returns a class for every tone', () => {
    for (const t of ['gray', 'blue', 'amber', 'green', 'red', 'purple'] as const) {
      expect(toneClass(t)).toMatch(/bg-/);
    }
  });
});
