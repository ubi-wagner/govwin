/**
 * Where the model lives, and the key to reach it — in ONE place.
 *
 * ── WHY THIS IS A SEAM AND NOT A CONSTANT ────────────────────────────────────────────────────
 * Six places in the frontend call Claude, in two styles: four through `@anthropic-ai/sdk` and two
 * through a raw `fetch`. The SDK reads `ANTHROPIC_BASE_URL` from the environment by default, so
 * those four follow the emulator for free. The raw-fetch pair had to do it themselves, and only
 * one of them did — `lib/tools/source-scout.ts` wrote `https://api.anthropic.com` as a literal.
 *
 * The consequence is specific rather than stylistic. `EMULATE=1` points `ANTHROPIC_BASE_URL` at
 * the committed :8787 test harness precisely so every AI-gated flow can be driven end to end with
 * no live key (docs/AI_FLOWS_PROOF.md). A hard-coded host opts that one flow out: the HITL source
 * scout would reach past the emulator to the real API, with a fake key, and fail — while every
 * other AI flow in the product runs. One surface behaving differently under the switch that exists
 * to make them all behave the same is exactly the kind of silo a coherence review is for.
 *
 * ── THE RULE THIS FILE EXISTS TO MAKE CHECKABLE ──────────────────────────────────────────────
 * The literal `api.anthropic.com` appears in this file and nowhere else in the tree.
 * `__tests__/ai-endpoint-single-source.test.ts` asserts it, so the next raw-fetch call site
 * cannot quietly re-introduce a second answer to "where is the model".
 */

/** The default, used only when nothing in the environment says otherwise. */
const DEFAULT_BASE = 'https://api.anthropic.com';

/**
 * The base URL for the Messages API, without a trailing slash.
 *
 * Trailing slashes are stripped because callers append `/v1/messages`, and `…com//v1/messages`
 * is a 404 that reads like an outage.
 */
export function anthropicBaseUrl(): string {
  return (process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** The full Messages endpoint — the one URL a raw-fetch caller actually wants. */
export function anthropicMessagesUrl(): string {
  return `${anthropicBaseUrl()}/v1/messages`;
}

/**
 * The API key, or `null` when there is none to use.
 *
 * `sk-noop` is treated as absent on purpose: it is the placeholder the sandbox boots with, and a
 * caller that tries it gets a 401 from the real API instead of the "no key, skip the AI layer"
 * branch every one of these call sites already has.
 */
export function anthropicKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k || k === 'sk-noop') return null;
  return k;
}

/** The headers every raw-fetch call to the Messages API needs. */
export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
}
