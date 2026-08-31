-- 232_project_cdrl_register.sql
--
-- The CDRL register — DD Form 1423 data items, and the third state a deliverable never had.
--
-- ── A CDRL IS AN OBLIGATION; A DELIVERABLE IS ONE INSTANCE OF IT ──────────────────────────────
-- "A002 — Monthly Status Report, DI-MGMT-81334D, monthly, Distribution Statement B" is a standing
-- requirement written into the contract once. The twelve reports it produces are twelve
-- deliverables, each under its own monthly milestone — which is exactly the shape the product owner
-- described for the WBS: *"CLIN 002 can have 12 milestones under the WBS... The deliverables on any
-- milestone could be CLINs from the contract."*
--
-- So this migration adds the OBLIGATION and points the existing deliverables at it. There is no
-- second deliverable table and no second submission-history table: the submission history of a CDRL
-- **is** its deliverables, in date order, and building a parallel one would be the fifth structure
-- this module has refused (a second ToDo queue, a second nudge path, a second checklist, a second
-- WBS).
--
-- ── THE THIRD STATE: SENT ────────────────────────────────────────────────────────────────────
-- A deliverable already distinguishes ATTACHED (`uploaded_at` — a file or an authored document is
-- on it) from ACCEPTED (`accepted_at` — a tenant_admin signed off internally). Neither of those
-- means the customer has it.
--
-- For a CDRL that distinction is the whole point: the contract sets a date by which the item must
-- be **delivered to the government**, and lateness is measured against the day it was SENT, not the
-- day somebody finished writing it. `submitted_at` is that third state, and submitting is gated on
-- internal acceptance — sending work nobody signed off is the failure the acceptance gate exists to
-- prevent, arriving one step later.
--
-- What comes BACK is already modelled: `project_acceptance_evidence` (mig 224) records a claim
-- ABOUT the customer — a DD-250, a transmittal, a COR email — uploaded by an admin, never the
-- customer's own act. A CDRL response needs nothing new.
--
-- ── AND THE DISTRIBUTION STATEMENT IS NOT DECORATION ─────────────────────────────────────────
-- Distribution Statement B–F restricts who may receive the document, and the marking is required to
-- appear ON the artifact. Deliverables can be authored in this product's own canvas (mig 220), so
-- the statement is carried here in order to be stamped there — the post-award analogue of the
-- compliance floor that checks a proposal volume's page limit.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · THE REGISTER ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_cdrl_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- 'A001', 'A002' — the government's numbering, free text because the formats vary and inventing
  -- a pattern here would refuse a number a contract actually carries.
  cdrl_number     text NOT NULL CHECK (length(btrim(cdrl_number)) BETWEEN 1 AND 40),
  title           text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),

  -- DD-1423 block 4: the Data Item Description the deliverable must conform to, e.g.
  -- 'DI-MGMT-81334D'. Nullable — plenty of contracts cite none — and a NULL here reads as "not
  -- specified", never as a DID somebody invented.
  did_number      text,
  subtitle        text,

  -- The line item the data requirement sits under. SET NULL rather than CASCADE: removing a CLIN
  -- from the contract must not delete the record of what it required.
  clin_id         uuid REFERENCES project_clins(id) ON DELETE SET NULL,

  -- DD-1423 block 10-12. Vocabulary, because an open string becomes twelve spellings of "monthly"
  -- and no way to answer "what is due next month".
  frequency       text NOT NULL DEFAULT 'one_time'
                    CHECK (frequency IN ('one_time', 'monthly', 'quarterly', 'semiannual',
                                         'annual', 'as_required', 'with_each_milestone')),

  -- DD-1423 block 8. 'A' — the government must APPROVE it; 'I' — information only. The difference
  -- decides whether a rejection is a schedule problem or a filing note, so it is not a comment.
  approval_code   text NOT NULL DEFAULT 'I' CHECK (approval_code IN ('A', 'I')),

  -- The DoD distribution statement letter. 'A' is public release; B through F each restrict who may
  -- receive the document, and the marking is required to appear ON the artifact.
  distribution    text CHECK (distribution IS NULL OR distribution IN ('A', 'B', 'C', 'D', 'E', 'F')),
  -- The rest of the marking — the reason and the controlling office, plus any export-control
  -- caveat. Free text because the wording is dictated by the contract, verbatim, and a vocabulary
  -- here would force somebody to paraphrase a legal marking.
  distribution_note text,

  first_due       date,
  -- How many days after the first one the next is due, when the frequency does not say. NULL for
  -- `one_time` and `as_required`, where there is no next.
  recurrence_days integer CHECK (recurrence_days IS NULL OR recurrence_days > 0),

  notes           text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- A recurring item with no first due date has no schedule at all, and every "what is due" query
  -- would silently skip it. Stated here rather than trusted to a form.
  CONSTRAINT project_cdrl_items_recurring_needs_a_start
    CHECK (frequency IN ('one_time', 'as_required', 'with_each_milestone') OR first_due IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_cdrl_items_number
  ON project_cdrl_items (project_id, cdrl_number);

CREATE INDEX IF NOT EXISTS idx_project_cdrl_items_project
  ON project_cdrl_items (project_id, cdrl_number);

COMMENT ON TABLE project_cdrl_items IS
  'A DD-1423 data requirement — the standing OBLIGATION. Its submission history is its '
  'project_deliverables rows, in date order; there is deliberately no second history table.';

COMMENT ON COLUMN project_cdrl_items.distribution IS
  'DoD distribution statement letter. Carried here so it can be STAMPED on a deliverable authored '
  'in the canvas — the marking is required to appear on the artifact, not merely to be known.';

-- ── 2 · A DELIVERABLE IS AN INSTANCE OF ONE ──────────────────────────────────────────────────

ALTER TABLE project_deliverables
  ADD COLUMN IF NOT EXISTS cdrl_item_id uuid REFERENCES project_cdrl_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN project_deliverables.cdrl_item_id IS
  'The data requirement this deliverable satisfies. SET NULL: removing the requirement must not '
  'delete the artefact somebody produced under it.';

CREATE INDEX IF NOT EXISTS idx_project_deliverables_cdrl
  ON project_deliverables (cdrl_item_id) WHERE cdrl_item_id IS NOT NULL;

-- ── 3 · THE THIRD STATE ──────────────────────────────────────────────────────────────────────

ALTER TABLE project_deliverables
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id),
  -- How it went out, and its reference. "Submitted" with no transmittal is a claim nobody can
  -- check six months later, when the question is whether the item was ever actually delivered.
  ADD COLUMN IF NOT EXISTS transmittal_ref text;

COMMENT ON COLUMN project_deliverables.submitted_at IS
  'SENT TO THE CUSTOMER. Distinct from uploaded_at (something is attached) and accepted_at (a '
  'tenant_admin signed off internally). Lateness against a CDRL date is measured against THIS.';

CREATE INDEX IF NOT EXISTS idx_project_deliverables_unsubmitted
  ON project_deliverables (cdrl_item_id, required_by)
  WHERE cdrl_item_id IS NOT NULL AND submitted_at IS NULL;

-- Submitting is gated on internal acceptance. Sending work nobody signed off is the failure the
-- acceptance gate exists to prevent, arriving one step later — so the gate is restated here rather
-- than left to whichever route happens to be the writer.
CREATE OR REPLACE FUNCTION project_deliverable_submit_needs_acceptance() RETURNS trigger AS $$
BEGIN
  IF NEW.submitted_at IS NOT NULL AND OLD.submitted_at IS NULL AND NEW.accepted_at IS NULL THEN
    RAISE EXCEPTION
      'A deliverable is accepted internally before it is sent to the customer. Accept "%" first — '
      'uploading is not accepting, and accepting is not sending.', NEW.title
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- Un-sending is not a thing. If it went out, it went out; a corrected version is a new
  -- submission, which is what the transmittal reference is for.
  IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION
      'Deliverable "%" has already been sent to the customer. Send a corrected version instead — '
      'the record of what they received has to survive.', OLD.title
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_deliverable_submit_gate ON project_deliverables;
CREATE TRIGGER trg_project_deliverable_submit_gate
  BEFORE UPDATE ON project_deliverables
  FOR EACH ROW
  EXECUTE FUNCTION project_deliverable_submit_needs_acceptance();

-- ── 4 · TENANCY ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_cdrl_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_cdrl_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_cdrl_items;
CREATE POLICY tenant_isolation_select ON project_cdrl_items FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_cdrl_items;
CREATE POLICY tenant_isolation_insert ON project_cdrl_items FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_cdrl_items;
CREATE POLICY tenant_isolation_update ON project_cdrl_items FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_cdrl_items;
CREATE POLICY tenant_isolation_delete ON project_cdrl_items FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_cdrl_items TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_cdrl_items TO rfp_agent;
