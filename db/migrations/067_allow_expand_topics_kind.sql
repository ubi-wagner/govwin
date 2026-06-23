-- =============================================================================
-- Migration 067: allow pipeline_jobs.kind = 'expand_topics'
-- -----------------------------------------------------------------------------
-- Milestone 3 adds on-demand topic expansion: the admin "Import all topics from
-- source" route enqueues a pipeline_jobs row with kind='expand_topics', and the
-- dispatcher (ingest/dispatcher.py :: _run_expand_topics_job) routes it to the
-- topic_expander. The pipeline_jobs_kind_check CHECK constraint (last set in 040)
-- did not include 'expand_topics', so those INSERTs would violate the constraint.
-- Extend the allowed set. Idempotent (drop-if-exists + re-add). Mirrors 026/040.
-- =============================================================================

ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_kind_check
  CHECK (kind IN ('ingest', 'shred_solicitation', 'scout_source', 'draft_section', 'review_section', 'expand_topics'));
