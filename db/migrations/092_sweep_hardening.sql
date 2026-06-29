-- Migration 092: hardening from the hidden-bug sweep (indexes + latent traps).
-- All additive / idempotent; no data change.

-- ── Missing per-proposal indexes ──────────────────────────────────────────
-- These children are ALL queried per-proposal on every workspace open AND cascade
-- (ON DELETE CASCADE from proposals); without a leading proposal_id index each is a
-- seq-scan. (proposal_compliance_matrix.proposal_id is on the card read-model path.)
CREATE INDEX IF NOT EXISTS idx_proposal_comments_proposal
    ON proposal_comments (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_compliance_matrix_proposal
    ON proposal_compliance_matrix (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_compliance_matrix_proposal_section
    ON proposal_compliance_matrix (proposal_id, section_id);
CREATE INDEX IF NOT EXISTS idx_proposal_reviews_proposal
    ON proposal_reviews (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_stage_history_proposal
    ON proposal_stage_history (proposal_id);

-- Supports the duplicate-proposal guard + the FK lookup (the create route filters
-- (tenant_id, opportunity_id)). NOT unique: a unique constraint would need a dedupe
-- pass first (existing dup rows would fail it). The app-level guard remains; the
-- residual create race is documented in the gap report.
CREATE INDEX IF NOT EXISTS idx_proposals_tenant_opportunity
    ON proposals (tenant_id, opportunity_id);

-- ── proposals.stage DEFAULT 'outline' is NOT in proposals_stage_check ──────
-- (the CHECK is {draft,review,final,submitted,archived}). Every INSERT specifies
-- stage so it's latent, but any future insert omitting stage would throw. Point the
-- default at a valid value.
ALTER TABLE proposals ALTER COLUMN stage SET DEFAULT 'draft';

-- ── Drop a redundant duplicate index on canvas_versions ───────────────────
-- idx_canvas_versions_section (017/030a) and idx_cv_section_version (045) are
-- byte-identical (section_id, version_number DESC); the UNIQUE key also covers the
-- prefix. Drop one to cut write amplification.
DROP INDEX IF EXISTS idx_cv_section_version;
