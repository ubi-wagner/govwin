-- 139_proposal_voice.sql
-- Voice of Proposal (Proposal Draft Manager, P1) — additive, DORMANT, no-op when unset.
--
-- Adds a nullable `voice` parameter to proposals: a per-proposal register threaded into every
-- narrative drafting/regen prompt (section_drafter, and the manager/regen paths later). It is a
-- JSON list OR weighting over six tokens — passive, persuasive, technical, commercial, research,
-- development — e.g. ["technical","persuasive"] or {"technical":0.7,"commercial":0.3}. Cost/spec
-- artifacts ignore it; narrative artifacts consume it.
--
-- Inert by construction: DEFAULT NULL, nullable. Existing rows and existing drafting behaviour are
-- unchanged (the prompt threading is guarded to a byte-identical no-op when voice IS NULL). No FK,
-- no CHECK (the token set is validated in application code so future tokens need no migration), no
-- backfill. Reversible: `ALTER TABLE proposals DROP COLUMN IF EXISTS voice;`.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS voice jsonb;

COMMENT ON COLUMN proposals.voice IS
  'Voice of Proposal (mig 139): nullable JSON list/weighting over {passive,persuasive,technical,commercial,research,development}, threaded into narrative drafting/regen prompts. NULL (default) = no register applied (no-op).';
