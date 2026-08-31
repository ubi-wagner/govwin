-- 226_project_meetings.sql
--
-- Where action items come from.
--
-- ── THE ONE THING THIS ADDS THAT A DOCUMENT CANNOT ───────────────────────────────────────────
-- Meeting notes are a canvas document — mig 220 already made every project artifact one, and a
-- second authoring path would be the mistake that migration exists to avoid. What a document cannot
-- do is answer **"which meeting did this task come from?"**, and that is the question that makes an
-- action item different from a task somebody typed: six weeks later, "who agreed to this" is
-- settled by the notes it was decided in.
--
-- So the row is thin on purpose. A date, who was there, and a pointer at the notes.
--
-- ── ATTENDEES ARE FREE TEXT ──────────────────────────────────────────────────────────────────
-- The same rule as `project_acceptance_evidence.customer_name` (mig 224): half the people in a
-- program review work for the customer, and the product has no record of them. Storing a user id
-- would either lose them or manufacture an identity nothing verified. A name is a name.
--
-- ── AND THE ACTION ITEMS ARE ORDINARY TASKS ──────────────────────────────────────────────────
-- `project_milestone_tasks.meeting_id` is a nullable back-pointer, not a new kind of row. An action
-- item is work with an owner and a date, which is what that table already is — so it arrives with a
-- ToDo, an email, nudges, reassignment and attachments, and appears in the same list as everything
-- else the person owes. A separate "action items" table would be a second checklist, which is the
-- thing this module has refused four times now.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

CREATE TABLE IF NOT EXISTS project_meetings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  title        text NOT NULL,
  held_on      date NOT NULL,
  -- Names, not user ids. See above.
  attendees    text[] NOT NULL DEFAULT '{}',

  -- The notes, in the same canvas every other project artifact uses. ON DELETE SET NULL, like a
  -- deliverable's document: losing the draft must not erase the fact that the meeting happened.
  document_id  uuid REFERENCES tenant_documents(id) ON DELETE SET NULL,

  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_meetings_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_project_meetings_project
  ON project_meetings (project_id, held_on DESC);

-- One document backs at most one meeting, for the same reason it backs at most one deliverable:
-- two rows pointing at one set of notes makes "the notes for this meeting" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_meetings_document
  ON project_meetings (document_id) WHERE document_id IS NOT NULL;

COMMENT ON TABLE project_meetings IS
  'A meeting, its date, who was there, and a pointer at the canvas document holding the notes. '
  'Thin on purpose: the only thing it adds over the document is the ability to answer "which '
  'meeting did this action item come from?".';

COMMENT ON COLUMN project_meetings.attendees IS
  'Names, not user ids — half the room usually works for the customer, and the product has no '
  'record of them. Same rule as project_acceptance_evidence.customer_name.';

-- The back-pointer. An action item is an ORDINARY task that happens to know where it came from.
ALTER TABLE project_milestone_tasks
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES project_meetings(id) ON DELETE SET NULL;

COMMENT ON COLUMN project_milestone_tasks.meeting_id IS
  'The meeting this task was agreed in, if any. ON DELETE SET NULL: deleting the meeting record '
  'must not delete work somebody committed to.';

CREATE INDEX IF NOT EXISTS idx_project_milestone_tasks_meeting
  ON project_milestone_tasks (meeting_id) WHERE meeting_id IS NOT NULL;

-- RLS, forced, matching every other project table.
ALTER TABLE project_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_meetings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_meetings;
CREATE POLICY tenant_isolation_select ON project_meetings FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_meetings;
CREATE POLICY tenant_isolation_insert ON project_meetings FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_meetings;
CREATE POLICY tenant_isolation_update ON project_meetings FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_meetings;
CREATE POLICY tenant_isolation_delete ON project_meetings FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_meetings TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_meetings TO rfp_agent;
