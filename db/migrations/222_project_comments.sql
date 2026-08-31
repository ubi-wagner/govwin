-- 222_project_comments.sql
--
-- The conversation a project did not have.
--
-- ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────────────────
-- Before this, a project carried exactly one human decision: a tenant_admin accepting a
-- deliverable. There was nowhere to ask a question, nowhere to answer one, and nowhere to record
-- why a date moved. Everything the product knew about a project was a fact; nothing was a
-- discussion. Layering more automation on top of that produces mail nobody can reply to.
--
-- ── WHY NOT REUSE `proposal_comments` ────────────────────────────────────────────────────────
-- It is shaped for one thing: a comment on a proposal SECTION, anchored into a canvas. It has no
-- `tenant_id` (it scopes through `proposal_id`), no threading, and `resolved` is a bare boolean
-- with no record of who decided or when. A project comment attaches to four different kinds of
-- row, and "who closed this and when" is exactly the sort of thing a contract dispute asks about.
--
-- Widening that table would have meant every proposal read carrying columns that mean nothing to
-- it, and a nullable `proposal_id` on a table whose whole FK story is that it is not null.
--
-- ── THE ANCHOR IS POLYMORPHIC, LIKE `tasks` ──────────────────────────────────────────────────
-- `entity_type` + `entity_id`, the same shape the platform `tasks` table already uses. A NULL
-- `entity_id` means the comment is about the PROJECT itself, which is why the pair is bound by a
-- CHECK rather than left to agree by convention.
--
-- There is no FK on `entity_id` — it cannot have one, pointing at four tables. That is the cost of
-- the polymorphic anchor, and it is paid in the domain layer, which validates the target belongs to
-- THIS project before writing (the same FK-before-write rule every other project write follows).
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

CREATE TABLE IF NOT EXISTS project_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- What it is about. 'project' means the project as a whole and carries no entity_id.
  entity_type     text NOT NULL,
  entity_id       uuid,

  -- ── THREADS ────────────────────────────────────────────────────────────────────────────────
  -- One level, deliberately. A reply to a reply attaches to the same root (normalised in the
  -- domain layer), because arbitrarily deep threads are a rendering problem and a reading problem
  -- long before they are a data problem, and nobody has ever wanted the fourth indent.
  parent_id       uuid REFERENCES project_comments(id) ON DELETE CASCADE,

  body            text NOT NULL,
  author_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The RESOLVED user ids, stored rather than re-parsed. "Does this mention me" is then an array
  -- containment test an index can answer, instead of a text scan that has to know the parsing
  -- rules — and the parsing rules are allowed to change without rewriting history.
  mentions        uuid[] NOT NULL DEFAULT '{}',

  -- ── WHO CLOSED IT, AND WHEN ────────────────────────────────────────────────────────────────
  -- Not a bare boolean. Six months later "was this ever answered, and by whom" is the question,
  -- and a `true` cannot answer it. Same reasoning as `accepted_at`/`accepted_by` on a deliverable.
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,

  -- A typo fixed in place beats a second comment reading "* meant Tuesday". Stamped, so an edited
  -- comment never silently claims to be what was originally said.
  edited_at       timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_comments_entity_type_check
    CHECK (entity_type IN ('project', 'milestone', 'task', 'deliverable')),

  -- The pair must agree in both directions, exactly like mig 221's scope/milestone_id CHECK.
  CONSTRAINT project_comments_entity_pair
    CHECK ((entity_type = 'project') = (entity_id IS NULL)),

  CONSTRAINT project_comments_body_check
    CHECK (length(btrim(body)) BETWEEN 1 AND 10000),

  -- Resolution is a fact with a time, or it has not happened. A `resolved_by` with no
  -- `resolved_at` is a row saying somebody closed this at no particular moment.
  CONSTRAINT project_comments_resolved_pair
    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);

-- The workspace reads every comment on a project at once and buckets them by anchor, so the index
-- is on the read it actually performs rather than on each anchor separately.
CREATE INDEX IF NOT EXISTS idx_project_comments_project
  ON project_comments (project_id, entity_type, entity_id, created_at);

CREATE INDEX IF NOT EXISTS idx_project_comments_thread
  ON project_comments (parent_id) WHERE parent_id IS NOT NULL;

-- "What mentions me, still open" — the query behind a person's own view of the conversation.
CREATE INDEX IF NOT EXISTS idx_project_comments_mentions
  ON project_comments USING GIN (mentions);

COMMENT ON TABLE project_comments IS
  'Threaded comments on a project, milestone, task or deliverable. entity_id is NULL for the '
  'project itself. No FK on entity_id (it points at four tables) — the domain layer validates the '
  'target belongs to the project before writing.';

COMMENT ON COLUMN project_comments.mentions IS
  'Resolved user ids, restricted to people ON the project: mentioning someone who cannot open it '
  'would notify them about something they cannot read. Unresolvable @tokens stay plain text.';

-- RLS, forced, matching every other project table (migs 216 · 218 · 221).
ALTER TABLE project_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_comments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_comments;
CREATE POLICY tenant_isolation_select ON project_comments FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_comments;
CREATE POLICY tenant_isolation_insert ON project_comments FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_comments;
CREATE POLICY tenant_isolation_update ON project_comments FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_comments;
CREATE POLICY tenant_isolation_delete ON project_comments FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_comments TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_comments TO rfp_agent;
