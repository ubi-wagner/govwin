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

/**
 * True if `keyword` occurs in `text` (both compared lowercased). Precision rule: a short single-word
 * token (≤3 chars) matches only on a WORD BOUNDARY, so the default buckets' bare `ai`/`ml` no longer
 * false-positive on "email"/"html"; longer tokens and multi-word phrases keep substring matching
 * (deliberately fuzzy — "3d print" should hit "3d printing"). Deterministic. Mirror in
 * pipeline/src/workflows/actions/rescore.py::_keyword_hit.
 */
export function keywordHit(text: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  if (k.length <= 3 && !/\s/.test(k)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`).test(text);
  }
  return text.includes(k);
}

export interface BucketCriteria {
  keywords?: string[];
  naics?: string[];
  agencies?: string[];
  programTypes?: string[];
  setAsides?: string[];
  useAccessibility?: boolean;
  useTimeline?: boolean;
  includeClosed?: boolean;
  trlBand?: string | null;           // reserved (needs opp-TRL extraction)
  weights?: Record<string, number>;
}

/**
 * Coerce arbitrary client input into a valid BucketCriteria (docs/BUCKET_LOCKDOWN.md T2). Drops
 * junk rather than 400-ing: string-array fields keep only non-empty strings; toggles must be real
 * booleans; weights keep only finite, non-negative numbers. An explicit empty array is preserved
 * (so a client can clear keywords); an omitted field stays absent (so a PATCH can merge). Guarantees
 * the stored jsonb is always shaped the way scoreCard expects — no silent all-zero from bad shapes.
 */
export function sanitizeBucketCriteria(input: unknown): BucketCriteria {
  const c = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : undefined;
  const out: BucketCriteria = {};
  const set = (k: 'keywords' | 'naics' | 'agencies' | 'programTypes' | 'setAsides') => {
    const a = strArr(c[k]);
    if (a !== undefined) out[k] = a;
  };
  set('keywords'); set('naics'); set('agencies'); set('programTypes'); set('setAsides');
  if (typeof c.useAccessibility === 'boolean') out.useAccessibility = c.useAccessibility;
  if (typeof c.useTimeline === 'boolean') out.useTimeline = c.useTimeline;
  if (typeof c.includeClosed === 'boolean') out.includeClosed = c.includeClosed;
  if (typeof c.trlBand === 'string' || c.trlBand === null) out.trlBand = c.trlBand as string | null;
  if (c.weights && typeof c.weights === 'object' && !Array.isArray(c.weights)) {
    const w: Record<string, number> = {};
    for (const [k, v] of Object.entries(c.weights as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) w[k] = v;
    }
    if (Object.keys(w).length) out.weights = w;
  }
  return out;
}

export interface CardFields {
  title?: string | null;
  description?: string | null;
  spotlightSummary?: string | null;   // admin's first-pass matching context (mig 107)
  office?: string | null;
  agency?: string | null;
  naicsCodes?: string[] | null;
  programType?: string | null;
  setAsideType?: string | null;
  closeDate?: string | null;
}

/** Score one card (0-100) against the bucket criteria; returns the per-signal factors too. */
export function scoreCard(card: CardFields, criteria: BucketCriteria, nowMs: number): { score: number; factors: Record<string, number> } {
  const w = criteria.weights ?? {};
  const parts: Array<{ key: string; v: number; weight: number }> = [];
  // The admin's spotlight summary is authoritative matching context — it's the
  // curated first-pass blurb built for exactly this ranking (mig 107).
  const text = [card.title, card.spotlightSummary, card.description, card.office].filter(Boolean).join(' ').toLowerCase();

  if (criteria.keywords?.length) {
    const hits = criteria.keywords.filter((k) => k && keywordHit(text, k)).length;
    parts.push({ key: 'keyword', v: hits / criteria.keywords.length, weight: w.keyword ?? 1 });
  }
  if (criteria.naics?.length) {
    const cn = new Set((card.naicsCodes ?? []).map((n) => String(n)));
    const inter = criteria.naics.filter((n) => cn.has(String(n))).length;
    parts.push({ key: 'naics', v: inter / criteria.naics.length, weight: w.naics ?? 1 });
  }
  if (criteria.agencies?.length) {
    const a = (card.agency ?? '').toLowerCase();
    parts.push({ key: 'agency', v: criteria.agencies.some((x) => a.includes(x.toLowerCase())) ? 1 : 0, weight: w.agency ?? 1 });
  }
  if (criteria.programTypes?.length) {
    const p = (card.programType ?? '').toLowerCase();
    parts.push({ key: 'program', v: criteria.programTypes.some((x) => p === x.toLowerCase()) ? 1 : 0, weight: w.program ?? 1 });
  }
  if (criteria.useAccessibility && criteria.setAsides?.length) {
    const s = (card.setAsideType ?? '').toLowerCase();
    parts.push({ key: 'accessibility', v: criteria.setAsides.some((x) => s.includes(x.toLowerCase())) ? 1 : 0, weight: w.accessibility ?? 1 });
  }
  if (criteria.useTimeline !== false && card.closeDate) {
    // Skip an UNPARSEABLE close date rather than pushing a phantom 0.1 timeline signal — parity with
    // the Python scorer's `_close_ms is None` skip (an invalid date must not change the denominator).
    const t = new Date(card.closeDate).getTime();
    if (Number.isFinite(t)) {
      const days = (t - nowMs) / 86_400_000;
      const v = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 0.6 : days <= 90 ? 0.3 : 0.1;
      parts.push({ key: 'timeline', v, weight: w.timeline ?? 0.5 });
    }
  }

  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  // v ∈ [0,1] for every signal so the weighted average is already in range; clamp anyway to belt the
  // DB CHECK(score BETWEEN 0 AND 100) (mig 180) — a negative/huge criteria weight can't leak a bad score.
  const raw = totalW > 0 ? Math.round((100 * parts.reduce((s, p) => s + p.v * p.weight, 0)) / totalW) : 0;
  const score = Math.max(0, Math.min(100, raw));
  const factors: Record<string, number> = {};
  for (const p of parts) factors[p.key] = Math.max(0, Math.min(100, Math.round(p.v * 100)));
  return { score, factors };
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
