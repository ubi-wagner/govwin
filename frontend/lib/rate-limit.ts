/**
 * In-memory IP-based rate limiter for public endpoints.
 *
 * Uses a Map<string, { count, resetAt }> for per-IP tracking.
 * Suitable for single-container Railway deploys.
 * For multi-container: migrate to rate_limit_state table or Redis.
 *
 * ⚠️ `rate_limit_state` IS A PLAN, NOT AN IMPLEMENTATION — verified 2026-09-01.
 * That table holds three configured source limits (sam_gov 100/hr, sbir_gov 30/hr,
 * grants_gov 50/hr) and NO code in any of the three services reads or writes it; this
 * comment is its only mention in the tree. The limiting that actually runs is the
 * in-memory map below, which is per-container and therefore does not hold across
 * containers and does not defend a third-party quota the way those stored numbers imply.
 * Said out loud because the rows LOOK like enforcement: somebody reading them would
 * reasonably conclude the SAM.gov quota is protected. Found by
 * `audit-producer-consumer.mjs` (docs/PRODUCER_CONSUMER_AUDIT.md).
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
