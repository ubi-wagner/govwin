-- 144_proposal_studio_phase.sql
-- Proposal Studio — the 3-phase (Draft → Refine → Compliance) gated draft workflow
-- (docs/PROPOSAL_STUDIO_DESIGN.md). Adds the orchestration state the Studio's phase state machine
-- reads/writes. Advisory-only: this is refinement-loop state, NOT a proposal stage/gate — the Studio
-- never locks or submits.
--
-- studio_phase        — which loop the proposal is in: draft | refine | compliance | complete (NULL = not started)
-- studio_phase_status — running (agents working) | awaiting_review (at the human gate) (NULL = not started)
-- studio_auto         — true when running the full doorbell auto-chain (all 3 loops, no human stop)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS studio_phase text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS studio_phase_status text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS studio_auto boolean NOT NULL DEFAULT false;

-- Guardrails so the state machine can only hold valid values (NULL allowed = not started).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_studio_phase_check') THEN
    ALTER TABLE proposals ADD CONSTRAINT proposals_studio_phase_check
      CHECK (studio_phase IS NULL OR studio_phase IN ('draft','refine','compliance','complete'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_studio_phase_status_check') THEN
    ALTER TABLE proposals ADD CONSTRAINT proposals_studio_phase_status_check
      CHECK (studio_phase_status IS NULL OR studio_phase_status IN ('running','awaiting_review'));
  END IF;
END $$;
