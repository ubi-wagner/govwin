#!/usr/bin/env bash
# Reset to a MINIMAL start: schema + platform config only. Everything a user could compose is
# removed, so the midterm drive has to create it through the UI.
#
# WHY NOT JUST MIGRATE. `ALLOW_SCHEMA_RESET=true migrate.mjs` rebuilds from 001 — and the
# migrations themselves seed a demo world (7 tenants, 43 opportunities, 540 atoms). Starting there
# means the drive "verifies" seed data wearing the costume of an outcome. This strips that.
#
# WHAT SURVIVES, and why each is structural rather than composed:
#   automation_rules · document_templates · source_profiles · content_pages   platform config
#   the rfp-pipeline house tenant + its system_starter atoms                  a copy-forward SOURCE
#                                                                             SHELF tenants copy
#                                                                             from (CLAUDE.md), not
#                                                                             tenant state
#   master_admin users                                                        you cannot drive a UI
#                                                                             without a way in
#
# HOW THE DELETE IS ORDERED. 28 of the 40 foreign keys into `tenants` are NO ACTION, so a naive
# delete fails on ordering. Rather than hand-maintain a dependency list that rots, this drops FK
# enforcement for the transaction (session_replication_role=replica, owner-only), deletes, and then
# runs an ORPHAN SWEEP that removes any row whose tenant_id no longer resolves. The sweep is what
# makes bypassing the triggers safe, and it reports what it removed.
#
#   source scripts/sandbox-env.sh && scripts/reset-minimal.sh
set -uo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL_OWNER:?source scripts/sandbox-env.sh first}"
KEEP_TENANT="${KEEP_TENANT:-rfp-pipeline}"

echo "── rebuilding schema from 001 ──"
ALLOW_SCHEMA_RESET=true DATABASE_URL="$DATABASE_URL_OWNER" node db/migrations/migrate.mjs 2>&1 | tail -1

echo "── stripping composed data ──"
psql "$DATABASE_URL_OWNER" -X -v ON_ERROR_STOP=1 -v keep="$KEEP_TENANT" <<'SQL'
\set QUIET on
BEGIN;
SET LOCAL session_replication_role = replica;   -- FK triggers off; the orphan sweep below is the guard

CREATE TEMP TABLE _keep AS SELECT id FROM tenants WHERE slug = :'keep';

-- Every table carrying a tenant_id: drop the rows belonging to a doomed tenant.
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
    WHERE c.table_schema='public' AND c.column_name='tenant_id'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'DELETE FROM %I WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM _keep)',
      r.table_name);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN RAISE NOTICE 'tenant-scoped  % (%)', r.table_name, n; END IF;
  END LOOP;
  RAISE NOTICE 'tenant-scoped rows removed: %', total;
END $$;

-- Platform-scope things a user composes: the opportunity supply and its whole downstream.
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'proposal_sections','canvas_versions','proposal_compliance_matrix','proposal_portals','proposals',
    'tenant_opportunity_cards','tenant_bucket_scores','tenant_spotlight_buckets',
    'opportunity_bridge','solicitation_compliance','solicitation_compliance_drafts',
    'solicitation_documents','solicitation_amendments','curated_solicitations','opportunities',
    'scout_findings','scout_runs','applications','purchases','tasks','process_instances',
    'agent_task_queue','agent_task_results','system_events','episodic_memories','contracts'
  ]) AS table_name
  LOOP
    IF to_regclass('public.'||r.table_name) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I', r.table_name);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN RAISE NOTICE 'composed       % (%)', r.table_name, n; END IF;
    END IF;
  END LOOP;
END $$;

-- The tenants themselves, then anyone who is not a platform operator.
DELETE FROM tenants WHERE id NOT IN (SELECT id FROM _keep);
DELETE FROM users   WHERE role <> 'master_admin' OR tenant_id IS NOT NULL;

-- ORPHAN SWEEP — the guard that makes replica mode safe. Any row still pointing at a tenant that
-- no longer exists is removed and reported; silence here means the strip was clean.
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
    WHERE c.table_schema='public' AND c.column_name='tenant_id'
  LOOP
    EXECUTE format(
      'DELETE FROM %I x WHERE x.tenant_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = x.tenant_id)', r.table_name);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN RAISE WARNING 'ORPHANS SWEPT  % (%)', r.table_name, n; END IF;
  END LOOP;
  RAISE NOTICE 'orphans swept: %', total;
END $$;

COMMIT;
\set QUIET off
SQL

echo "── what is left ──"
psql "$DATABASE_URL_OWNER" -X -c "
SELECT 'tenants' k, count(*)::text v FROM tenants
UNION ALL SELECT 'users (master_admin)', count(*)::text FROM users
UNION ALL SELECT 'opportunities',        count(*)::text FROM opportunities
UNION ALL SELECT 'curated_solicitations',count(*)::text FROM curated_solicitations
UNION ALL SELECT 'opportunity_cards',    count(*)::text FROM tenant_opportunity_cards
UNION ALL SELECT 'proposals',            count(*)::text FROM proposals
UNION ALL SELECT 'applications',         count(*)::text FROM applications
UNION ALL SELECT 'tasks',                count(*)::text FROM tasks
UNION ALL SELECT '· config ·',           ''
UNION ALL SELECT 'starter atoms (house)',count(*)::text FROM library_atoms
UNION ALL SELECT 'automation_rules',     count(*)::text FROM automation_rules
UNION ALL SELECT 'document_templates',   count(*)::text FROM document_templates
UNION ALL SELECT 'source_profiles',      count(*)::text FROM source_profiles
UNION ALL SELECT 'content_pages',        count(*)::text FROM content_pages;"

echo "── restoring the operator password (migrations leave it on a hash nobody holds) ──"
( cd frontend && node ../scripts/sandbox-reset-passwords.mjs 2>&1 | tail -2 )
