-- Migration 089: persisted forward-carried origin card (R0.3).
--
-- The card's IMMUTABLE origin layer (L0 opp summary + L1 bucket), frozen at
-- purchase so a later master edit/close/amendment does not rewrite the project's
-- audit. Deliberately does NOT freeze the compliance matrix — that renders LIVE
-- from proposal_compliance_matrix (the section gate enforces the live matrix; a
-- frozen copy would understate the burden after an amendment — 3-factor review
-- flaw #7). Only truly-immutable fields belong here.
--   origin_card  : { opportunity:{id,title,agency,program_type}, summary,
--                    bucket:{key,score,rationale}, doc_refs:[{label,type}],
--                    frozen_at }
--   source_bucket: the spotlight bucket the opportunity was bought from (lineage).

ALTER TABLE proposals
    ADD COLUMN IF NOT EXISTS origin_card   JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS source_bucket TEXT;
