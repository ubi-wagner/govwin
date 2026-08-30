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
  measureCoverage,
  describeComposition,
  DEFAULT_WEIGHTS,
  type BucketCriteria,
  type CardFields,
  type ScoreInputs,
  type SignalCoverage,
  type CompositionEntry,
} from '@/lib/bucket-scoring';
import { scoreCard } from '@/lib/bucket-scoring';
import type { BucketCriteria, CardFields } from '@/lib/bucket-scoring';

/**
 * Which lens surfaced the opportunity that became this build? (F13)
 *
 * The tenant's highest-scoring active bucket for this opportunity, resolved at PURCHASE time and
 * frozen into `proposals.source_bucket` + `origin_card.bucket`. It is the only way to answer whether
 * a customer's buckets are doing anything — without it, the ranking work can be judged by score
 * distribution and never by outcome.
 *
 * ── WHY THIS IS A SHARED HELPER ──────────────────────────────────────────────────────────────
 * This lookup already existed, correct and complete, in `app/api/portal/[tenantSlug]/proposals/
 * create/route.ts` — a route whose own comment states *"the real product flow provisions proposals
 * via portal release — provisionProposalForPortal — which never hits this route; this is the future
 * billing hook."* Meanwhile `lib/provision-proposal.ts`, the path that actually runs, wrote
 * `bucket: null` and `source_bucket: null` as literals. So the column read as "nothing writes it"
 * when in fact something did, in a file that never executes. One helper, both callers — the same
 * no-drift rule `provisionAndReleasePortal` follows for the two release paths.
 *
 * ── AND WHY IT SCOPES ITSELF ─────────────────────────────────────────────────────────────────
 * `tenant_bucket_scores` is FORCE-RLS and `provisionProposal` is called BOTH by the tenant
 * (self-provision) and by an rfp_admin releasing on a tenant's behalf. An admin caller has no
 * ambient tenant context, so an unscoped read would match nothing and return null — silently, and
 * indistinguishably from "this opportunity was never in a bucket". `withTenant` makes it explicit.
 *
 * Best-effort: attribution must never fail a provision. A null means "no bucket", which is a real
 * and common answer (an admin-granted opportunity that was never spotlighted).
 */
export async function resolveSourceBucket(
  tenantId: string,
  opportunityId: string,
): Promise<{ key: string; score: number } | null> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const [b] = await tx<Array<{ bucket: string; score: number }>>`
        SELECT tsb.name AS bucket, s.score
        FROM tenant_bucket_scores s
        JOIN tenant_spotlight_buckets tsb ON tsb.id = s.bucket_id
        WHERE s.tenant_id = ${tenantId}::uuid AND s.opportunity_id = ${opportunityId}::uuid
          AND tsb.is_active
        ORDER BY s.score DESC NULLS LAST, tsb.name
        LIMIT 1`;
      return b ? { key: b.bucket, score: Number(b.score) } : null;
    });
  } catch (e) {
    console.error('[ranking] source bucket lookup failed (non-fatal)', tenantId, opportunityId, e);
    return null;
  }
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
      const { score, factors } = scoreCard(cf, criteria, nowMs);
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
    let ranked = 0;
    for (const c of cards) {
      const { score, factors } = scoreCard(coerceJsonb<CardFields>(c.card, {}), criteria, nowMs);
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
