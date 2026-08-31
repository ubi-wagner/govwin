-- 225_project_risks.sql
--
-- The register every program review asks for and nothing here could answer.
--
-- ── A RISK AND AN ISSUE ARE ONE TABLE, DELIBERATELY ──────────────────────────────────────────
-- A risk is something that might happen; an issue is a risk that did. They carry the same fields,
-- the same owner, the same mitigation, and the same escalation path — and a risk becoming an issue
-- is the single most important transition in the register. Two tables would make that transition a
-- copy between them, which is where the history goes missing: the review asks "when did we know",
-- and a copied row cannot say.
--
-- So `kind` moves risk → issue in place, and `became_issue_at` records when. One row, one history.
--
-- ── PROBABILITY × IMPACT, AND WHY THE SCORE IS GENERATED ─────────────────────────────────────
-- Both are 1–5, and `score` is a GENERATED column. Storing a number somebody computed in the UI
-- means the day the formula changes, old rows keep the old answer and nothing says which is which.
-- Generated, it is always the product of the two facts beside it.
--
-- An ISSUE keeps its probability. It reads oddly — the thing has happened, so probability is 100% —
-- but the register's whole value in a review is "we scored this a 12 and it landed", and blanking
-- the field on transition destroys exactly that.
--
-- ── STATUS AND KIND ARE SEPARATE AXES ────────────────────────────────────────────────────────
-- A risk can be open or closed; an issue can be open or closed. Folding "closed" into `kind` would
-- make "closed risk" and "closed issue" the same state, and they are not: one was mitigated before
-- it happened, and the other was survived.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

CREATE TABLE IF NOT EXISTS project_risks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Optional anchor: a risk usually threatens a specific phase. NULL means the whole project.
  milestone_id     uuid REFERENCES project_milestones(id) ON DELETE SET NULL,

  title            text NOT NULL,
  detail           text,

  kind             text NOT NULL DEFAULT 'risk',
  status           text NOT NULL DEFAULT 'open',

  probability      smallint NOT NULL DEFAULT 3,
  impact           smallint NOT NULL DEFAULT 3,
  -- GENERATED, so it can never disagree with the two numbers beside it.
  score            smallint GENERATED ALWAYS AS (probability * impact) STORED,

  -- A risk with no owner is a risk nobody is watching. Nullable because a register is often
  -- populated in a meeting and assigned afterwards, but the UI asks for one.
  owner_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,

  mitigation       text,
  -- What we would do if it lands anyway. Different from mitigation, which is what stops it.
  contingency      text,

  review_on        date,             -- when to look at this again
  became_issue_at  timestamptz,      -- the transition a program review asks about
  closed_at        timestamptz,
  closed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_note      text,

  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_risks_kind_check   CHECK (kind IN ('risk', 'issue')),
  CONSTRAINT project_risks_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT project_risks_title_check  CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  CONSTRAINT project_risks_probability_range CHECK (probability BETWEEN 1 AND 5),
  CONSTRAINT project_risks_impact_range      CHECK (impact BETWEEN 1 AND 5),

  -- Closed is a fact with a time, or it has not happened — the same pairing as milestone
  -- completion, review decision and project close-out.
  CONSTRAINT project_risks_closed_pair CHECK ((status = 'closed') = (closed_at IS NOT NULL)),

  -- An issue is a risk that DID happen, so it has a moment it became one. A risk does not.
  CONSTRAINT project_risks_issue_pair CHECK ((kind = 'issue') = (became_issue_at IS NOT NULL))
);

-- The read the register performs: open items worst-first.
CREATE INDEX IF NOT EXISTS idx_project_risks_open
  ON project_risks (project_id, score DESC, created_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_project_risks_review
  ON project_risks (review_on)
  WHERE status = 'open' AND review_on IS NOT NULL;

COMMENT ON TABLE project_risks IS
  'Risk and issue register. ONE table: an issue is a risk that happened, and moving kind in place '
  'keeps the history a program review asks for ("when did we know?"), which a copy between two '
  'tables cannot. `score` is GENERATED from probability x impact so it can never go stale.';

COMMENT ON COLUMN project_risks.probability IS
  'Kept when a risk becomes an issue. It reads oddly — the thing happened — but "we scored this a '
  '12 and it landed" is the register''s whole value in a review.';

-- RLS, forced, matching every other project table.
ALTER TABLE project_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_risks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_risks;
CREATE POLICY tenant_isolation_select ON project_risks FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_risks;
CREATE POLICY tenant_isolation_insert ON project_risks FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_risks;
CREATE POLICY tenant_isolation_update ON project_risks FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_risks;
CREATE POLICY tenant_isolation_delete ON project_risks FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_risks TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_risks TO rfp_agent;
