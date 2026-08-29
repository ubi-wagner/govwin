/**
 * Per-tenant spotlight bucket ranking (greenfield, mig 096). A bucket ranks the
 * tenant's LOCAL pipeline (tenant_opportunity_cards) against weighted criteria, on
 * demand — so any bucket registered at any time immediately ranks the whole
 * available universe. Alignment (tech/naics/agency/program) and accessibility
 * (set-aside) are separate, customer-weighted signals.
 *
 * TRL + prior-funding are criteria fields reserved here; fully activating them needs
 * opp-TRL extraction + a tenant→award linkage (a follow-on) — noted, not faked.
 */

import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { coerceJsonb } from '@/lib/jsonb';

// The pure scorer lives in a ZERO-IMPORT LEAF (lib/bucket-scoring.ts) so the TS↔Python parity
// runner can load it without a DATABASE_URL — this module imports @/lib/db, which throws at module
// scope without one. Re-exported here so every existing `from '@/lib/bucket-ranking'` still works.
export {
  keywordHit,
  closeMs,
  sanitizeBucketCriteria,
  scoreCard,
  type BucketCriteria,
  type CardFields,
  type ScoreInputs,
} from '@/lib/bucket-scoring';
import { scoreCard } from '@/lib/bucket-scoring';
import type { BucketCriteria, CardFields } from '@/lib/bucket-scoring';

/**
 * One SQL pre-pass: how well does this bucket's keyword set match the tenant's OWN copy of each
 * solicitation (`tenant_opportunity_documents.text_tsv`, mig 238)?
 *
 * ── WHY A PRE-PASS AND NOT SQL SCORING ───────────────────────────────────────────────────────
 * `scoreCard` is a pure function with a second implementation in Python. Moving the scoring into
 * SQL would split the runtimes structurally and make the parity check — the thing that actually
 * holds the mirror pair together — impossible to write. So SQL supplies ONE MORE INPUT and the
 * scorer stays pure, mirrored and testable.
 *
 * ── AND WHY IT NEEDS NO JOIN TO THE MASTER ───────────────────────────────────────────────────
 * The corpus is in tenant space. This query touches one FORCE-RLS table under the tenant's own
 * GUC, so isolation is structural rather than remembered. Ranking no longer reads a master table
 * at all.
 *
 * Normalization: `ts_rank` is unbounded-ish and corpus-relative, so a raw value is not comparable
 * between two solicitations of different lengths. Each opportunity's best document rank is divided
 * by the highest rank in this pass, putting the result in [0,1] — a RELATIVE measure, which is what
 * a ranking wants. With one matching card the winner is 1.0; with none the map is empty and every
 * card ABSTAINS, which is the honest answer when there is no corpus to search.
 */
export async function corpusRanksForKeywords(
  tx: typeof sql,
  tenantId: string,
  keywords: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // websearch_to_tsquery treats bare words as AND. A bucket's keywords are alternatives, not a
  // conjunction, so they are OR-ed — quoted so a multi-word keyword stays a phrase and a stray
  // operator character cannot change the query's shape.
  const query = keywords
    .map((k) => k.trim()).filter(Boolean)
    .map((k) => `"${k.replace(/"/g, '')}"`)
    .join(' OR ');
  if (!query) return out;
  try {
    const rows = await tx<Array<{ opportunityId: string; rel: number }>>`
      WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq),
      hits AS (
        SELECT d.opportunity_id, max(ts_rank(d.text_tsv, q.tsq)) AS rank
        FROM tenant_opportunity_documents d, q
        WHERE d.tenant_id = ${tenantId}::uuid AND d.text_tsv @@ q.tsq
        GROUP BY d.opportunity_id)
      SELECT opportunity_id, (rank / NULLIF(max(rank) OVER (), 0))::float8 AS rel FROM hits`;
    for (const r of rows) if (r.rel != null) out.set(r.opportunityId, Number(r.rel));
  } catch (e) {
    // A corpus failure must leave ranking working on the card alone, not break it. An empty map
    // means every card abstains — the same state as a tenant whose corpus has not landed yet.
    console.error('[ranking] corpus pre-pass failed (non-fatal)', tenantId, e);
  }
  return out;
}

// NOTE: card-arrival scoring is NOT done here. It moved tenant-side + event-driven — the
// bridge fan-out emits capture:card.applied and the pipeline OnCardApplied workflow rescores
// (pipeline/src/workflows/actions/rescore.py, a faithful port of scoreCard). The former
// in-tx `autoScoreCard` helper was removed as dead code in the deepest-review sweep (F-A).

/**
 * Score ONE just-applied card against ALL of the tenant's active buckets — the transpose of
 * rankBucket (one card × N buckets vs one bucket × N cards). This is the SYNCHRONOUS fallback the
 * bridge fan-out calls (RANK-6): the OPP-push path previously only emitted capture:card.applied and
 * depended entirely on the pipeline OnCardApplied worker, so a downed worker left pushed cards
 * unscored — unlike provisioning (scoreTenantCards) and bucket-create (rankBucket), which both score
 * inline. Idempotent with the async path (same ON CONFLICT upsert). A faithful peer of
 * pipeline/.../rescore.py::rescore_tenant_card, but respecting per-bucket includeClosed like rankBucket
 * (a closed card is scored only into buckets that include closed opps — the three writers stay consistent).
 */
export async function scoreCardForTenant(tenantId: string, opportunityId: string, nowMs: number): Promise<{ scored: number }> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx<Array<{ card: CardFields; lifecycleStatus: string }>>`
      SELECT card, lifecycle_status FROM tenant_opportunity_cards
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid LIMIT 1`;
    if (!row) return { scored: 0 };
    const buckets = await tx<Array<{ id: string; criteria: BucketCriteria }>>`
      SELECT id, criteria FROM tenant_spotlight_buckets WHERE tenant_id = ${tenantId}::uuid AND is_active`;
    const cf = coerceJsonb<CardFields>(row.card, {});
    const isOpen = row.lifecycleStatus === 'open';
    let scored = 0;
    for (const b of buckets) {
      const criteria = coerceJsonb<BucketCriteria>(b.criteria, {});
      if (!isOpen && !criteria.includeClosed) continue; // parity with rankBucket's card-set rule
      // Per bucket, because the corpus rank is a function of THIS bucket's keywords. The pre-pass
      // spans the tenant's WHOLE corpus, not just this card — deliberately, so the normalization
      // denominator is identical to the one rankBucket computes. Scoring one card must not give it
      // a different number than scoring it as part of a full re-rank; that difference would surface
      // as a card's score drifting depending on which writer touched it last.
      const corpus = await corpusRanksForKeywords(tx, tenantId, criteria.keywords ?? []);
      const { score, factors } = scoreCard(cf, criteria, nowMs, {
        corpusRank: corpus.has(opportunityId) ? corpus.get(opportunityId)! : null,
      });
      await tx`
        INSERT INTO tenant_bucket_scores (tenant_id, bucket_id, opportunity_id, score, factors)
        VALUES (${tenantId}::uuid, ${b.id}::uuid, ${opportunityId}::uuid, ${score}, ${sql.json(factors)})
        ON CONFLICT (tenant_id, bucket_id, opportunity_id) DO UPDATE SET
          score = EXCLUDED.score, factors = EXCLUDED.factors, computed_at = now()`;
      scored++;
    }
    return { scored };
  });
}

/** Rank a bucket against the tenant's local pipeline; upsert per-card scores. */
export async function rankBucket(tenantId: string, bucketId: string, nowMs: number): Promise<{ ranked: number }> {
  return withTenant(tenantId, async (tx) => {
    const bucket = await tx<Array<{ id: string; criteria: BucketCriteria }>>`
      SELECT id, criteria FROM tenant_spotlight_buckets
      WHERE tenant_id = ${tenantId}::uuid AND id = ${bucketId}::uuid AND is_active LIMIT 1
    `;
    if (bucket.length === 0) return { ranked: 0 };
    // coerceJsonb: if any writer stored criteria via `JSON.stringify(x)::jsonb` it reads back as a
    // STRING, and `criteria.keywords` would be undefined → every card silently scores 0. Coerce to an
    // object (docs/BUCKET_LOCKDOWN.md T2; the repo's #1 jsonb footgun, lib/jsonb.ts).
    const criteria = coerceJsonb<BucketCriteria>(bucket[0].criteria, {});

    const cards = await tx<Array<{ opportunityId: string; card: CardFields }>>`
      SELECT opportunity_id, card FROM tenant_opportunity_cards
      WHERE tenant_id = ${tenantId}::uuid
        ${criteria.includeClosed ? tx`` : tx`AND lifecycle_status = 'open'`}
    `;
    // One pre-pass for the whole bucket (mig 238): the corpus rank depends on the bucket's keywords,
    // not on the card, so it is computed once and looked up per card.
    const corpus = await corpusRanksForKeywords(tx, tenantId, criteria.keywords ?? []);
    let ranked = 0;
    for (const c of cards) {
      const { score, factors } = scoreCard(coerceJsonb<CardFields>(c.card, {}), criteria, nowMs, {
        corpusRank: corpus.has(c.opportunityId) ? corpus.get(c.opportunityId)! : null,
      });
      await tx`
        INSERT INTO tenant_bucket_scores (tenant_id, bucket_id, opportunity_id, score, factors)
        VALUES (${tenantId}::uuid, ${bucketId}::uuid, ${c.opportunityId}::uuid, ${score}, ${sql.json(factors)})
        ON CONFLICT (tenant_id, bucket_id, opportunity_id) DO UPDATE SET
          score = EXCLUDED.score, factors = EXCLUDED.factors, computed_at = now()
      `;
      ranked++;
    }
    return { ranked };
  });
}
