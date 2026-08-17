-- Migration 182: master OPP build-out completion flag.
--
-- Canonical: docs/PROVISIONING_WORKSPACE_DESIGN.md. The explicit "this master OPP is fully built out
-- (compliance + volumes + required items) and provision-ready" signal — set by the rfp_admin
-- "Mark build-out complete" action (PV-2). Completes the documented two-release model's
-- proposal-ready-on-completion signal (docs/MASTER_MIRROR_OPP_DESIGN.md — previously marked ⚠ not-built):
--   (a) enables the purchase demand-gate reuse fast-track for a 2nd+ buyer of an already-built OPP, and
--   (b) feeds the mirror card's provision-ready badge on the completion re-publish.
-- The readiness BAR itself (compliance + >=1 volume + >=1 required item) is computed in
-- frontend/lib/provisioning/readiness.ts; this flag records the admin's deliberate "done" decision.
-- Idempotent + guarded; nothing here rewrites data.

ALTER TABLE curated_solicitations ADD COLUMN IF NOT EXISTS build_complete     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE curated_solicitations ADD COLUMN IF NOT EXISTS build_completed_at  TIMESTAMPTZ;
ALTER TABLE curated_solicitations ADD COLUMN IF NOT EXISTS build_completed_by  UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_curated_solicitations_build_complete
  ON curated_solicitations(build_complete) WHERE build_complete;
