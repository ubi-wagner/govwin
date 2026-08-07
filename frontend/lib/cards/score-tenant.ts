/**
 * Score a freshly-provisioned tenant's opportunity cards against all its buckets — SYNCHRONOUSLY,
 * so a new company lands with a RANKED pipeline immediately, not a flat list. Provisioning
 * (accept / partner registration / partner-org create / own-org) emits card.applied events that
 * the async OnCardApplied workflow also rescores from — but that depends on the pipeline running;
 * this makes the "auto-scored on arrival" promise hold the instant the company is created.
 *
 * Idempotent (rankBucket upserts tenant_bucket_scores). Best-effort per bucket — a scoring failure
 * must never fail provisioning. Returns the number of buckets scored.
 */
import { sqlBypass } from '@/lib/db';
import { rankBucket } from '@/lib/bucket-ranking';

export async function scoreTenantCards(tenantId: string): Promise<number> {
  if (!tenantId) return 0;
  let buckets: { id: string }[] = [];
  try {
    buckets = await sqlBypass<{ id: string }[]>`
      SELECT id FROM tenant_spotlight_buckets WHERE tenant_id = ${tenantId}::uuid AND is_active`;
  } catch (e) {
    console.error('[score-tenant] bucket fetch failed:', e);
    return 0;
  }
  const now = Date.now();
  let scored = 0;
  for (const b of buckets) {
    try { await rankBucket(tenantId, b.id, now); scored++; }
    catch (e) { console.error('[score-tenant] rankBucket failed for', b.id, e); }
  }
  return scored;
}
