-- 212_rls_proposal_spine.sql
--
-- Close a REAL cross-tenant read leak in the proposal spine.
--
-- THE INVARIANT THIS RESTORES: nothing reads or writes cross-tenant, ever. Bridges move data
-- inward by copy; they are not a licence for a shared read.
--
-- WHAT WAS OPEN. Seven tables descended from `proposals` carried no row-level security at all —
-- `relrowsecurity = false`, zero policies — so every row in them was visible to ANY connection on
-- the NOBYPASSRLS `govtech_app` pool, whatever `app.tenant_id` was set to. Measured live on the
-- sandbox as `govtech_app` with the tenant context set to a UUID that owns nothing:
--
--     table                          owner sees   foreign tenant sees
--     proposal_artifacts                     17                    17
--     proposal_compliance_matrix             64                    64
--     proposal_collaborators                  4                     4
--     collaborator_stage_access               8                     8
--     canvas_versions                         0                     0   (empty — unmeasured)
--     proposal_comments                       0                     0   (empty — unmeasured)
--     proposal_stage_history                  0                     0   (empty — unmeasured)
--
-- 100% of rows, in every table that had any. The three zeroes are NOT evidence of protection:
-- those tables are simply empty in this seed and share the identical posture, so they leak the
-- moment they hold a row. `canvas_versions` is the most consequential of them — it is the stored
-- CONTENT of every version of every section, plus the AI instruction that produced it.
--
-- WHY IT WAS MISSED, which matters more than the gap itself. Every audit this repo runs looks for
-- a `tenant_id` COLUMN. None of these seven has one; their tenancy is by FK lineage
-- (… -> proposals.tenant_id). A tenant_id-shaped audit cannot see a lineage-shaped table, so the
-- whole class was invisible to the instrument that was supposed to cover it — and
-- `check-rls-posture.mjs` compounded it by proving isolation on exactly ONE table
-- (tenant_opportunity_cards) and reporting that single result as the posture of the database.
-- The instrument is widened in the same change as this migration; a fix without it would leave
-- the next such table equally invisible.
--
-- MODEL. One `FOR ALL` policy per table named `tenant_isolation`, matching the house pattern set
-- by mig 136_rls_cutover and used verbatim by `proposal_sections`: an EXISTS up the FK chain to
-- `proposals.tenant_id`. Six of the seven hold `proposal_id` directly and are a single hop; only
-- `canvas_versions` is keyed by `section_id` and needs the two-hop through `proposal_sections`.
--
-- WITH CHECK is deliberately omitted. For a FOR ALL policy PostgreSQL reuses the USING expression
-- as the WITH CHECK expression, so writes are constrained to the caller's own tenant by the same
-- clause — identical to `proposal_sections`, and one expression rather than two that can drift
-- apart. (A quantity defined twice will eventually disagree with itself.)
--
-- WHY THIS DOES NOT FAIL CLOSED. The owner role (`govtech`) is a superuser, so it bypasses RLS
-- regardless of FORCE — every admin cross-tenant read on the `sqlBypass` pool is unaffected,
-- exactly as it already is for the forced `proposals` and `proposal_sections`. On the `govtech_app`
-- pool every one of these tables is reached from a tenant-context request whose `app.tenant_id` is
-- already set by the per-request middleware; the rows such a request touches are its own tenant's
-- by construction, which is precisely what the policy admits.
--
-- FORCE is set to match `proposals` / `proposal_sections`, so the posture of the spine is uniform
-- and a future non-superuser owner does not silently become an exemption.
--
-- Idempotent / re-runnable.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- One hop: tables holding `proposal_id`.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'proposal_artifacts',
    'proposal_compliance_matrix',
    'proposal_collaborators',
    'proposal_comments',
    'proposal_stage_history',
    'collaborator_stage_access'
  ] LOOP
    -- Skip cleanly rather than abort if a table is absent: this migration runs against boxes at
    -- different heads, and a missing table is not a reason to leave the other six unprotected.
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'mig212: % absent, skipped', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        USING (EXISTS (
          SELECT 1 FROM public.proposals p
          WHERE p.id = %I.proposal_id
            AND p.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        ))
    $f$, t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Two hops: canvas_versions is keyed by section_id, not proposal_id.
--
-- This is the one that matters most. A section version row carries the full stored CanvasDocument
-- and the `ai_instruction` that produced it, so an open read here is the proposal text itself.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.canvas_versions') IS NULL THEN
    RAISE NOTICE 'mig212: canvas_versions absent, skipped';
    RETURN;
  END IF;

  ALTER TABLE public.canvas_versions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.canvas_versions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON public.canvas_versions;
  CREATE POLICY tenant_isolation ON public.canvas_versions
    FOR ALL
    USING (EXISTS (
      SELECT 1
      FROM public.proposal_sections s
      JOIN public.proposals p ON p.id = s.proposal_id
      WHERE s.id = canvas_versions.section_id
        AND p.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ));
END $$;

-- ---------------------------------------------------------------------------------------------
-- Supporting indexes for the policy subqueries.
--
-- A FOR ALL policy runs its EXISTS on EVERY row touched by every statement, so an unindexed FK
-- here turns a routine section read into a sequential scan of `proposals`. These are the columns
-- the policies above join on; `IF NOT EXISTS` keeps the migration re-runnable and a no-op where a
-- prior migration already created them.
-- ---------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_proposal_artifacts_proposal ON public.proposal_artifacts (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_compliance_matrix_proposal ON public.proposal_compliance_matrix (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_collaborators_proposal ON public.proposal_collaborators (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_comments_proposal ON public.proposal_comments (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_stage_history_proposal ON public.proposal_stage_history (proposal_id);
CREATE INDEX IF NOT EXISTS idx_collaborator_stage_access_proposal ON public.collaborator_stage_access (proposal_id);
CREATE INDEX IF NOT EXISTS idx_canvas_versions_section ON public.canvas_versions (section_id);

COMMIT;
