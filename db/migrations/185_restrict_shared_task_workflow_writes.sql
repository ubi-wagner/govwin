-- 185_restrict_shared_task_workflow_writes.sql
--
-- Hardening (defense-in-depth) for the "no cross-tenant shared objects" invariant — the
-- follow-up to mig 184 (document_templates), completing the RLS-backstop split for the
-- other two "with-shared" tables: tasks + process_instances.
-- (docs/COPY_INWARD_VERIFICATION.md §3.)
--
-- BACKGROUND. mig 136_rls_cutover put tasks, process_instances, document_templates in the
-- "with-shared" set with a single FOR ALL tenant_isolation policy:
--     USING      (tenant_id = app.tenant_id OR tenant_id IS NULL)
--     WITH CHECK (tenant_id = app.tenant_id OR tenant_id IS NULL)
-- The `OR tenant_id IS NULL` is correct for READ (tenants must see global admin ToDos and
-- admin workflow instances), but because FOR ALL shares one USING/CHECK across every
-- command, it ALSO let a govtech_app tenant session UPDATE / DELETE the shared NULL rows,
-- or promote its own row to global (SET tenant_id=NULL). Proven live (app connected as the
-- NOBYPASSRLS govtech_app role, SET app.tenant_id = <a tenant>):
--     UPDATE tasks SET title=title  WHERE tenant_id IS NULL  -> N rows   (mutate shared)
--     DELETE FROM tasks             WHERE tenant_id IS NULL  -> N rows   (destroy shared)
--     UPDATE tasks SET tenant_id=NULL WHERE id=<own>         -> 1 row    (promote to global)
-- Not reachable through any app route today (every tenant writer stamps its own tenant_id),
-- so this is a backstop gap, not a live leak — but the RLS second layer should hold alone.
--
-- WHY THIS IS SEPARATE FROM mig 184 (document_templates). Unlike document_templates, these
-- two tables DO have a legitimate govtech_app writer of tenant_id IS NULL rows: the
-- automation engine creates rfp_admin admin ToDos (tenant_id NULL) via
-- lib/automation/triggers.ts (`import { sql }`) DURING tenant-context requests (e.g.
-- purchase -> curation), and the workflow reconcilers create admin/global
-- process_instances. That writer runs on the RLS-enforced govtech_app pool with
-- app.tenant_id SET to the tenant, so a legitimate NULL-INSERT and a malicious tenant
-- NULL-INSERT are byte-identical at the RLS layer — INSERT of a NULL row therefore CANNOT
-- be separated by policy without first moving that writer to the owner/sqlBypass pool.
--
-- MODEL: split the FOR ALL policy into per-command policies. Restrict the DAMAGING vectors
-- (mutate/destroy shared rows, promote own->global) which have NO legitimate govtech_app
-- writer, while leaving INSERT permissive so the automation NULL-writer keeps working:
--   SELECT : own OR shared-global        (unchanged read behavior)
--   INSERT : own OR NULL                 (preserves the automation admin-ToDo writer)
--   UPDATE : own only (USING + CHECK)    (cannot touch a shared row; cannot promote own->global)
--   DELETE : own only (USING)            (cannot delete a shared row)
-- The owner/sqlBypass connection (admin routes, reconcilers on the owner pool, seeds)
-- bypasses RLS entirely and is unaffected. Idempotent / re-runnable.
--
-- RESIDUAL (documented). A tenant session can still INSERT a NEW tenant_id=NULL row (mint a
-- global admin ToDo / workflow instance) — the one vector byte-identical to the legitimate
-- writer. Closing it requires routing lib/automation/triggers.ts's NULL-row writes through
-- the owner/sqlBypass pool, after which INSERT can also be restricted to own-only (as mig
-- 184 did for document_templates). Tracked in docs/COPY_INWARD_VERIFICATION.md §3. Not
-- app-exploitable today (no tenant route mints a NULL task / process_instance).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','process_instances'] LOOP
    -- replace the coarse FOR ALL policy from mig 136 (idempotent: drop old + any prior run)
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %I', t);

    -- READ: own rows + shared global (admin ToDos / admin workflow instances)
    EXECUTE format($p$
      CREATE POLICY tenant_isolation_select ON %I
        FOR SELECT
        USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid
               OR tenant_id IS NULL)
    $p$, t);

    -- INSERT: own rows OR a shared/global NULL row. The automation engine writes rfp_admin
    -- admin ToDos (tenant_id NULL) on the govtech_app pool during tenant-context requests,
    -- so NULL must remain insertable here (see header). Owner-pool system writes bypass RLS.
    EXECUTE format($p$
      CREATE POLICY tenant_isolation_insert ON %I
        FOR INSERT
        WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid
                    OR tenant_id IS NULL)
    $p$, t);

    -- UPDATE: only own rows, and the result must stay own (no promote-to-global). A tenant
    -- can neither touch a shared NULL row (USING) nor set its own row's tenant_id NULL (CHECK).
    EXECUTE format($p$
      CREATE POLICY tenant_isolation_update ON %I
        FOR UPDATE
        USING      (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
        WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
    $p$, t);

    -- DELETE: only own rows (a tenant cannot delete a shared/global row).
    EXECUTE format($p$
      CREATE POLICY tenant_isolation_delete ON %I
        FOR DELETE
        USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
    $p$, t);
  END LOOP;
END $$;
