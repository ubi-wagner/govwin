import { describe, it, expect } from 'vitest';
import { isProposalPaywallBypassed } from '@/lib/paywall';

// Founding-cohort paywall is FAIL-SAFE: enforced by default, bypassed ONLY on an explicit
// FOUNDING_COHORT_BYPASS=true. A missing/empty/typo'd value must never bypass (fail-open was
// the launch-readiness audit's revenue risk).
describe('isProposalPaywallBypassed (fail-safe)', () => {
  it('unset → NOT bypassed (paywall enforced)', () => {
    expect(isProposalPaywallBypassed({})).toBe(false);
  });
  it("'false' → NOT bypassed", () => {
    expect(isProposalPaywallBypassed({ FOUNDING_COHORT_BYPASS: 'false' })).toBe(false);
  });
  it("'true' → bypassed (explicit founding-cohort opt-in)", () => {
    expect(isProposalPaywallBypassed({ FOUNDING_COHORT_BYPASS: 'true' })).toBe(true);
  });
  it.each(['', 'TRUE', '1', 'yes', 'on', ' true', 'True'])(
    "typo/other %o → NOT bypassed (never fail-open)",
    (v) => {
      expect(isProposalPaywallBypassed({ FOUNDING_COHORT_BYPASS: v })).toBe(false);
    },
  );
});
