-- Migration 081: spotlight bucket taxonomy + per-bucket scoring (C5).
--
-- `spotlights` was filter-only. This adds a fixed opportunity-classification
-- taxonomy and a per-(tenant × opportunity × bucket) score so the spotlight feed
-- can rank an opportunity within each bucket (e.g. "ranks #2 in Technology &
-- Innovation for you"). Scores are derived from the existing match signals
-- (naics/keyword/agency/set-aside/timeline) by the pipeline scorer; rank is
-- computed at read time (window over tenant+bucket), so it is always fresh.

CREATE TABLE IF NOT EXISTS spotlight_bucket_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    bucket          TEXT NOT NULL CHECK (bucket IN (
                        'technology_innovation', 'service_offering',
                        'capabilities', 'readiness', 'prior_funding')),
    score           INT NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, opportunity_id, bucket)
);

-- Read pattern: rank opportunities within (tenant, bucket) by score.
CREATE INDEX IF NOT EXISTS idx_sbs_tenant_bucket_score
    ON spotlight_bucket_scores (tenant_id, bucket, score DESC);
CREATE INDEX IF NOT EXISTS idx_sbs_opp
    ON spotlight_bucket_scores (opportunity_id);
