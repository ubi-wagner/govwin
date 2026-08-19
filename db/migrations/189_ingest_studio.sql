-- 189_ingest_studio.sql
--
-- THE INGEST STUDIO — a staged compliance matrix and a phase state machine.
-- Canonical design: docs/INGEST_STUDIO_DESIGN.md.
--
-- WHY. `materializeSkeleton` parses a solicitation and, in the same call, WRITES
-- solicitation_compliance and every volume + section mold. That breaks the one rule
-- docs/AGENT_WORKFORCE.md calls non-negotiable — *advisory → guardrail → land-or-review; agent
-- output NEVER auto-writes a business table* — at the single most consequential table we own. A
-- customer builds a submission against the compliance matrix and is rejected if it is wrong.
--
-- It also fuses two different jobs with different failure modes: READING rules out of a document,
-- and AUTHORING molds from those rules. Fused, a misread page limit silently becomes a wrong mold
-- and nobody can tell which step was at fault.
--
-- So: the matrix is STAGED here, reviewed (including an adversarial pass that can now actually
-- check its work, because every extracted value carries its citation — mig 187/188), and LANDED
-- as a separate, reviewed act. Molds are authored afterwards, by a separate manager, reading only
-- a LANDED matrix.

-- ── 1. Phase state ───────────────────────────────────────────────────────────
-- Same idiom as proposals.studio_phase (mig 144). 'not_started' for every existing row: they
-- predate the Studio and their matrices were landed the old way; the phase machine only governs
-- runs that start after this migration.
ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS ingest_phase text NOT NULL DEFAULT 'not_started';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curated_solicitations_ingest_phase_check'
  ) THEN
    ALTER TABLE curated_solicitations
      ADD CONSTRAINT curated_solicitations_ingest_phase_check
      CHECK (ingest_phase IN ('not_started','extract','matrix','review','landed','molds','complete'));
  END IF;
END $$;

COMMENT ON COLUMN curated_solicitations.ingest_phase IS
  'Ingest Studio phase: not_started → extract → matrix → review → landed → molds → complete. '
  'The gate between "matrix" and "landed" is where a staged compliance matrix is reviewed '
  '(adversarially) and promoted. See docs/INGEST_STUDIO_DESIGN.md.';

-- ── 2. The staged matrix ─────────────────────────────────────────────────────
-- A PROPOSAL, not a fact. Inspectable, supersedable, and invisible to every tenant until landed.
-- Immutable once landed: re-running a phase supersedes the prior draft rather than mutating it,
-- so "what did we propose, what did the reviewers say, what did we land" stays answerable.
CREATE TABLE IF NOT EXISTS solicitation_compliance_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitation_id   uuid NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,

  -- The whole ParsedSolicitation as staged (compliance + volumes + topics). Landing reads this.
  parsed            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Per-field provenance in the SAME shape as solicitation_compliance.field_provenance (mig
  -- 187/188), so landing is a copy, not a translation — and a reviewer sees exactly what a
  -- curator will see.
  field_provenance  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- auditProvenance() at staging time: read/defaulted/deferred counts, unresolved deferrals,
  -- findings. The deterministic evidence the adversarial cohort reasons OVER (never guesses).
  audit             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The adversarial verdict once phase 3 runs: lenses, per-value challenges, reconciliation.
  -- Advisory — its presence never authorizes a land, a human or an explicit policy does.
  review            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The admin's comment threaded into the phase's agents as `guidance` on a regenerate.
  guidance          text,

  status            text NOT NULL DEFAULT 'staged'
                    CHECK (status IN ('staged','reviewed','landed','superseded','rejected')),
  -- Which phase produced this draft, for the audit trail.
  phase             text NOT NULL DEFAULT 'matrix'
                    CHECK (phase IN ('extract','matrix','review')),

  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  landed_at         timestamptz,
  landed_by         uuid REFERENCES users(id) ON DELETE SET NULL
);

-- The live draft per solicitation is the newest non-superseded one.
CREATE INDEX IF NOT EXISTS idx_compliance_drafts_sol
  ON solicitation_compliance_drafts (solicitation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_drafts_open
  ON solicitation_compliance_drafts (solicitation_id, status)
  WHERE status IN ('staged','reviewed');

COMMENT ON TABLE solicitation_compliance_drafts IS
  'STAGED compliance matrices awaiting review + landing (Ingest Studio, docs/INGEST_STUDIO_DESIGN.md). '
  'A draft has NO effect on any tenant. solicitation_compliance is written by the LAND step alone — '
  'no agent, no parse and no route writes it directly. Drafts are superseded, never mutated, so the '
  'proposal/verdict/landing history survives.';

COMMENT ON COLUMN solicitation_compliance_drafts.review IS
  'Adversarial verdict from the review phase: per-lens challenges to the staged values (each '
  'checkable against the citation the extractor recorded) plus the reconciled outcome. ADVISORY — '
  'it never lands anything by itself.';

-- ── 3. Platform scope ────────────────────────────────────────────────────────
-- Master-side curation data, like curated_solicitations itself: no tenant_id, reached only
-- through rfp_admin surfaces on the owner connection (docs/RLS_CUTOVER.md). Deliberately NOT
-- RLS-forced — there is no tenant to scope it to, and a tenant-equality policy would make it
-- unreachable rather than safe.
