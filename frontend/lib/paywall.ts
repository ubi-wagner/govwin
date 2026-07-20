/**
 * Founding-cohort proposal paywall.
 *
 * Self-serve Stripe billing is descoped; access is gated UPSTREAM by the comp-code
 * purchase → curation → release flow (which provisions the first proposal directly, not
 * through the /proposals/create route this guards). This is the future billing hook.
 *
 * FAIL-SAFE: the paywall is ENFORCED by default. Bypass requires an EXPLICIT opt-in
 * (`FOUNDING_COHORT_BYPASS=true`) — a missing, empty, or typo'd env never gives the
 * product away. A founding-cohort deploy sets `FOUNDING_COHORT_BYPASS=true` (logged loudly
 * at the call site); removing it at billing-go-live enforces the paywall automatically.
 *
 * (Previously `paywallEnforced = env === 'false'`, i.e. ANY non-'false' value — including
 * unset — bypassed. That fail-OPEN default was the launch-readiness audit's revenue risk.)
 */
export function isProposalPaywallBypassed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env.FOUNDING_COHORT_BYPASS === 'true';
}
