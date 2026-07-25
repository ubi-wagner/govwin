-- Migration 133: library_seed_jobs (was authored as 128 on a parallel branch; renumbered)
-- Tracks the two-phase AI-assisted "seed from prior proposal" flow that
-- fires on provision.  The suggester agent writes candidate_proposals;
-- after admin selection the mapper writes section_mapping; admin
-- decisions land in section_decisions; apply writes to proposal_sections.

CREATE TABLE IF NOT EXISTS library_seed_jobs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal_id         UUID        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'analyzing'
    CHECK (status IN (
      'analyzing',          -- suggester running
      'awaiting_selection', -- candidate list ready; waiting for admin pick
      'mapping',            -- mapper running
      'awaiting_review',    -- section+atom mapping ready for admin review
      'applied',            -- mapping applied to proposal_sections
      'skipped'             -- admin chose not to seed
    )),
  -- Suggester output: ranked prior proposals with per-section scores
  candidate_proposals JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Admin selection
  source_proposal_id  UUID        REFERENCES proposals(id),
  -- Mapper output: target_section_id → {source_section, atoms}
  section_mapping     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Admin overrides: target_section_id → {atom_id → 'reuse'|'regen'|'skip'}
  section_decisions   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_seed_jobs_proposal
  ON library_seed_jobs(proposal_id);
CREATE INDEX IF NOT EXISTS idx_library_seed_jobs_tenant_status
  ON library_seed_jobs(tenant_id, status);

-- Only one active (non-applied/skipped) job per proposal at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_seed_jobs_active
  ON library_seed_jobs(proposal_id)
  WHERE status NOT IN ('applied', 'skipped');
