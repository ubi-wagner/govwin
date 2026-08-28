-- 230_project_modifications.sql
--
-- Contract modifications — the only way a CLIN is allowed to change.
--
-- ── WHY CLINs ARE WRITE-ONCE, AND STAY THAT WAY ──────────────────────────────────────────────
-- `lib/projects/clins.ts` has `createClin` and no `updateClin`, which reads like an omission and is
-- not. A CLIN is a claim about what the contract says — every field carries a citation on the
-- ingest-provenance trust order, and a plain UPDATE would let somebody retype a funded amount with
-- the old citation still attached to it. The value would move and the badge would still read "Read
-- from source", pointing at a page that no longer says that.
--
-- A contract does not change because somebody edited a field. It changes because a **modification
-- was signed**. So that is the write path: a mod carries its own number, its own signed date and
-- its own document, and executing it is what moves the CLIN.
--
-- ── DRAFT IS NOT EXECUTED ────────────────────────────────────────────────────────────────────
-- The eighth time this capability draws that line (upload is not acceptance; logging is not
-- approving; a comment is not a review). A mod is drafted while it is being negotiated and applies
-- **only** when it is executed — one act, transactional, stamping every change row it applied.
--
-- ── AND AN EXECUTED MOD IS IMMUTABLE ─────────────────────────────────────────────────────────
-- Same rule as the baseline, for the same reason: it is a record of what was agreed on a date, and
-- once overwritten there is no way back to it. A mistake in an executed mod is corrected by ISSUING
-- ANOTHER ONE, which is also how it works on paper. Enforced by trigger, not convention.
--
-- ── WHAT A MOD DELIBERATELY DOES *NOT* DO: REBASELINE ────────────────────────────────────────
-- A mod that extends the period of performance is exactly the moment somebody wants the schedule
-- baseline moved, and this migration refuses to do it silently. `baseline_date` and `baseline_cost`
-- are the ORIGINAL promise; `rebaseline` already exists, already demands a reason, and already
-- moves the current plan without touching what was frozen. Executing a mod RAISES A TODO asking a
-- person to rebaseline; it does not perform one. Two writers on the plan's dates is how a schedule
-- stops being explainable, and an automatic rebaseline would be the second.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · THE MODIFICATION ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_modifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- 'P00001', 'A00002' — the government's number, not ours. Free text because the formats vary by
  -- agency and inventing a pattern here would refuse a number a contract actually carries.
  mod_number      text NOT NULL CHECK (length(btrim(mod_number)) BETWEEN 1 AND 60),
  title           text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  description     text,

  -- Why it exists. Vocabulary, because an open string here becomes twelve spellings of "funding"
  -- and no way to answer "what changed the money".
  kind            text NOT NULL DEFAULT 'funding'
                    CHECK (kind IN ('administrative', 'funding', 'scope', 'schedule', 'termination')),

  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'executed')),

  -- Paired with the status by a CHECK, so a mod cannot be executed with no date or dated without
  -- being executed. The same shape as `(status='done') = (completed_at IS NOT NULL)` on the task
  -- spine — a status and its stamp are one fact, and a table that lets them disagree will.
  executed_on     date,
  executed_by     uuid REFERENCES users(id),

  -- The signed document. Nullable while drafting; required to execute, enforced in the domain layer
  -- rather than here, so the refusal can say WHY rather than raising a constraint name at a person.
  source_doc_id   uuid REFERENCES project_source_documents(id) ON DELETE SET NULL,

  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_modifications_executed_pair
    CHECK ((status = 'executed') = (executed_on IS NOT NULL))
);

-- One P00001 per project. A duplicate mod number is two different documents claiming to be the same
-- amendment, and whichever the roll-up read first would win silently.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_modifications_number
  ON project_modifications (project_id, mod_number);

CREATE INDEX IF NOT EXISTS idx_project_modifications_project
  ON project_modifications (project_id, executed_on DESC NULLS LAST);

COMMENT ON TABLE project_modifications IS
  'A signed contract amendment — the ONLY write path to a CLIN. Draft while negotiating; executing '
  'applies its change rows in one transaction and freezes them. Correct a mistake by issuing '
  'another mod, never by editing this one.';

-- ── 2 · WHAT IT CHANGES ──────────────────────────────────────────────────────────────────────
--
-- One row per field the mod moves, carrying BOTH sides. `old_value` is not redundant with the CLIN's
-- history: it is what the person who signed believed they were changing, captured at execution, and
-- it is what lets the contract be reconstructed at any mod without replaying every row.
CREATE TABLE IF NOT EXISTS project_modification_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  modification_id uuid NOT NULL REFERENCES project_modifications(id) ON DELETE CASCADE,

  -- 'amend'    — move a field on an existing CLIN
  -- 'add_clin' — an option exercise: a new line item, its values in `payload`
  --
  -- There is no 'remove_clin'. A contract does not delete a line item, it DEOBLIGATES it — an
  -- `amend` setting funded_amount to 0 — and deleting the row would take the milestones and
  -- deliverables that reference it along with the history of what was already delivered under it.
  action          text NOT NULL CHECK (action IN ('amend', 'add_clin')),

  -- For 'amend': which CLIN, set at draft time. For 'add_clin': NULL until execution, then the CLIN
  -- that was created — so the change row points at its own result and the trail closes.
  clin_id         uuid REFERENCES project_clins(id) ON DELETE SET NULL,

  -- For 'amend'. NULL for 'add_clin', which carries a whole row in `payload` instead.
  field           text CHECK (field IS NULL OR field IN
                    ('title', 'contract_type', 'pop_start', 'pop_end', 'funded_amount')),
  old_value       text,
  new_value       text,

  -- For 'add_clin': the CLIN to create. jsonb because it is a whole row, and typed columns here
  -- would be a second copy of `project_clins` that has to be migrated alongside it.
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,

  applied_at      timestamptz,
  sort_index      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- An 'amend' names a CLIN and a field; an 'add_clin' names neither at draft time. Stated as a
  -- constraint so a half-filled change row cannot reach execution and apply nothing.
  CONSTRAINT project_modification_changes_shape CHECK (
    (action = 'amend'    AND clin_id IS NOT NULL AND field IS NOT NULL)
    OR
    (action = 'add_clin' AND field IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_project_modification_changes_mod
  ON project_modification_changes (modification_id, sort_index);

COMMENT ON COLUMN project_modification_changes.old_value IS
  'The value at the moment of execution, captured then. Not redundant with an audit log: it is what '
  'lets the contract be reconstructed as of any mod without replaying the whole history.';

-- ── 3 · AN EXECUTED MOD IS FROZEN ────────────────────────────────────────────────────────────
--
-- The baseline rule again, on a different table. `project_baseline_is_immutable` (mig 216) guards
-- individual COLUMNS; this guards a whole row once it reaches a terminal state, so it is its own
-- small function rather than a reuse that would need one argument per column.
CREATE OR REPLACE FUNCTION project_modification_is_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'executed' THEN
    -- Drafting → executed is the ONE transition allowed to touch a row on its way in; by the time
    -- this fires with OLD.status='executed' the mod is already signed.
    RAISE EXCEPTION
      'Modification % is executed and cannot be edited. Issue another modification — that is how a '
      'signed amendment is corrected on paper, and the record of what was agreed has to survive.',
      OLD.mod_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_modification_frozen ON project_modifications;
CREATE TRIGGER trg_project_modification_frozen
  BEFORE UPDATE ON project_modifications
  FOR EACH ROW
  EXECUTE FUNCTION project_modification_is_frozen();

-- The change rows are frozen by the same fact — via their parent, because a change row has no
-- status of its own and asking it to carry one would be two places to look.
CREATE OR REPLACE FUNCTION project_modification_change_is_frozen() RETURNS trigger AS $$
DECLARE parent_status text; parent_number text;
BEGIN
  SELECT status, mod_number INTO parent_status, parent_number
    FROM project_modifications WHERE id = OLD.modification_id;
  -- `applied_at` is written BY the execution itself, in the same transaction that flips the parent
  -- to 'executed'. The guard has to let that through and refuse everything after, so it keys on the
  -- row already carrying a stamp rather than on the parent's status alone.
  IF parent_status = 'executed' AND OLD.applied_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Modification % is executed; its change rows are the record of what was applied.',
      parent_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_modification_change_frozen ON project_modification_changes;
CREATE TRIGGER trg_project_modification_change_frozen
  BEFORE UPDATE OR DELETE ON project_modification_changes
  FOR EACH ROW
  EXECUTE FUNCTION project_modification_change_is_frozen();

-- ── 4 · TENANCY ──────────────────────────────────────────────────────────────────────────────
--
-- `tenant_id` NOT NULL and DIRECT on both tables, never by lineage through the parent. A policy that
-- has to join to find its tenant is a policy that can be joined around, and a lineage-shaped table
-- is invisible to the tenancy audit (mig 212's whole class).

ALTER TABLE project_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_modifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_modifications;
CREATE POLICY tenant_isolation_select ON project_modifications FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_modifications;
CREATE POLICY tenant_isolation_insert ON project_modifications FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_modifications;
CREATE POLICY tenant_isolation_update ON project_modifications FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_modifications;
CREATE POLICY tenant_isolation_delete ON project_modifications FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_modifications TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_modifications TO rfp_agent;

ALTER TABLE project_modification_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_modification_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_modification_changes;
CREATE POLICY tenant_isolation_select ON project_modification_changes FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_modification_changes;
CREATE POLICY tenant_isolation_insert ON project_modification_changes FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_modification_changes;
CREATE POLICY tenant_isolation_update ON project_modification_changes FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_modification_changes;
CREATE POLICY tenant_isolation_delete ON project_modification_changes FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_modification_changes TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_modification_changes TO rfp_agent;
