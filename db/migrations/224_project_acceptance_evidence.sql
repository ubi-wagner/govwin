-- 224_project_acceptance_evidence.sql
--
-- The BACKING for an acceptance — a signed DD-250, the COR's email, a transmittal receipt.
--
-- ── WHAT THIS REPLACES, AND WHY ──────────────────────────────────────────────────────────────
-- The alternative was a read-only login for the customer's contracting officer. That reopens a
-- boundary this product closed on purpose: `partner_user` is refused the project capability
-- outright (lib/projects/access.ts), which is what removes cross-tenant from it entirely. A COR
-- portal would mean an external session, a new audience for every project surface, and a scoping
-- question on each one.
--
-- Uploading the evidence costs none of that. The customer's act reaches the system as a FILE the
-- tenant_admin already has, and the boundary stays where it is.
--
-- ── AND WHY IT IS NOT AN ACCEPTANCE ──────────────────────────────────────────────────────────
-- This is the load-bearing distinction, and it is the ingest-provenance rule applied to acceptance:
-- **a value the product did not read from the source must never look like one it did.**
--
-- Admin-uploaded evidence is a CLAIM ABOUT the customer, not the customer's own act. So it never
-- writes `accepted_at`, and the deliverable's record must never render as "accepted by the
-- government". It renders as "accepted by <the admin>, evidence: COR email 2026-04-02" — which is
-- exactly what happened, and is the sentence a dispute six months later needs.
--
-- The same shape as everything else here: uploading is not accepting, authoring is not accepting,
-- approving is not accepting, and now evidencing is not accepting either. Four ways to attach a
-- fact, one deliberate act by a person who is allowed to make it.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

CREATE TABLE IF NOT EXISTS project_acceptance_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deliverable_id  uuid NOT NULL REFERENCES project_deliverables(id) ON DELETE CASCADE,

  -- What KIND of customer act this records. A closed vocabulary, because "evidence" with no kind
  -- is a filing cabinet: a signed DD-250 and a forwarded email are not the same weight of proof,
  -- and whoever reads this later needs to know which they are looking at.
  kind            text NOT NULL,

  -- WHO, on the customer's side, and WHEN they did it. Free text on purpose: this is a person at
  -- another organisation, and the product has no record of them — inventing a user row for a COR
  -- would be manufacturing an identity the system never verified.
  customer_name   text,
  customer_role   text,
  occurred_on     date,

  filename        text NOT NULL,
  storage_key     text NOT NULL,
  content_type    text,
  byte_size       bigint,
  note            text,

  -- The ADMIN who filed it. Never conflated with `customer_name`: one is a user of this product,
  -- the other is a name typed into a form.
  uploaded_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_acceptance_evidence_kind_check
    CHECK (kind IN ('dd250', 'cor_email', 'signed_receipt', 'transmittal', 'other')),
  CONSTRAINT project_acceptance_evidence_filename_len
    CHECK (length(filename) BETWEEN 1 AND 500),
  CONSTRAINT project_acceptance_evidence_note_len
    CHECK (note IS NULL OR length(note) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_project_acceptance_evidence_deliverable
  ON project_acceptance_evidence (deliverable_id, uploaded_at DESC);

COMMENT ON TABLE project_acceptance_evidence IS
  'The backing for an acceptance, filed by a tenant_admin. It is a CLAIM ABOUT the customer, not '
  'the customer''s own act: it never writes accepted_at, and the record reads "accepted by <admin>, '
  'evidence: …" — never "accepted by the government". Replaces a COR read-only portal, which would '
  'have reopened the partner_user boundary that lib/projects/access.ts closes.';

COMMENT ON COLUMN project_acceptance_evidence.customer_name IS
  'A name typed into a form by our user — NOT a verified identity, and never rendered as one. The '
  'product has no record of this person; inventing a user row for a COR would manufacture an '
  'identity the system never checked.';

-- RLS, forced, matching every other project table (migs 216 · 218 · 221 · 222 · 223).
ALTER TABLE project_acceptance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_acceptance_evidence FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_acceptance_evidence;
CREATE POLICY tenant_isolation_select ON project_acceptance_evidence FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_acceptance_evidence;
CREATE POLICY tenant_isolation_insert ON project_acceptance_evidence FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_acceptance_evidence;
CREATE POLICY tenant_isolation_update ON project_acceptance_evidence FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_acceptance_evidence;
CREATE POLICY tenant_isolation_delete ON project_acceptance_evidence FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_acceptance_evidence TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_acceptance_evidence TO rfp_agent;
