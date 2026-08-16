-- drive-copy-inward-isolation.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Live proof of the "Sharing is copy-inward only — no cross-tenant shared objects"
-- invariant (task GUARDRAIL #118 / launch-readiness C7), run at the DB layer as the
-- NOBYPASSRLS `govtech_app` application role — exactly how the app connects in prod.
--
-- HOW TO RUN (sandbox; the app role is NOLOGIN by default):
--   export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'   # owner
--   psql "$DATABASE_URL" -c "ALTER ROLE govtech_app LOGIN PASSWORD 'rls_probe_pw';"
--   PGPASSWORD=rls_probe_pw psql "postgresql://govtech_app@127.0.0.1:5433/govtech_intel" \
--       -P pager=off -f frontend/scripts/drive-copy-inward-isolation.sql
--   psql "$DATABASE_URL" -c "ALTER ROLE govtech_app NOLOGIN;"                 # revert
--
-- The two tenant UUIDs below are the current Foundation-seed pair (A=foundation,
-- B=lighthouse) — retarget them if the seed changes (mirrors the drive-rls-*-fnd
-- scripts). Every WRITE probe rolls back; the seed is never mutated.
--
-- EXPECTED (all lines must hold):
--   R1 deny-all (no ctx) ............ 0 / 0 / 0
--   R2 own-tenant (ctx=A) ........... 13 / 34 / 10   (A sees ONLY its own)
--   R3 cross-tenant by forged B id .. PASS(0) ×4     (B rows invisible to A)
--   R4 RLS overrides WHERE tenant=B . PASS(0)        (a buggy filter still sees 0)
--   W1 forge own atom -> tenant B ... BLOCKED [42501] (WITH CHECK)
--   W2 update B proposal by id ...... 0 rows          (USING)
--   W3 delete B atom by id .......... 0 rows          (USING)
--   [post-mig-184 document_templates shared-catalog lock]
--   P1 read global catalog (ctx=A) .. 9               (read-shared preserved)
--   P2 update global rows ........... 0 rows          (blocked; was 9 pre-184)
--   P3 delete global rows ........... 0 rows          (blocked; was 9 pre-184)
--   P4 own-tenant insert ............ 1 row           (own writes unaffected)
--   P5 mint fake global (NULL) ...... BLOCKED [42501]
-- ─────────────────────────────────────────────────────────────────────────────
\set A '17780cad-76c0-4cef-95ec-2a536bcf5c8f'
\set B 'f2f455c5-9f26-47c0-9c9e-db3db08e013b'
\set Bprop 'aab228d0-096d-46c5-b1a3-981732ae17c0'
\set Batom '86bf658f-cdca-40b0-b417-e519bc3c7aeb'
\set Bcard '623d5120-024f-4060-812a-2e5eded08fa1'

\echo '── R1 deny-all (no context) — expect 0/0/0'
SELECT (SELECT count(*) FROM proposals) AS proposals,
       (SELECT count(*) FROM library_atoms) AS atoms,
       (SELECT count(*) FROM tenant_opportunity_cards) AS cards;

\echo '── R2 own-tenant read (ctx=A) — expect 13/34/10'
BEGIN; SET LOCAL app.tenant_id = :'A';
SELECT (SELECT count(*) FROM proposals) AS a_proposals,
       (SELECT count(*) FROM library_atoms) AS a_atoms,
       (SELECT count(*) FROM tenant_opportunity_cards) AS a_cards;
COMMIT;

\echo '── R3 cross-tenant read by forged B id (ctx=A) — expect PASS on all'
BEGIN; SET LOCAL app.tenant_id = :'A';
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL('||count(*)||')' END AS r3_prop  FROM proposals               WHERE id = :'Bprop';
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL('||count(*)||')' END AS r3_atom  FROM library_atoms           WHERE id = :'Batom';
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL('||count(*)||')' END AS r3_card  FROM tenant_opportunity_cards WHERE id = :'Bcard';
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL('||count(*)||')' END AS r3_bten  FROM proposals               WHERE tenant_id = :'B';
COMMIT;

\echo '── R4 RLS overrides an explicit WHERE tenant_id=B (ctx=A) — expect PASS(0)'
BEGIN; SET LOCAL app.tenant_id = :'A';
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL('||count(*)||')' END AS r4 FROM library_atoms WHERE tenant_id = :'B';
COMMIT;

\echo '── W1 STRICT WITH CHECK: re-stamp own atom to B — expect BLOCKED'
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
DO $$ DECLARE aid uuid; n int; BEGIN
  SELECT id INTO aid FROM library_atoms WHERE tenant_id = current_setting('app.tenant_id')::uuid LIMIT 1;
  UPDATE library_atoms SET tenant_id = 'f2f455c5-9f26-47c0-9c9e-db3db08e013b' WHERE id = aid;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'W1 forge-to-B: % row(s)  >>> FINDING if >0 <<<', n;
EXCEPTION WHEN others THEN RAISE NOTICE 'W1 forge-to-B: BLOCKED [%] (expected)', SQLSTATE; END $$;
ROLLBACK;

\echo '── W2 cross-tenant UPDATE by USING: update B proposal — expect 0 rows'
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
DO $$ DECLARE n int; BEGIN
  UPDATE proposals SET title = title WHERE id = 'aab228d0-096d-46c5-b1a3-981732ae17c0';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'W2 update-B: % row(s) [expect 0]', n;
END $$;
ROLLBACK;

\echo '── W3 cross-tenant DELETE by USING: delete B atom — expect 0 rows'
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
DO $$ DECLARE n int; BEGIN
  DELETE FROM library_atoms WHERE id = '86bf658f-cdca-40b0-b417-e519bc3c7aeb';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'W3 delete-B: % row(s) [expect 0]', n;
END $$;
ROLLBACK;

\echo '── P1..P5 document_templates shared-catalog lock (mig 184)'
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
SELECT count(*) AS p1_read_global FROM document_templates;   -- expect 9
COMMIT;
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
DO $$ DECLARE n int; BEGIN
  UPDATE document_templates SET name = name WHERE tenant_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'P2 update-global: % row(s) [expect 0]', n;
EXCEPTION WHEN others THEN RAISE NOTICE 'P2 update-global: BLOCKED [%]', SQLSTATE; END $$;
ROLLBACK;
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
DO $$ DECLARE n int; BEGIN
  DELETE FROM document_templates WHERE tenant_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'P3 delete-global: % row(s) [expect 0]', n;
EXCEPTION WHEN others THEN RAISE NOTICE 'P3 delete-global: BLOCKED [%]', SQLSTATE; END $$;
ROLLBACK;
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
DO $$ DECLARE n int; BEGIN
  INSERT INTO document_templates (name, description, template_type, agency, program_type, storage_key, canvas_preset, node_count, is_system, tenant_id, created_by, metadata, canvas_document)
  SELECT 'probe-own', description, template_type, agency, program_type, storage_key, canvas_preset, node_count, false, '17780cad-76c0-4cef-95ec-2a536bcf5c8f'::uuid, created_by, metadata, canvas_document
  FROM document_templates WHERE tenant_id IS NULL LIMIT 1;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'P4 own-insert: % row(s) [expect 1]', n;
EXCEPTION WHEN others THEN RAISE NOTICE 'P4 own-insert: UNEXPECTEDLY BLOCKED [%]', SQLSTATE; END $$;
ROLLBACK;
BEGIN; SET LOCAL app.tenant_id = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
DO $$ DECLARE n int; BEGIN
  INSERT INTO document_templates (name, description, template_type, agency, program_type, storage_key, canvas_preset, node_count, is_system, tenant_id, created_by, metadata, canvas_document)
  SELECT 'probe-fake-global', description, template_type, agency, program_type, storage_key, canvas_preset, node_count, true, NULL, created_by, metadata, canvas_document
  FROM document_templates WHERE tenant_id IS NULL LIMIT 1;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'P5 mint-fake-global: % row(s)  >>> FINDING if >0 <<<', n;
EXCEPTION WHEN others THEN RAISE NOTICE 'P5 mint-fake-global: BLOCKED [%] (expected)', SQLSTATE; END $$;
ROLLBACK;
