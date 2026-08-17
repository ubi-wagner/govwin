-- 184_restrict_shared_template_catalog_writes.sql
--
-- Hardening (defense-in-depth) for the "no cross-tenant shared objects" invariant.
--
-- BACKGROUND. mig 136_rls_cutover put document_templates in the "with-shared" set with a
-- single FOR ALL tenant_isolation policy:
--     USING      (tenant_id = app.tenant_id OR tenant_id IS NULL)
--     WITH CHECK (tenant_id = app.tenant_id OR tenant_id IS NULL)
-- The `OR tenant_id IS NULL` is correct for READ (every tenant must see the global
-- system-template catalog, is_system=true / tenant_id NULL), but because FOR ALL shares
-- one USING/CHECK across every command, it ALSO let a govtech_app tenant session
-- UPDATE / DELETE / re-create those global rows. Proven live (app connected as the
-- NOBYPASSRLS govtech_app role, SET app.tenant_id = <a tenant>):
--     UPDATE document_templates SET name=name WHERE tenant_id IS NULL  -> 9 rows
--     DELETE FROM document_templates          WHERE tenant_id IS NULL  -> 9 rows
-- i.e. a tenant could mutate or destroy the shared catalog at the RLS layer. Not
-- reachable through any app route today (every tenant writer stamps its own tenant_id;
-- the only NULL/system writes are admin routes on the owner/sqlBypass pool + seed
-- migrations, both RLS-exempt), so this is a backstop gap, not a live leak — but the
-- RLS second layer should hold on its own. See docs/RLS_CUTOVER.md.
--
-- WHY document_templates ONLY (and not the other two with-shared tables, tasks +
-- process_instances): those DO have a legitimate govtech_app writer of tenant_id IS NULL
-- rows — the automation engine creates rfp_admin admin ToDos (tenant_id NULL) via
-- lib/automation/triggers.ts DURING tenant-context requests (e.g. purchase -> curation),
-- and the workflow reconcilers touch admin/global process_instances. Restricting their
-- WRITE side to own-tenant-only would fail-closed on those flows, so it needs a separate,
-- carefully-verified change. document_templates has NO such writer: its only govtech_app
-- writer is the portal template-extract route, which writes tenant_id = <caller tenant>
-- (never NULL); every NULL/system row is written by an admin route on the owner pool or a
-- seed migration — both bypass RLS and are unaffected by the policy below.
--
-- MODEL: split the single FOR ALL policy into per-command policies so READ stays
-- shared while WRITE/DELETE are restricted to the caller's own rows.
--   SELECT : own OR shared-global        (unchanged read behavior)
--   INSERT : own only                    (a tenant cannot mint a system/global row)
--   UPDATE : own only  (USING + CHECK)   (a tenant cannot touch a global row)
--   DELETE : own only  (USING)           (a tenant cannot delete a global row)
-- The owner/sqlBypass connection (admin routes, seeds, pipeline) bypasses RLS entirely,
-- so admin creation/curation of the shared catalog is unaffected. Idempotent / re-runnable.

DO $$
BEGIN
  -- replace the coarse FOR ALL policy from mig 136 (idempotent: drop old + any prior run of these)
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON document_templates';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_select ON document_templates';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_insert ON document_templates';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_update ON document_templates';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_delete ON document_templates';

  -- READ: own rows + the shared global catalog (tenant_id IS NULL / is_system)
  EXECUTE $p$
    CREATE POLICY tenant_isolation_select ON document_templates
      FOR SELECT
      USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid
             OR tenant_id IS NULL)
  $p$;

  -- INSERT: a tenant may only create its OWN rows (never a NULL/system row)
  EXECUTE $p$
    CREATE POLICY tenant_isolation_insert ON document_templates
      FOR INSERT
      WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  $p$;

  -- UPDATE: only own rows, and the result must stay own (no promote-to-global)
  EXECUTE $p$
    CREATE POLICY tenant_isolation_update ON document_templates
      FOR UPDATE
      USING      (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
      WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  $p$;

  -- DELETE: only own rows (a tenant cannot delete a shared/global row)
  EXECUTE $p$
    CREATE POLICY tenant_isolation_delete ON document_templates
      FOR DELETE
      USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  $p$;
END $$;
