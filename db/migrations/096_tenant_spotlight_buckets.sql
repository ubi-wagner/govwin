-- Migration 096: per-tenant, customer-defined spotlight buckets (greenfield).
-- Replaces the fixed global bucket taxonomy (mig 081 spotlight_bucket_scores) — a
-- bucket is now a CUSTOMER-owned "atomized-bounded contextual reference" that ranks
-- the tenant's LOCAL pipeline (tenant_opportunity_cards) on demand. RLS-native.
--
-- Signals live in `criteria` JSONB (weights per signal): keywords, naics[],
-- program_types[], agencies[], set_asides[] (accessibility, optional), tech_focus,
-- trl_band, include_closed. Any bucket registers at any time and ranks the whole
-- available universe immediately (the cards are already local).
--
-- RETIREMENT of the global buckets (drop spotlight_bucket_scores + score_tenants
-- bucket scoring + the old spotlight read) is a follow-on cutover once the new
-- bucket UI reads these tables — not dropped here so the running app keeps working.

CREATE TABLE IF NOT EXISTS tenant_spotlight_buckets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    description TEXT,
    criteria    JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tsb_tenant ON tenant_spotlight_buckets (tenant_id) WHERE is_active;
DROP TRIGGER IF EXISTS tsb_updated ON tenant_spotlight_buckets;
CREATE TRIGGER tsb_updated BEFORE UPDATE ON tenant_spotlight_buckets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_spotlight_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_spotlight_buckets FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_spotlight_buckets;
CREATE POLICY tenant_isolation ON tenant_spotlight_buckets
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_spotlight_buckets TO govtech_app;

-- Per-(tenant × bucket × card) score, computed on demand against the local pipeline.
CREATE TABLE IF NOT EXISTS tenant_bucket_scores (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id),
    bucket_id      UUID NOT NULL REFERENCES tenant_spotlight_buckets(id) ON DELETE CASCADE,
    opportunity_id UUID NOT NULL,
    score          INT  NOT NULL DEFAULT 0,
    factors        JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, bucket_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_tbs_tenant_bucket_score
    ON tenant_bucket_scores (tenant_id, bucket_id, score DESC);

ALTER TABLE tenant_bucket_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_bucket_scores FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_bucket_scores;
CREATE POLICY tenant_isolation ON tenant_bucket_scores
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_bucket_scores TO govtech_app;
