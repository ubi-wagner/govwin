-- 223_project_reviews.sql
--
-- Somebody looked at this and said no, because X.
--
-- ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────────────────
-- A project deliverable was either ACCEPTED or silently not. There was no way to record that a
-- person read it and found it wrong, and no way to say why — so the rejection happened in a meeting
-- or an email, and the row kept looking like something nobody had got round to. "Not yet accepted"
-- and "rejected, for these reasons" are different states and only one of them tells the next person
-- what to do.
--
-- Rejection is therefore FIRST-CLASS here, and carries text the database insists on.
--
-- ── APPROVING IS NOT ACCEPTING ───────────────────────────────────────────────────────────────
-- The same separation this whole module runs on. Uploading a file is not accepting it; authoring a
-- document is not accepting it; and a reviewer approving is not accepting either. A review says an
-- internal reader is satisfied. `accepted_at` says the obligation is met — a different claim, made
-- by a tenant_admin, and the one that closes a CLIN.
--
-- What the review DOES do is gate that act: an open review blocks acceptance (it is still being
-- looked at) and a rejected one blocks it until a fresh review supersedes it. That is the loop —
-- reject → fix → re-request → approve → accept — and it is backwards-compatible, because a
-- deliverable nobody ever sent for review is accepted exactly as it was before.
--
-- ── ONE PENDING REVIEW PER THING ─────────────────────────────────────────────────────────────
-- Enforced by a partial unique index rather than by convention. Three open reviews on one
-- deliverable is three people believing they are the decider, and a gate that cannot say which
-- answer counts is not a gate.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

CREATE TABLE IF NOT EXISTS project_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Polymorphic, like `project_comments` and the platform `tasks` table. `document` is here for the
  -- status report (P1) and `milestone` for a phase gate; neither exists yet, and adding them later
  -- would be a CHECK change on a table with rows, which is the more expensive moment to do it.
  entity_type       text NOT NULL,
  entity_id         uuid NOT NULL,

  requested_by      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A person or a role, never both — the same alternation `project_milestone_tasks` uses, so the
  -- ToDo projection has one place to look when it decides where this lands.
  reviewer_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewer_role     text,
  note              text,              -- what to look at
  due_on            date,

  status            text NOT NULL DEFAULT 'pending',
  decided_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  -- REQUIRED on a rejection. A "no" with no reason is the thing this table exists to stop.
  reason            text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_reviews_entity_type_check
    CHECK (entity_type IN ('deliverable', 'document', 'milestone')),

  CONSTRAINT project_reviews_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),

  -- A decided review has a moment it was decided; a pending one does not. Withdrawal counts as a
  -- decision — somebody chose to stop it, and that is worth a timestamp too.
  CONSTRAINT project_reviews_decided_pair
    CHECK ((status = 'pending') = (decided_at IS NULL)),

  -- The whole point.
  CONSTRAINT project_reviews_rejection_has_reason
    CHECK (status <> 'rejected' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),

  -- Somebody has to be asked. A review addressed to nobody sits forever looking like work in hand.
  CONSTRAINT project_reviews_has_reviewer
    CHECK (reviewer_user_id IS NOT NULL OR reviewer_role IS NOT NULL),

  CONSTRAINT project_reviews_note_len CHECK (note IS NULL OR length(note) <= 4000),
  CONSTRAINT project_reviews_reason_len CHECK (reason IS NULL OR length(reason) <= 4000)
);

-- ONE pending review per thing. Without this, three people each believe they are the decider.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_reviews_one_pending
  ON project_reviews (entity_type, entity_id)
  WHERE status = 'pending';

-- The read the acceptance gate performs: "what is the latest review on this?"
CREATE INDEX IF NOT EXISTS idx_project_reviews_entity
  ON project_reviews (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_reviews_project
  ON project_reviews (project_id, status);

COMMENT ON TABLE project_reviews IS
  'Internal review of a project deliverable, document or milestone. Approving is NOT accepting: a '
  'review gates the tenant_admin''s acceptance, it does not perform it. One pending review per '
  'entity, enforced by a partial unique index. A rejection must carry a reason.';

COMMENT ON COLUMN project_reviews.reason IS
  'Required on rejection (CHECK). "Not yet accepted" and "rejected, for these reasons" are '
  'different states and only one tells the next person what to do.';

-- RLS, forced, matching every other project table (migs 216 · 218 · 221 · 222).
ALTER TABLE project_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_reviews;
CREATE POLICY tenant_isolation_select ON project_reviews FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_reviews;
CREATE POLICY tenant_isolation_insert ON project_reviews FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_reviews;
CREATE POLICY tenant_isolation_update ON project_reviews FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_reviews;
CREATE POLICY tenant_isolation_delete ON project_reviews FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_reviews TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_reviews TO rfp_agent;
