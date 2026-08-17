/** Backfill default spotlight buckets for existing tenants + rank their cards.
 *  Scoring is per-bucket now (rankBucket, event-driven port) — the old in-tx autoScoreCard is gone
 *  (docs/BUCKET_LOCKDOWN.md). Idempotent: seedDefaultBuckets no-ops a tenant that already has buckets;
 *  rankBucket upserts. Reads are RLS-scoped via withTenant; rankBucket self-contexts. */
import { sql } from '@/lib/db';
import { seedDefaultBuckets } from '@/lib/spotlight/default-buckets';
import { rankBucket } from '@/lib/bucket-ranking';
import { withTenant } from '@/lib/rls';

const now = Date.now();
try {
  const tenants = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM tenants WHERE status IN ('active','trial') ORDER BY created_at`;
  for (const t of tenants) {
    const seeded = await seedDefaultBuckets(t.id);
    // Read the active bucket ids in-context, then rank each (rankBucket opens its own tenant tx).
    const bucketIds = await withTenant(t.id, (tx) =>
      tx<{ id: string }[]>`SELECT id FROM tenant_spotlight_buckets WHERE tenant_id = ${t.id}::uuid AND is_active`);
    let scores = 0;
    for (const b of bucketIds) scores += (await rankBucket(t.id, b.id, now)).ranked;
    // top-3 by best bucket score, for a sanity glance
    const top = await withTenant(t.id, (tx) => tx<{ title: string; score: number }[]>`
      SELECT (c.card->>'title') AS title, max(s.score)::int AS score
      FROM tenant_bucket_scores s
      JOIN tenant_opportunity_cards c ON c.opportunity_id = s.opportunity_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${t.id}::uuid GROUP BY 1 ORDER BY 2 DESC LIMIT 3`);
    console.log(`${t.slug}: +${seeded} buckets, ${bucketIds.length} ranked (${scores} card-scores); top: ${top.map((x) => `${(x.title || '').slice(0, 28)}=${x.score}`).join(' · ') || '(none)'}`);
  }
} finally { await sql.end(); }
