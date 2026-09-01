/**
 * In-memory IP-based rate limiter for public endpoints.
 *
 * Uses a Map<string, { count, resetAt }> for per-IP tracking.
 * Suitable for single-container Railway deploys.
 * For multi-container: migrate to rate_limit_state table or Redis.
 *
 * ⚠️ `rate_limit_state` IS UNUSED SCHEMA — verified 2026-09-01. That table holds three
 * configured source quotas and NO code in any of the three services reads or writes it;
 * the line above is its only mention in the tree.
 *
 * What that does and does not mean, because the first version of this note got it wrong:
 *   · it does NOT mean a third-party quota is undefended. This limiter is IP-based and
 *     protects OUR public endpoints. The SAM.gov quota is handled in the pipeline, by
 *     `sam_gov.py` reading `X-RateLimit-Remaining` and raising `IngesterRateLimitError`
 *     on 429 — reacting to the provider's own accounting, which is strictly better than
 *     a counter of our own that can drift.
 *   · it DOES mean the limiter here is per-container. On a multi-container deploy each
 *     container carries its own Map, so a caller gets N times the intended limit. That is
 *     the real, bounded consequence, and it is a scaling concern rather than a live gap.
 * Found by `audit-producer-consumer.mjs` (docs/PRODUCER_CONSUMER_AUDIT.md).
 *
 * Usage in middleware:
 *   if (!checkRateLimit(ip, '/api/applications', 5, 15 * 60 * 1000)) {
 *     return new NextResponse('Too many requests', { status: 429 });
 *   }
 */

type RateLimitEntry = { count: number; resetAt: number };

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent memory leak (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
// Hard cap: if an attacker sends requests from >100K unique IPs,
// force an immediate cleanup to bound memory usage.
const MAX_STORE_SIZE = 100_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  const oversize = store.size >= MAX_STORE_SIZE;
  if (!oversize && now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
  // If still over limit after expiry cleanup, drop everything
  if (store.size >= MAX_STORE_SIZE) {
    store.clear();
  }
}

/**
 * Check if a request is within rate limits.
 * @param key - unique identifier (e.g., IP + path)
 * @param limit - max requests per window
 * @param windowMs - window duration in milliseconds
 * @returns { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  cleanup();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count++;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}
