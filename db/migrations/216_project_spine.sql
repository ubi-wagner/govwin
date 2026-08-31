-- 216_project_spine.sql
--
-- Post-award project management (delivery): CLIN · WBS · milestones · deliverables.
--
-- A SEGREGATED capability for tenants who have won. It reuses the platform substrate — tenancy,
-- RLS, storage, the workflow engine, the mail seam — and shares NO schema with the proposal spine.
-- Canonical design: docs/PROJECT_MANAGEMENT_DESIGN.md.
--
-- ── WHY EVERY TABLE GETS RLS IN THIS FILE, NOT A LATER ONE ───────────────────────────────────
-- Migrations 184, 212 and 213 exist because tables shipped without a policy and had to be
-- retrofitted. Mig 212's own header records what that cost: seven tables in the proposal spine
-- carried `relrowsecurity = false` and zero policies, so 100% of their rows were visible to any
-- tenant context — including `canvas_versions`, which holds the text of every proposal. It was
-- invisible for months because every audit looked for a `tenant_id` COLUMN and those tables had
-- none.
--
-- Two rules fall out, and both are applied here. Every table carries `tenant_id uuid NOT NULL`
-- rather than inheriting tenancy by FK lineage, so a column-shaped audit can see it. And FORCE RLS
-- plus the policy is written in the SAME statement block that creates the table, so there is no
-- window in which the table exists unprotected.
--
-- ── THE COLUMN THE DESIGN COULD NOT HAVE HAD ─────────────────────────────────────────────────
-- `project_milestones.current_date` is in the design doc and **is a syntax error**:
--
--     CREATE TEMP TABLE probe (id int, current_date date);
--     ERROR:  syntax error at or near "current_date"
--
-- `CURRENT_DATE` is a reserved keyword. Quoting it works and then every reference needs quoting
-- forever, which is a permanent trap for the next person writing a query by hand. It is
-- `forecast_date` here — which is also the more honest name: it is the current forecast for a
-- milestone, against the immutable `baseline_date`.
--
-- ── BASELINE IMMUTABILITY IS A TRIGGER, NOT A CONVENTION ─────────────────────────────────────
-- Variance only means something if you still hold what you promised. A rebaseline that overwrote
-- the baseline would destroy the ability to say "fourteen days late against baseline" — forever,
-- and silently, because the numbers would still add up.
--
-- An app-layer rule protects only the writers that exist today. The trigger below allows NULL → a
-- value (setting the baseline once) and a no-op rewrite of the same value (so an idempotent UPDATE
-- of a whole row does not fail), and refuses any change of a set baseline to something else,
-- including back to NULL.
--
-- ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────────────────────
-- • No `UNIQUE (project_id, code)` on the WBS. A duplicate code is a data error, but a reorder that
--   swaps 1.2 and 1.3 needs a moment where both exist, and a constraint that forces a temp value on
--   every reorder buys less than it costs.
-- • No `archived_at`. Archive targets are exactly three entities (docs/ARCHIVABLE_CONTRACT.md) and
--   a project is not one; a slumbering tenant darkens through `verifyTenantAccess`.
-- • No collaborator or partner_user reach. v1 has no cross-tenant surface at all, which is what
--   removes the copy-inward problem before it exists.
--
-- Idempotent / re-runnable. (The migrate runner wraps each file in its own transaction — no
-- explicit BEGIN/COMMIT, matching every other migration in this tree.)

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Anchor — the project and its uploaded artifacts
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  -- A convenience link for navigation, explicitly NOT the source of truth. See the note on
  -- project_source_documents below.
  contract_id     uuid REFERENCES contracts(id),
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning', 'active', 'closing', 'closed')),
  baselined_at    timestamptz,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN projects.contract_id IS
  'Navigation convenience only. The ANCHOR is the uploaded artifacts in project_source_documents '
  '— see migration 216 and docs/PROJECT_MANAGEMENT_DESIGN.md.';

CREATE TABLE IF NOT EXISTS project_source_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('executed_contract', 'submitted_proposal')),
  storage_key     text NOT NULL,
  filename        text NOT NULL,
  content_type    text,
  byte_size       bigint,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE project_source_documents IS
  'THE UPLOADED FILE IS THE ANCHOR, even when we authored the proposal. What lives in '
  'proposals/proposal_sections is a working copy that stayed editable after submission — a '
  'deliverable tracing to our canvas traces to something that can still change, while one tracing '
  'to the uploaded PDF traces to what was actually signed. The ingest-provenance doctrine, one '
  'domain over: a value the product did not read from the source must never look like one it did.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- CLIN → WBS
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_clins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clin_number     text NOT NULL,
  title           text NOT NULL,
  contract_type   text,
  pop_start       date,
  pop_end         date,
  funded_amount   numeric(14,2),
  sort_index      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, clin_number)
);

COMMENT ON COLUMN project_clins.funded_amount IS
  'Funding as awarded. Nothing in v1 moves money; this column exists so invoicing against CLIN '
  'funding stays possible later without a migration.';

CREATE TABLE IF NOT EXISTS project_wbs_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clin_id         uuid REFERENCES project_clins(id) ON DELETE SET NULL,
  parent_id       uuid REFERENCES project_wbs_nodes(id) ON DELETE CASCADE,
  code            text NOT NULL,
  title           text NOT NULL,

  -- BASELINE — written once, never updated. Enforced by trigger, not by convention.
  baseline_start  date,
  baseline_end    date,
  baseline_cost   numeric(14,2),

  -- CURRENT — the live plan, freely editable.
  planned_start   date,
  planned_end     date,
  planned_cost    numeric(14,2),
  actual_cost     numeric(14,2) NOT NULL DEFAULT 0,

  sort_index      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN project_wbs_nodes.sort_index IS
  'ORDERING IS BY THIS INTEGER. Never sort by `code` as a string — "1.10" sorts before "1.2" '
  'lexically, which is exactly the bug migration 143 fixed for proposal_sections.section_number.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Milestones and deliverables
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clin_id         uuid REFERENCES project_clins(id) ON DELETE SET NULL,
  wbs_node_id     uuid REFERENCES project_wbs_nodes(id) ON DELETE SET NULL,
  title           text NOT NULL,
  baseline_date   date,
  -- NOT `current_date`: that is a reserved keyword and an unquoted column of that name is a syntax
  -- error. `forecast_date` is also the truer name — the current forecast, against the baseline.
  forecast_date   date,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'met', 'missed', 'waived')),
  met_at          timestamptz,
  sort_index      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN project_milestones.forecast_date IS
  'The current forecast. Variance is forecast_date − baseline_date, and it only means anything '
  'because baseline_date cannot be rewritten (see the immutability trigger in migration 216).';

CREATE TABLE IF NOT EXISTS project_deliverables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  milestone_id    uuid NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  title           text NOT NULL,
  required_by     date,
  storage_key     text,
  filename        text,
  content_type    text,
  byte_size       bigint,
  uploaded_by     uuid REFERENCES users(id),
  uploaded_at     timestamptz,
  accepted_at     timestamptz,
  accepted_by     uuid REFERENCES users(id),
  sort_index      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE project_deliverables IS
  'UPLOAD AND ACCEPTANCE ARE TWO FACTS. A file present is not a deliverable met — someone has to '
  'say so. Collapsing them would make "we uploaded a draft" and "the government accepted it" '
  'indistinguishable, and the second is the one that closes a CLIN.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Provenance — own table, the ingest spine's vocabulary
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_provenance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_table    text NOT NULL,
  target_id       uuid NOT NULL,
  field           text NOT NULL,
  method          text NOT NULL
                    CHECK (method IN ('hitl', 'verified', 'override', 'pattern_match', 'ai', 'default')),
  source_doc_id   uuid REFERENCES project_source_documents(id) ON DELETE SET NULL,
  page            integer,
  excerpt         text,
  char_offset     integer,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_table, target_id, field)
);

COMMENT ON TABLE project_provenance IS
  'Same trust order as solicitation_compliance.field_provenance (hitl > verified > override > '
  'pattern_match > ai > default), same "Read from source" vs red "Default — unverified" badge, and '
  'the same rule that ABSENCE IS A FINDING: a deferral cites where the answer lives rather than '
  'inventing a number. Own table because the target grammar differs — CLIN numbers, PoP dates and '
  'funding, not solicitation fields.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Assignment — the intra-tenant layer RLS cannot express
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  assigned_by     uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

COMMENT ON TABLE project_assignments IS
  'RLS GIVES TENANT ISOLATION. ASSIGNMENT IS APP-ENFORCED, AND RLS CANNOT EXPRESS IT — a policy '
  'here would have to consult the requesting USER, and the per-request context carries only the '
  'tenant. Same shape as listOpenTasksForActor scoping non-admins by assignee, and CLAUDE.md is '
  'blunt about the risk: treat that belt as load-bearing, because a reader that omits it leaks and '
  'RLS will not catch it. Hence a dedicated boundary test, not just this table.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Indexes — the policy runs its predicate on every row of every statement
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_projects_tenant       ON projects (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_contract     ON projects (contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_source_docs_project   ON project_source_documents (project_id);
CREATE INDEX IF NOT EXISTS idx_project_clins_project         ON project_clins (project_id, sort_index);
CREATE INDEX IF NOT EXISTS idx_project_wbs_project           ON project_wbs_nodes (project_id, sort_index);
CREATE INDEX IF NOT EXISTS idx_project_wbs_parent            ON project_wbs_nodes (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_wbs_clin              ON project_wbs_nodes (clin_id) WHERE clin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_milestones_project    ON project_milestones (project_id, sort_index);
CREATE INDEX IF NOT EXISTS idx_project_milestones_clin       ON project_milestones (clin_id) WHERE clin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_milestones_due        ON project_milestones (forecast_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_project_deliverables_ms       ON project_deliverables (milestone_id, sort_index);
CREATE INDEX IF NOT EXISTS idx_project_provenance_target     ON project_provenance (target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_user      ON project_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_project   ON project_assignments (project_id);

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- RLS — force + one FOR ALL policy per table, in the same migration that creates them
--
-- FOR ALL reuses the USING expression as WITH CHECK, so writes are constrained to the caller's own
-- tenant by the same clause. One expression rather than two that can drift apart: a quantity
-- defined twice will eventually disagree with itself (mig 212's wording, and its reasoning).
--
-- No `OR tenant_id IS NULL` arm anywhere. Delivery has no platform-scope rows — every one of these
-- tables describes one tenant's contract — so the strict equality is the whole story.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects',
    'project_source_documents',
    'project_clins',
    'project_wbs_nodes',
    'project_milestones',
    'project_deliverables',
    'project_provenance',
    'project_assignments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;

-- `project_deliverables` has no `project_id`; its tenancy is its own `tenant_id` column, which the
-- policy above already covers. The FK to `project_milestones` is navigational, not the tenancy
-- edge — a lineage-shaped table is exactly what mig 212's audit could not see, and this one is not
-- shaped that way on purpose.

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Baseline immutability
--
-- NULL → a value is allowed: that is setting the baseline, once. A rewrite of the SAME value is
-- allowed, so an idempotent whole-row UPDATE does not fail for touching a column it did not change.
-- Anything else — a different value, or back to NULL — is refused.
--
-- In the database rather than in the application because an app-layer rule protects only the
-- writers that exist today, and the thing being protected cannot be reconstructed afterwards.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION project_baseline_is_immutable() RETURNS trigger AS $$
DECLARE
  col text;
  old_val text;
  new_val text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', col, col)
      INTO old_val, new_val USING OLD, NEW;
    IF old_val IS NOT NULL AND old_val IS DISTINCT FROM new_val THEN
      RAISE EXCEPTION
        'project: % is a BASELINE column and is written once (% -> %). Rebaseline supersedes the '
        'CURRENT plan; it never overwrites the baseline, because variance only means something if '
        'you still hold what you promised.',
        col, old_val, COALESCE(new_val, 'NULL')
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wbs_baseline_immutable ON project_wbs_nodes;
CREATE TRIGGER trg_wbs_baseline_immutable
  BEFORE UPDATE ON project_wbs_nodes
  FOR EACH ROW
  EXECUTE FUNCTION project_baseline_is_immutable('baseline_start', 'baseline_end', 'baseline_cost');

DROP TRIGGER IF EXISTS trg_milestone_baseline_immutable ON project_milestones;
CREATE TRIGGER trg_milestone_baseline_immutable
  BEFORE UPDATE ON project_milestones
  FOR EACH ROW
  EXECUTE FUNCTION project_baseline_is_immutable('baseline_date');

DROP TRIGGER IF EXISTS trg_project_baselined_immutable ON projects;
CREATE TRIGGER trg_project_baselined_immutable
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION project_baseline_is_immutable('baselined_at');
