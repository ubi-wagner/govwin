-- 175_scout_candidate_classification.sql
--
-- Completes the "potential NEW or UPDATED OPP" review→release queue on `scout_findings`
-- (SCOUT-INTAKE, task #176). A scout finding today dead-ends: crawler leads (mig 118) and the
-- HITL source-scout's extracted opportunities (mig 025 `source_diffs.extracted_opportunities`)
-- are DISCOVERED but there is no place to review them and RELEASE them into the RFP river, and
-- nothing decides whether a finding is a genuinely NEW opportunity (→ intake → curation → push)
-- or an UPDATE to one we already have (→ amendment / lifecycle fan-out).
--
-- This adds, to `scout_findings`, the deterministic NEW-vs-UPDATE CLASSIFICATION (the anchor
-- for the "ai_similar_to / ai_similarity_score" dedup the admins asked for, on the scout side)
-- plus the RELEASE OUTCOME, so `scout_findings` becomes the single reviewable queue an rfp_admin
-- works: classify → release-as-new | release-as-update | dismiss. Platform-scope (no tenant_id),
-- forward-only, purely additive + idempotent.

ALTER TABLE scout_findings
  -- NEW-vs-UPDATE verdict from lib/scout/classify.ts (deterministic; the opportunity_scout
  -- agent's advisory `possible_update` flag rides on top of this, it does not replace it).
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'unknown'
    CHECK (classification IN ('new', 'update', 'unknown')),
  -- The existing opportunity this finding most likely UPDATES (null when NEW / unmatched).
  ADD COLUMN IF NOT EXISTS match_opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  -- 0..1 confidence of the match that drove the classification.
  ADD COLUMN IF NOT EXISTS similarity_score DOUBLE PRECISION,
  -- Human-readable reason ("same solicitation number AF241-001", "title 82% similar + same agency").
  ADD COLUMN IF NOT EXISTS match_reason TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ,
  -- Release outcome. released_ref = the intake opportunity_id (new) OR the amendment_id (update).
  ADD COLUMN IF NOT EXISTS released_kind TEXT CHECK (released_kind IN ('new', 'update')),
  ADD COLUMN IF NOT EXISTS released_ref UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- The review queue reads by (purpose, status, classification), newest first.
CREATE INDEX IF NOT EXISTS scout_findings_classification_idx
  ON scout_findings (purpose, status, classification, discovered_at DESC);
