-- Migration 019: Consent & Legal Agreement Tracking
-- Tracks all user consents (ToS, privacy, authority representation) with
-- version history and audit trail. Designed for regulatory compliance and
-- audit readiness — every consent is immutable and timestamped.

-- ─── Consent Records (append-only, immutable) ───────────────────────
-- Each row = one consent action. Never updated, never deleted.
-- Query latest per user+document_type for current acceptance status.
CREATE TABLE IF NOT EXISTS consent_records (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,

    -- What they consented to
    document_type   TEXT NOT NULL,           -- 'terms_of_service', 'privacy_policy', 'acceptable_use', 'ai_disclosure', 'authority_representation', 'document_approval'
    document_version TEXT NOT NULL,          -- e.g. '2026-03-25-v1'

    -- The consent itself
    action          TEXT NOT NULL DEFAULT 'accept',  -- 'accept', 'decline', 'revoke'

    -- Context: what were they consenting to specifically?
    summary         TEXT,                    -- Human-readable: "Accepted Terms of Service v2026-03-25"

    -- For document/proposal approvals: what entity was approved
    entity_type     TEXT,                    -- 'proposal', 'capability_statement', 'past_performance', etc.
    entity_id       TEXT,                    -- FK to the specific document/resource

    -- Provenance
    ip_address      TEXT,
    user_agent      TEXT,

    -- Immutable timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookups: "has this user accepted the current ToS?"
CREATE INDEX IF NOT EXISTS idx_consent_user_doctype
    ON consent_records (user_id, document_type, created_at DESC);

-- Audit queries: "all consents for a tenant"
CREATE INDEX IF NOT EXISTS idx_consent_tenant
    ON consent_records (tenant_id, created_at DESC);

-- Document approval queries: "who approved this proposal?"
CREATE INDEX IF NOT EXISTS idx_consent_entity
    ON consent_records (entity_type, entity_id, created_at DESC)
    WHERE entity_type IS NOT NULL;


-- ─── Legal Document Versions ────────────────────────────────────────
-- Tracks which version of each legal doc is "current" so we can detect
-- when a user needs to re-accept after a policy update.
CREATE TABLE IF NOT EXISTS legal_document_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type   TEXT NOT NULL,           -- matches consent_records.document_type
    version         TEXT NOT NULL,           -- '2026-03-25-v1'
    effective_date  DATE NOT NULL,
    summary_of_changes TEXT,                 -- "Added AI disclosure section"
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (document_type, version)
);

-- Only one current version per document type
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_doc_current
    ON legal_document_versions (document_type)
    WHERE is_current = TRUE;


-- ─── Add consent tracking columns to users table ────────────────────
-- These are denormalized for fast middleware checks (avoid DB round-trip
-- on every request). Source of truth remains consent_records.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS terms_accepted_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS terms_version            TEXT,
    ADD COLUMN IF NOT EXISTS privacy_accepted_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS authority_confirmed_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consent_required         BOOLEAN DEFAULT FALSE;
-- consent_required = TRUE means user must accept terms before proceeding
-- Set to TRUE when legal docs are updated and user hasn't re-accepted


-- ─── Seed initial legal document versions ───────────────────────────
INSERT INTO legal_document_versions (document_type, version, effective_date, summary_of_changes, is_current)
VALUES
    ('terms_of_service',        '2026-03-25-v1', '2026-03-25', 'Initial Terms of Service', TRUE),
    ('privacy_policy',          '2026-03-25-v1', '2026-03-25', 'Initial Privacy Policy', TRUE),
    ('acceptable_use',          '2026-03-25-v1', '2026-03-25', 'Initial Acceptable Use Policy', TRUE),
    ('ai_disclosure',           '2026-03-25-v1', '2026-03-25', 'Initial AI/LLM Disclosure', TRUE),
    ('authority_representation','2026-03-25-v1', '2026-03-25', 'Initial Authority Representation', TRUE)
ON CONFLICT (document_type, version) DO NOTHING;
