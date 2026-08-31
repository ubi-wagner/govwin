-- 236_milestone_gate_closer.sql
--
-- Who closes a milestone's gate: a person, or the AI manager (A4).
--
-- ── THE RULE THE PROPOSAL SIDE ALREADY LOCKED ────────────────────────────────────────────────
-- docs/TENANT_WORKFLOW_SETUP_DESIGN.md §8.1, owner-confirmed:
--
--   "Gate closer is per-stage: HUMAN (HITL) or AI-MANAGER — dates are a soft deadline/nudge
--    overlay on both, never a blind auto-advance. Advancement is always gated on *real completion*
--    … never on a clock alone."
--
-- This is that rule, one capability over. A milestone declares who closes it, and the choice
-- changes WHO PRESSES THE BUTTON — never what the button is allowed to do.
--
-- ── WHY THIS COLUMN CANNOT WEAKEN ANYTHING ───────────────────────────────────────────────────
-- `markMilestoneMet` already refuses on TASKS_OUTSTANDING and DELIVERABLES_OUTSTANDING, and the
-- auto-closer calls THAT FUNCTION rather than writing a status itself. So the agent's reach is
-- strictly a subset of a person's: it can close only what a tenant_admin could have closed at that
-- moment, and it additionally requires its own assessment to be clean.
--
-- A human can close a milestone the agent would not. The agent can never close one a human could
-- not. That asymmetry is the whole safety argument, and it holds because there is ONE writer.
--
-- ── DEFAULT 'human', AND NOT NEGOTIABLE BY OMISSION ──────────────────────────────────────────
-- Every existing milestone, and every one created without saying otherwise, is closed by a person.
-- A capability that switched itself on for rows written before it existed would be deciding
-- something on the customer's behalf that they were never asked about.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS gate_closer text NOT NULL DEFAULT 'human'
    CHECK (gate_closer IN ('human', 'ai_manager'));

COMMENT ON COLUMN project_milestones.gate_closer IS
  'Who closes this phase: a person (default) or the AI manager. It changes who presses the button, '
  'never what the button may do — the auto-closer calls markMilestoneMet, which refuses on open '
  'tasks and unaccepted deliverables exactly as it does for a human. The agent''s reach is a strict '
  'SUBSET of a person''s.';

-- Only the ai_manager rows are ever swept, so the index carries the predicate.
CREATE INDEX IF NOT EXISTS idx_project_milestones_ai_gated
  ON project_milestones (project_id) WHERE gate_closer = 'ai_manager' AND status = 'pending';
