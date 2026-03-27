-- =============================================================================
-- Migration 027 — Library Feedback Loop: Harvest, Provenance, Confidence,
--                  Dedup/Merge, and Learning Metrics
-- =============================================================================
-- Closes the loop: proposals feed refined content BACK into library_units.
--
-- Flow:
--   1. Proposal section finalized (approved/locked/submitted)
--   2. Harvest job atomizes final content → new library_units
--   3. Dedup check: if similar atom exists (cosine similarity > threshold),
--      version-chain via parent_unit_id instead of duplicating
--   4. Provenance recorded: atom knows it came from proposal X, section Y
--   5. When outcome reported (won/lost), confidence scores adjusted
--   6. Atoms from winning proposals get boosted, losing ones get noted
--   7. Learning metrics track harvest rates, reuse rates, win correlation
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LIBRARY HARVEST TRACKING
-- ─────────────────────────────────────────────────────────────────────────────
-- Prevents double-extraction and tracks the full provenance chain:
-- which proposal section produced which atoms, when, and how.

CREATE TABLE IF NOT EXISTS library_harvest_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  section_id          UUID NOT NULL REFERENCES proposal_sections(id) ON DELETE CASCADE,
  harvest_trigger     TEXT NOT NULL CHECK (harvest_trigger IN (
                        'section_approved','section_locked','proposal_submitted',
                        'proposal_won','manual','scheduled'
                      )),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','processing','completed','failed','skipped'
                      )),
  atoms_extracted     INTEGER NOT NULL DEFAULT 0,
  atoms_new           INTEGER NOT NULL DEFAULT 0,
  atoms_merged        INTEGER NOT NULL DEFAULT 0,
  atoms_skipped       INTEGER NOT NULL DEFAULT 0,
  source_word_count   INTEGER,
  source_content_hash TEXT,
  processing_model    TEXT,
  processing_time_ms  INTEGER,
  error_message       TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  UNIQUE(proposal_id, section_id, harvest_trigger)
);

CREATE INDEX IF NOT EXISTS idx_harvest_log_tenant
  ON library_harvest_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harvest_log_proposal
  ON library_harvest_log(proposal_id);
CREATE INDEX IF NOT EXISTS idx_harvest_log_status
  ON library_harvest_log(status) WHERE status IN ('pending','processing');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ATOM PROVENANCE — extend library_units
-- ─────────────────────────────────────────────────────────────────────────────
-- Track where each atom came from with richer provenance.
-- source_record_type + source_record_id already exist in library_units,
-- but we need more granular tracking for the feedback loop.

ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS source_proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_section_id UUID REFERENCES proposal_sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS harvest_log_id UUID REFERENCES library_harvest_log(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_type TEXT DEFAULT 'upload' CHECK (origin_type IN (
    'upload','proposal_harvest','manual_entry','import','ai_generated','merged'
  )),
  ADD COLUMN IF NOT EXISTS proposal_outcome TEXT CHECK (proposal_outcome IN (
    'won','lost','no_bid','pending','withdrawn'
  )),
  ADD COLUMN IF NOT EXISTS outcome_confidence_delta NUMERIC(5,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS similarity_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS merged_from_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS win_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loss_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reuse_effectiveness NUMERIC(5,3);

CREATE INDEX IF NOT EXISTS idx_library_units_proposal
  ON library_units(source_proposal_id) WHERE source_proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_units_origin
  ON library_units(tenant_id, origin_type);
CREATE INDEX IF NOT EXISTS idx_library_units_win_rate
  ON library_units(tenant_id, win_count DESC, loss_count)
  WHERE status = 'approved' AND (win_count + loss_count) > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ATOM SIMILARITY PAIRS (Dedup Support)
-- ─────────────────────────────────────────────────────────────────────────────
-- When a new atom is harvested, we compute cosine similarity against existing
-- atoms. If above threshold, record the pair for merge review or auto-merge.

CREATE TABLE IF NOT EXISTS library_atom_similarities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_a_id       UUID NOT NULL REFERENCES library_units(id) ON DELETE CASCADE,
  unit_b_id       UUID NOT NULL REFERENCES library_units(id) ON DELETE CASCADE,
  cosine_similarity NUMERIC(6,5) NOT NULL,
  merge_status    TEXT NOT NULL DEFAULT 'pending' CHECK (merge_status IN (
                    'pending','auto_merged','manually_merged',
                    'kept_separate','dismissed'
                  )),
  merged_into_id  UUID REFERENCES library_units(id) ON DELETE SET NULL,
  reviewed_by     TEXT REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(unit_a_id, unit_b_id),
  CHECK (unit_a_id < unit_b_id)
);

CREATE INDEX IF NOT EXISTS idx_similarities_tenant
  ON library_atom_similarities(tenant_id, cosine_similarity DESC);
CREATE INDEX IF NOT EXISTS idx_similarities_pending
  ON library_atom_similarities(tenant_id)
  WHERE merge_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_similarities_unit_a
  ON library_atom_similarities(unit_a_id);
CREATE INDEX IF NOT EXISTS idx_similarities_unit_b
  ON library_atom_similarities(unit_b_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. OUTCOME TRACKING — link proposals to atoms for win/loss scoring
-- ─────────────────────────────────────────────────────────────────────────────
-- When a proposal outcome is recorded, propagate to all atoms used in it.
-- This is the junction that powers "atoms from winning proposals."

CREATE TABLE IF NOT EXISTS library_atom_outcomes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id         UUID NOT NULL REFERENCES library_units(id) ON DELETE CASCADE,
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  section_id      UUID REFERENCES proposal_sections(id) ON DELETE SET NULL,
  usage_type      TEXT NOT NULL DEFAULT 'used' CHECK (usage_type IN (
                    'used','harvested','both'
                  )),
  outcome         TEXT CHECK (outcome IN ('won','lost','no_bid','pending','withdrawn')),
  confidence_delta NUMERIC(5,3) DEFAULT 0,
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(unit_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS idx_atom_outcomes_unit
  ON library_atom_outcomes(unit_id);
CREATE INDEX IF NOT EXISTS idx_atom_outcomes_proposal
  ON library_atom_outcomes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_atom_outcomes_outcome
  ON library_atom_outcomes(outcome) WHERE outcome IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. LEARNING METRICS (Aggregate Views)
-- ─────────────────────────────────────────────────────────────────────────────

-- Per-tenant library health: harvest rates, reuse, win correlation
CREATE OR REPLACE VIEW library_learning_metrics AS
SELECT
  lu.tenant_id,
  COUNT(*) AS total_atoms,
  COUNT(*) FILTER (WHERE lu.status = 'approved') AS approved_atoms,
  COUNT(*) FILTER (WHERE lu.origin_type = 'upload') AS atoms_from_uploads,
  COUNT(*) FILTER (WHERE lu.origin_type = 'proposal_harvest') AS atoms_from_proposals,
  COUNT(*) FILTER (WHERE lu.origin_type = 'merged') AS atoms_from_merges,
  COUNT(*) FILTER (WHERE lu.origin_type = 'manual_entry') AS atoms_manual,
  COUNT(*) FILTER (WHERE lu.win_count > 0) AS atoms_with_wins,
  COUNT(*) FILTER (WHERE lu.loss_count > 0) AS atoms_with_losses,
  COUNT(*) FILTER (WHERE lu.win_count > 0 AND lu.loss_count = 0) AS atoms_undefeated,
  SUM(lu.usage_count) AS total_reuses,
  AVG(lu.confidence_score) FILTER (WHERE lu.confidence_score IS NOT NULL) AS avg_confidence,
  AVG(lu.confidence_score) FILTER (WHERE lu.win_count > 0) AS avg_confidence_winners,
  AVG(lu.confidence_score) FILTER (WHERE lu.loss_count > 0 AND lu.win_count = 0) AS avg_confidence_losers,
  MAX(lu.created_at) AS last_atom_created,
  COUNT(*) FILTER (WHERE lu.created_at > NOW() - INTERVAL '30 days') AS atoms_last_30d,
  COUNT(*) FILTER (WHERE lu.embedding IS NOT NULL) AS vectorized_atoms
FROM library_units lu
GROUP BY lu.tenant_id;

-- Harvest pipeline status
CREATE OR REPLACE VIEW library_harvest_status AS
SELECT
  hl.tenant_id,
  COUNT(*) AS total_harvests,
  COUNT(*) FILTER (WHERE hl.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE hl.status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE hl.status = 'pending') AS pending,
  SUM(hl.atoms_extracted) AS total_atoms_extracted,
  SUM(hl.atoms_new) AS total_atoms_new,
  SUM(hl.atoms_merged) AS total_atoms_merged,
  SUM(hl.atoms_skipped) AS total_atoms_skipped,
  AVG(hl.processing_time_ms) FILTER (WHERE hl.status = 'completed') AS avg_processing_ms,
  MAX(hl.completed_at) AS last_harvest_at
FROM library_harvest_log hl
GROUP BY hl.tenant_id;

-- Atom effectiveness: which atoms correlate with wins?
CREATE OR REPLACE VIEW library_atom_effectiveness AS
SELECT
  lu.id AS unit_id,
  lu.tenant_id,
  lu.title,
  lu.category,
  lu.content_type,
  lu.confidence_score,
  lu.usage_count,
  lu.win_count,
  lu.loss_count,
  CASE
    WHEN (lu.win_count + lu.loss_count) = 0 THEN NULL
    ELSE ROUND(lu.win_count::NUMERIC / (lu.win_count + lu.loss_count), 3)
  END AS win_rate,
  lu.origin_type,
  lu.status,
  lu.word_count,
  lu.reuse_effectiveness,
  lu.created_at,
  lu.updated_at
FROM library_units lu
WHERE lu.status = 'approved'
  AND lu.usage_count > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. AUTOMATION RULES for Feedback Loop
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority) VALUES

-- Trigger harvest when a section is approved
('harvest_on_section_approved',
 'Queue atom harvest when a proposal section is approved by reviewer',
 'customer_events', '{proposal.section_approved}', '{}', 'queue_job',
 '{"job_type": "library_harvest", "worker": "grinder", "config": {"harvest_trigger": "section_approved", "extract_new_atoms": true, "check_dedup": true}}',
 30),

-- Trigger harvest when proposal is submitted
('harvest_on_proposal_submitted',
 'Queue full-proposal atom harvest when proposal is submitted to agency',
 'customer_events', '{proposal.stage_changed}',
 '{"payload.to_stage": {"$eq": "submitted"}}',
 'queue_job',
 '{"job_type": "library_harvest_full", "worker": "grinder", "config": {"harvest_trigger": "proposal_submitted", "harvest_all_sections": true, "skip_already_harvested": true}}',
 25),

-- When outcome is recorded, propagate to atoms
('outcome_propagation',
 'Propagate proposal outcome (won/lost) to all atoms used in or harvested from this proposal',
 'customer_events', '{proposal.outcome_recorded}',
 '{}', 'queue_job',
 '{"job_type": "outcome_propagation", "worker": "grinder", "config": {"boost_winners": true, "confidence_win_delta": 0.05, "confidence_loss_delta": -0.02}}',
 20),

-- Log atom harvest completion
('harvest_completed_log',
 'Log harvest results for pipeline monitoring',
 'customer_events', '{library.harvest_completed}', '{}', 'log_only',
 '{"message_template": "Harvest completed for proposal {refs.proposal_id}: {payload.atoms_new} new, {payload.atoms_merged} merged, {payload.atoms_skipped} skipped"}',
 80),

-- Notify when high-similarity duplicates found
('dedup_review_notify',
 'Notify tenant admin when potential duplicate atoms are found above similarity threshold',
 'customer_events', '{library.duplicates_found}',
 '{"payload.pair_count": {"$gte": 1}}',
 'queue_notification',
 '{"notification_type": "library_dedup_review", "subject_template": "{payload.pair_count} potential duplicate atoms found — review needed", "priority": 3}',
 50),

-- When a proposal is won, boost all its atoms
('win_celebration_log',
 'Log winning proposal for analytics — atoms from this proposal become proven',
 'customer_events', '{proposal.outcome_recorded}',
 '{"payload.outcome": {"$eq": "won"}}',
 'log_only',
 '{"message_template": "🏆 PROPOSAL WON: {payload.title} — {payload.atom_count} atoms marked as proven winners"}',
 15),

-- Auto-approve harvested atoms above confidence threshold
('harvest_auto_approve',
 'Auto-approve harvested atoms that come from approved sections with high AI confidence',
 'customer_events', '{library.atoms_extracted}',
 '{"payload.origin_type": {"$eq": "proposal_harvest"}, "payload.source_section_status": {"$eq": "approved"}}',
 'queue_job',
 '{"job_type": "library_auto_approve", "worker": "grinder", "config": {"min_confidence": 0.85, "require_approved_source": true}}',
 35)

ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. NEW EVENT TYPES — add to system awareness
-- ─────────────────────────────────────────────────────────────────────────────
-- These are handled by TypeScript types but also documented here for reference:
--
-- customer_events:
--   library.harvest_completed    — harvest job finished
--   library.duplicates_found     — dedup found similar atoms
--   proposal.section_approved    — section approved by reviewer
--   proposal.outcome_recorded    — win/loss/no_bid recorded
--   proposal.stage_changed       — (already exists, reused for submit trigger)

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. SYSTEM CONFIG — Feedback Loop Settings
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO system_config (key, value, description) VALUES
  ('library.harvest_on_approve',        '"true"',   'Auto-harvest atoms when section is approved'),
  ('library.harvest_on_submit',         '"true"',   'Full harvest when proposal is submitted'),
  ('library.dedup_similarity_threshold','"0.92"',   'Cosine similarity threshold for dedup flagging'),
  ('library.auto_merge_threshold',      '"0.97"',   'Cosine similarity threshold for auto-merge (no review needed)'),
  ('library.confidence_win_boost',      '"0.05"',   'Confidence score increase for atoms in winning proposals'),
  ('library.confidence_loss_penalty',   '"-0.02"',  'Confidence score decrease for atoms only in losing proposals'),
  ('library.harvest_model',             '"claude-haiku-4-5-20251001"', 'Model for atomizing proposal content'),
  ('library.min_harvest_word_count',    '"50"',     'Minimum word count for a section to trigger harvest'),
  ('library.max_atoms_per_section',     '"20"',     'Max atoms to extract from a single section'),
  ('library.auto_approve_harvested',    '"true"',   'Auto-approve harvested atoms from approved sections above confidence threshold')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PIPELINE SCHEDULE — Harvest & Dedup Workers
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO pipeline_schedules (name, schedule_cron, worker_type, config, is_active) VALUES
  ('library_harvester',     '*/15 * * * *', 'grinder',
   '{"job_type": "library_harvest", "batch_size": 10, "description": "Process pending harvest jobs"}',
   TRUE),
  ('library_dedup_scanner', '0 2 * * *', 'grinder',
   '{"job_type": "dedup_scan", "batch_size": 100, "description": "Nightly scan for similar atoms across tenant library"}',
   TRUE),
  ('outcome_propagator',    '*/30 * * * *', 'grinder',
   '{"job_type": "outcome_propagation", "batch_size": 5, "description": "Propagate proposal outcomes to atom confidence scores"}',
   TRUE)
ON CONFLICT (name) DO NOTHING;

COMMIT;
