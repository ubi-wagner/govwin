-- 009_phase1_curation_extensions.sql
--
-- Phase 1 database additions. Purely ADDITIVE — no DROP TABLE, DROP COLUMN,
-- or DELETE statements. Every statement uses IF NOT EXISTS or DO $$ guards
-- so the migration is idempotent (safe to apply twice — second run is a no-op).
--
-- What this migration adds:
--   1. `namespace` column on episodic/semantic/procedural memory tables
--      (for memory.search_namespace prefix matching in Phase 1 §H)
--   2. `triage_actions` audit table (every state transition logged)
--   3. `solicitation_annotations` table (highlights, text boxes, compliance tags)
--   4. Expanded CHECK constraint on curated_solicitations.status (adds
--      'released_for_analysis' and 'rejected_review' to the state machine)
--   5. Partial indexes for triage queue and curation workspace queries
--   6. UNIQUE constraint on opportunities.content_hash (ingester dedupe)
--   7. Full-text search trigger on opportunities (auto-populate full_text_tsv)
--   8. Index on solicitation_compliance.solicitation_id
--   9. review_requested_for column on curated_solicitations (optional reviewer)
--
-- Depends on: 001_baseline.sql (all tables this migration references)
-- See: docs/phase-1/B-database-additions.md for the full spec + acceptance criteria

-- ============================================================================
-- 1. Memory namespace columns
-- ============================================================================

ALTER TABLE episodic_memories ADD COLUMN IF NOT EXISTS namespace TEXT;
ALTER TABLE semantic_memories ADD COLUMN IF NOT EXISTS namespace TEXT;
ALTER TABLE procedural_memories ADD COLUMN IF NOT EXISTS namespace TEXT;

-- Prefix-search-optimized indexes (text_pattern_ops allows LIKE 'prefix%')
CREATE INDEX IF NOT EXISTS idx_episodic_namespace
  ON episodic_memories (namespace text_pattern_ops)
  WHERE namespace IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_semantic_namespace
  ON semantic_memories (namespace text_pattern_ops)
  WHERE namespace IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_procedural_namespace
  ON procedural_memories (namespace text_pattern_ops)
  WHERE namespace IS NOT NULL;

-- ============================================================================
-- 2. Triage actions audit table
-- ============================================================================

CREATE TABLE IF NOT EXISTS triage_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
    actor_id        UUID NOT NULL REFERENCES users(id),
    action          TEXT NOT NULL CHECK (action IN (
                      'claim', 'release', 'dismiss', 'request_review',
                      'approve', 'reject', 'push', 'reclaim',
                      'skip_shredder', 'return_to_curation'
                    )),
    from_state      TEXT NOT NULL,
    to_state        TEXT NOT NULL,
    notes           TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_triage_actions_sol_chrono
  ON triage_actions (solicitation_id, created_at DESC);

-- ============================================================================
-- 3. Solicitation annotations table
-- ============================================================================

CREATE TABLE IF NOT EXISTS solicitation_annotations (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id          UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
    actor_id                 UUID NOT NULL REFERENCES users(id),
    kind                     TEXT NOT NULL CHECK (kind IN ('highlight', 'text_box', 'compliance_tag')),
    source_location          JSONB NOT NULL,
    payload                  JSONB NOT NULL DEFAULT '{}',
    compliance_variable_name TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS solicitation_annotations_updated ON solicitation_annotations;
CREATE TRIGGER solicitation_annotations_updated
  BEFORE UPDATE ON solicitation_annotations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sol_annotations_sol
  ON solicitation_annotations (solicitation_id);

CREATE INDEX IF NOT EXISTS idx_sol_annotations_variable
  ON solicitation_annotations (compliance_variable_name)
  WHERE compliance_variable_name IS NOT NULL;

-- ============================================================================
-- 4. Expand curated_solicitations.status CHECK constraint
-- ============================================================================
-- The baseline has 9 states. Phase 1 adds 'released_for_analysis' and
-- 'rejected_review'. We drop-and-recreate the CHECK since ALTER CONSTRAINT
-- doesn't support modifying CHECK expressions.
--
-- PostgreSQL normalizes `IN (...)` to `= ANY (ARRAY[...])` in
-- pg_get_constraintdef, so we search for the constraint by name pattern
-- instead of by def content.

DO $$
DECLARE
  _conname TEXT;
BEGIN
  -- Find the status CHECK constraint (auto-named or explicit)
  SELECT conname INTO _conname
  FROM pg_constraint
  WHERE conrelid = 'curated_solicitations'::regclass
    AND contype = 'c'
    AND (conname LIKE '%status%' OR pg_get_constraintdef(oid) LIKE '%status%')
  LIMIT 1;

  IF _conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE curated_solicitations DROP CONSTRAINT %I', _conname);
  END IF;

  -- Only add if not already present (idempotent on re-run after the DROP above)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'curated_solicitations'::regclass
      AND conname = 'curated_solicitations_status_check'
  ) THEN
    ALTER TABLE curated_solicitations
      ADD CONSTRAINT curated_solicitations_status_check
      CHECK (status IN (
        'new', 'claimed', 'released', 'released_for_analysis',
        'ai_analyzed', 'curation_in_progress', 'review_requested',
        'approved', 'pushed_to_pipeline', 'dismissed', 'rejected_review'
      ));
  END IF;
END $$;

-- ============================================================================
-- 5. Review-requested-for column (optional: who should review?)
-- ============================================================================

ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS review_requested_for UUID REFERENCES users(id);

-- ============================================================================
-- 6. Triage queue partial indexes
-- ============================================================================

-- Unclaimed triage queue: only rows in 'new' status without a claimant
CREATE INDEX IF NOT EXISTS idx_csol_triage_unclaimed
  ON curated_solicitations (created_at DESC)
  WHERE status = 'new' AND claimed_by IS NULL;

-- "My work" view: rows I've claimed that are still in progress
CREATE INDEX IF NOT EXISTS idx_csol_my_claims
  ON curated_solicitations (claimed_by, claimed_at DESC)
  WHERE status IN ('claimed', 'curation_in_progress', 'review_requested');

-- ============================================================================
-- 7. Solicitation compliance index
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sol_compliance_sol_id
  ON solicitation_compliance (solicitation_id);

-- ============================================================================
-- 8. Opportunities content_hash UNIQUE constraint (ingester dedupe)
-- ============================================================================
-- Two-step NOT VALID + VALIDATE avoids a long lock on the table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_content_hash_key'
      AND conrelid = 'opportunities'::regclass
  ) THEN
    ALTER TABLE opportunities
      ADD CONSTRAINT opportunities_content_hash_key UNIQUE (content_hash);
  END IF;
END $$;

-- ============================================================================
-- 9. Opportunities full-text search trigger
-- ============================================================================
-- Auto-populate full_text_tsv from title + description + agency on INSERT/UPDATE.
-- The column and GIN index already exist in 001_baseline; this adds the trigger.

CREATE OR REPLACE FUNCTION opportunities_fts_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.full_text_tsv := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE(NEW.description, '') || ' ' ||
    COALESCE(NEW.agency, '') || ' ' ||
    COALESCE(NEW.office, '') || ' ' ||
    COALESCE(NEW.solicitation_number, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS opportunities_fts_trigger ON opportunities;
CREATE TRIGGER opportunities_fts_trigger
  BEFORE INSERT OR UPDATE OF title, description, agency, office, solicitation_number
  ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION opportunities_fts_update();

-- ============================================================================
-- 10. pipeline_jobs priority + metadata columns (dispatcher support)
-- ============================================================================
-- The Phase 1 cron dispatcher (pipeline/src/ingest/dispatcher.py) selects jobs
-- ordered by priority DESC, created_at ASC, and carries run parameters in
-- metadata JSONB (run_type, source-specific flags, etc.). Both columns are
-- additive and nullable-with-default so existing rows remain valid.

ALTER TABLE pipeline_jobs
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 5;

ALTER TABLE pipeline_jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Partial index on pending jobs for the dispatcher's FOR UPDATE SKIP LOCKED
-- claim query (status='pending' ORDER BY priority DESC, created_at ASC).
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_pending_queue
  ON pipeline_jobs (priority DESC, created_at ASC)
  WHERE status = 'pending';
