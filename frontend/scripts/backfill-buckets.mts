/** Backfill default spotlight buckets for existing tenants + re-score their cards (#104). */
import { sql } from '@/lib/db';
import { seedDefaultBuckets } from '@/lib/spotlight/default-buckets';
import { autoScoreCard } from '@/lib/bucket-ranking';
import { withTenant } from '@/lib/rls';

const now = Date.now();
try {
  const tenants = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM tenants WHERE status IN ('active','trial') ORDER BY created_at`;
  for (const t of tenants) {
    const seeded = await seedDefaultBuckets(t.id);
    let scored = 0;
    await withTenant(t.id, async (tx) => {
      const cards = await tx<{ opportunityId: string; card: Record<string, unknown> }[]>`
        SELECT opportunity_id AS "opportunityId", card FROM tenant_opportunity_cards WHERE tenant_id = ${t.id}::uuid`;
      for (const c of cards) { await autoScoreCard(tx, t.id, c.opportunityId, c.card, now); scored++; }
    });
    // top-3 by best bucket score, for a sanity glance
    const top = await sql<{ title: string; score: number }[]>`
      SELECT (c.card->>'title') AS title, max(s.score)::int AS score
      FROM tenant_bucket_scores s JOIN tenant_opportunity_cards c ON c.opportunity_id=s.opportunity_id AND c.tenant_id=s.tenant_id
      WHERE s.tenant_id=${t.id}::uuid GROUP BY 1 ORDER BY 2 DESC LIMIT 3`;
    console.log(`${t.slug}: +${seeded} buckets, scored ${scored} cards; top: ${top.map(x=>`${(x.title||'').slice(0,28)}=${x.score}`).join(' · ') || '(none)'}`);
  }
} finally { await sql.end(); }
