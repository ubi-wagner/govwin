#!/usr/bin/env bash
# Test-fixture reset: drop the provisioned T3CP portal + proposal so the spine drive re-runs
# purchase → release → provision for real. Fixture only — never a product path.
set -euo pipefail
PROP="${1:?proposal id}"
OPP=2e96f788-0798-42d3-b8ef-361e35a2219a
export PGPASSWORD=changeme
psql -h localhost -U govtech -d govtech_intel -q <<SQL
BEGIN;
DELETE FROM agent_task_log WHERE proposal_id = '$PROP'::uuid;
DELETE FROM agent_task_results WHERE task_id IN (SELECT id FROM agent_task_queue WHERE proposal_id = '$PROP'::uuid);
DELETE FROM agent_task_queue WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_comments WHERE proposal_id = '$PROP'::uuid;
DELETE FROM canvas_versions WHERE section_id IN (SELECT id FROM proposal_sections WHERE proposal_id = '$PROP'::uuid);
DELETE FROM proposal_compliance_matrix WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_supporting_docs WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_sections WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_artifacts WHERE proposal_id = '$PROP'::uuid;
DELETE FROM process_instances WHERE payload->>'proposalId' = '$PROP';
DELETE FROM purchases WHERE opportunity_id = '$OPP'::uuid AND tenant_id = (SELECT id FROM tenants WHERE slug='immobileyes');
DELETE FROM proposal_portals WHERE opportunity_id = '$OPP'::uuid AND tenant_id = (SELECT id FROM tenants WHERE slug='immobileyes');
DELETE FROM proposals WHERE id = '$PROP'::uuid;
COMMIT;
SQL
echo "reset $PROP"
