-- 231_project_invoices.sql
--
-- Invoicing — the point where everything else in this capability becomes money.
--
-- ── IT IS DELIBERATELY BUILT ON WHAT IS ALREADY HERE ─────────────────────────────────────────
-- Nothing in this migration invents a second source for a number that already has one:
--
--   the CEILING   `project_clins.funded_amount` — which migration 230 made movable only by a
--                 signed modification. So "how much may we bill" has exactly one answer and one
--                 way to change it.
--   the LABOUR    approved `project_time_entries` (mig 227) — the hours a manager signed off.
--   the WORK      an ACCEPTED `project_deliverables` row under a milestone, which is what a
--                 payment milestone on a firm-fixed-price contract actually bills against.
--
-- ── THE TWO INVARIANTS ───────────────────────────────────────────────────────────────────────
--
-- **1 · You cannot bill past the ceiling.** Cumulative lines against a CLIN, across every invoice
-- that is not void, must not exceed its funded amount. Overbilling a government contract is not a
-- tidy-up-later problem, and a number that silently exceeds its funding is worse than a refusal.
-- Checked at SUBMIT, in the domain layer, so the refusal can say by how much.
--
-- **2 · The same hours cannot be billed twice.** `project_time_entries.invoice_line_id` is the
-- link, so "not yet invoiced" is a query rather than a convention, and double-billing is
-- structurally impossible rather than merely discouraged. ON DELETE SET NULL: voiding an invoice
-- releases its hours to be billed on the next one, which is exactly what a correction is.
--
-- ── AND SUBMITTED IS NOT PAID ────────────────────────────────────────────────────────────────
-- The ninth time this capability draws that line (upload is not acceptance; logging is not
-- approving; a comment is not a review; a draft mod is not an executed one). Submitting is a claim;
-- payment is cash arriving, days or months later, often partial. Collapsing them would make an
-- unpaid invoice indistinguishable from a paid one on the only screen anybody checks.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · THE INVOICE ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  invoice_number  text NOT NULL CHECK (length(btrim(invoice_number)) BETWEEN 1 AND 60),

  -- The billing period. Both nullable: a payment-milestone invoice on a firm-fixed-price contract
  -- bills an EVENT, not a month, and inventing a period for it would put a claim about dates on a
  -- document that makes none.
  period_start    date,
  period_end      date,

  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'paid', 'void')),

  submitted_on    date,
  paid_on         date,
  -- PARTIAL payment is the normal case, not an edge one — a government customer pays against a
  -- withholding, and an invoice that can only be all-or-nothing forces somebody to lie about which.
  amount_paid     numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),

  -- Why it was voided. Required with the status, because "there used to be an invoice here" with no
  -- reason is the single least useful row in an audit.
  void_reason     text,

  -- The invoice document itself, authored in the SAME canvas editor as a proposal volume or a
  -- deliverable, measured by the same compliance floor and rendered by the same exporters
  -- (mig 220's shape). ON DELETE SET NULL: losing the draft must not delete the claim.
  document_id     uuid REFERENCES tenant_documents(id) ON DELETE SET NULL,

  notes           text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- A status and its stamp are ONE fact, and a table that lets them disagree will. Same shape as
  -- `(status='done') = (completed_at IS NOT NULL)` on the task spine.
  CONSTRAINT project_invoices_submitted_pair
    CHECK ((status IN ('submitted', 'paid')) = (submitted_on IS NOT NULL)),
  CONSTRAINT project_invoices_paid_pair
    CHECK ((status = 'paid') = (paid_on IS NOT NULL)),
  CONSTRAINT project_invoices_void_reason
    CHECK (status <> 'void' OR (void_reason IS NOT NULL AND length(btrim(void_reason)) > 0)),
  CONSTRAINT project_invoices_period_order
    CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_invoices_number
  ON project_invoices (project_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_project_invoices_project
  ON project_invoices (project_id, submitted_on DESC NULLS FIRST);

COMMENT ON TABLE project_invoices IS
  'A claim for payment. Draft while it is assembled; SUBMITTED is the claim; PAID is cash arriving, '
  'which is a separate act and often partial. Voiding releases any hours it had billed.';

-- ── 2 · THE LINES ────────────────────────────────────────────────────────────────────────────
--
-- Per CLIN, because that is how the money is authorised and how the ceiling is checked. An invoice
-- spanning two CLINs is one invoice with two lines, not two invoices.
CREATE TABLE IF NOT EXISTS project_invoice_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  invoice_id      uuid NOT NULL REFERENCES project_invoices(id) ON DELETE CASCADE,

  clin_id         uuid NOT NULL REFERENCES project_clins(id) ON DELETE RESTRICT,
  -- The payment milestone this line bills, when there is one. RESTRICT is deliberate above and
  -- SET NULL here: a CLIN with billing against it must not be deletable at all, whereas a
  -- reorganised plan must not destroy an invoice line that was already paid.
  milestone_id    uuid REFERENCES project_milestones(id) ON DELETE SET NULL,

  description     text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),

  -- Where the number came from. Not decoration: it is what lets the roll-up say "of $180,000
  -- billed, $140,000 is labour somebody approved" rather than presenting one opaque total.
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('milestone', 'labour', 'other_direct', 'fee', 'manual')),

  -- Non-zero, and signed. A negative line is a retroactive adjustment on the next invoice, which is
  -- how a correction is actually made — reopening a submitted claim is not.
  amount          numeric(14,2) NOT NULL CHECK (amount <> 0),

  sort_index      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_invoice_lines_invoice
  ON project_invoice_lines (invoice_id, sort_index);
CREATE INDEX IF NOT EXISTS idx_project_invoice_lines_clin
  ON project_invoice_lines (clin_id);

-- ── 3 · THE HOURS CAN ONLY BE BILLED ONCE ────────────────────────────────────────────────────

ALTER TABLE project_time_entries
  ADD COLUMN IF NOT EXISTS invoice_line_id uuid
    REFERENCES project_invoice_lines(id) ON DELETE SET NULL;

COMMENT ON COLUMN project_time_entries.invoice_line_id IS
  'The invoice line that billed these hours. NULL means not yet billed — a QUERY rather than a '
  'convention, which is what makes double-billing structurally impossible. ON DELETE SET NULL so '
  'voiding an invoice releases its hours onto the next one.';

CREATE INDEX IF NOT EXISTS idx_project_time_entries_unbilled
  ON project_time_entries (project_id, milestone_id)
  WHERE approved_at IS NOT NULL AND invoice_line_id IS NULL;

-- ── 4 · A SUBMITTED INVOICE'S LINES ARE FROZEN ───────────────────────────────────────────────
--
-- The header still moves — that is how it becomes paid — but the LINES are the claim, and a claim
-- that can be edited after it was made is not one. A mistake is corrected by an adjusting line on
-- the next invoice, or by voiding this one and reissuing, both of which leave a trail.
CREATE OR REPLACE FUNCTION project_invoice_line_is_frozen() RETURNS trigger AS $$
DECLARE parent_status text; parent_number text;
BEGIN
  SELECT status, invoice_number INTO parent_status, parent_number
    FROM project_invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF parent_status IN ('submitted', 'paid') THEN
    RAISE EXCEPTION
      'Invoice % has been submitted; its lines are the claim that was made. Add an adjusting line '
      'to the next invoice, or void this one and reissue.', parent_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- INSERT included on purpose: adding a line to a submitted invoice is the same violation as editing
-- one, and it is the easier of the two to do by accident.
DROP TRIGGER IF EXISTS trg_project_invoice_line_frozen ON project_invoice_lines;
CREATE TRIGGER trg_project_invoice_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON project_invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION project_invoice_line_is_frozen();

-- A submitted invoice cannot go back to draft. Forward only: submitted → paid, or → void.
CREATE OR REPLACE FUNCTION project_invoice_status_forward() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('submitted', 'paid') AND NEW.status = 'draft' THEN
    RAISE EXCEPTION
      'Invoice % has been submitted and cannot return to draft. Void it and reissue — the customer '
      'has the original either way, and a claim that can be un-made is not a record.',
      OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'Invoice % is void. Issue a new one.', OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_invoice_status_forward ON project_invoices;
CREATE TRIGGER trg_project_invoice_status_forward
  BEFORE UPDATE ON project_invoices
  FOR EACH ROW
  EXECUTE FUNCTION project_invoice_status_forward();

-- ── 5 · TENANCY ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_invoices;
CREATE POLICY tenant_isolation_select ON project_invoices FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_invoices;
CREATE POLICY tenant_isolation_insert ON project_invoices FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_invoices;
CREATE POLICY tenant_isolation_update ON project_invoices FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_invoices;
CREATE POLICY tenant_isolation_delete ON project_invoices FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_invoices TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_invoices TO rfp_agent;

ALTER TABLE project_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invoice_lines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_invoice_lines;
CREATE POLICY tenant_isolation_select ON project_invoice_lines FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_invoice_lines;
CREATE POLICY tenant_isolation_insert ON project_invoice_lines FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_invoice_lines;
CREATE POLICY tenant_isolation_update ON project_invoice_lines FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_invoice_lines;
CREATE POLICY tenant_isolation_delete ON project_invoice_lines FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_invoice_lines TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_invoice_lines TO rfp_agent;
