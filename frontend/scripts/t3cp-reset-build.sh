#!/usr/bin/env bash
# Test-fixture reset: drop the provisioned T3CP portal + proposal so the spine drive re-runs
# purchase → release → provision for real. Fixture only — never a product path.
#
# ON_ERROR_STOP is essential. Without it psql runs every statement, aborts the transaction on the
# first foreign-key failure, ignores the rest, exits 0, and the script prints "reset <id>" while
# the proposal is still there. The spine drive then quietly REUSES the old proposal via its
# already-purchased branch, and a run that proves nothing looks like a run that passed. That
# happened: a missing proposal_activity_log delete made three consecutive "fresh provision" runs
# fixtures of the previous one.
#
# The delete list is every table with a foreign key onto proposals / proposal_sections /
# proposal_artifacts, in dependency order. Re-derive it after adding such a table with:
#   SELECT c.conrelid::regclass, c.confrelid::regclass FROM pg_constraint c WHERE c.contype='f'
#     AND c.confrelid IN ('proposals'::regclass,'proposal_sections'::regclass,'proposal_artifacts'::regclass);
set -euo pipefail
PROP="${1:?proposal id}"
OPP="${OPP:-2e96f788-0798-42d3-b8ef-361e35a2219a}"
TENANT_SLUG="${TENANT_SLUG:-immobileyes}"
export PGPASSWORD=changeme

psql -v ON_ERROR_STOP=1 -h localhost -U govtech -d govtech_intel -q <<SQL
BEGIN;
-- children of proposal_sections
DELETE FROM proposal_activity_log WHERE section_id IN (SELECT id FROM proposal_sections WHERE proposal_id = '$PROP'::uuid);
DELETE FROM canvas_versions      WHERE section_id IN (SELECT id FROM proposal_sections WHERE proposal_id = '$PROP'::uuid);
DELETE FROM proposal_comments    WHERE section_id IN (SELECT id FROM proposal_sections WHERE proposal_id = '$PROP'::uuid);
DELETE FROM agent_task_log       WHERE section_id IN (SELECT id FROM proposal_sections WHERE proposal_id = '$PROP'::uuid);
DELETE FROM agent_task_results   WHERE task_id IN (SELECT id FROM agent_task_queue WHERE proposal_id = '$PROP'::uuid);
DELETE FROM agent_task_queue     WHERE section_id IN (SELECT id FROM proposal_sections WHERE proposal_id = '$PROP'::uuid);
-- children of proposals
DELETE FROM proposal_activity_log        WHERE proposal_id = '$PROP'::uuid;
DELETE FROM agent_task_log               WHERE proposal_id = '$PROP'::uuid;
DELETE FROM agent_task_queue             WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_comments            WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_compliance_matrix   WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_supporting_docs     WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_amendment_flags     WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_collaborators       WHERE proposal_id = '$PROP'::uuid;
DELETE FROM collaborator_stage_access    WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_stage_history       WHERE proposal_id = '$PROP'::uuid;
DELETE FROM stage_completion_snapshots   WHERE proposal_id = '$PROP'::uuid;
DELETE FROM stage_gate_requirements      WHERE proposal_id = '$PROP'::uuid;
DELETE FROM library_seed_jobs            WHERE proposal_id = '$PROP'::uuid;
DELETE FROM contracts                    WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_sections            WHERE proposal_id = '$PROP'::uuid;
DELETE FROM proposal_artifacts           WHERE proposal_id = '$PROP'::uuid;
DELETE FROM process_instances            WHERE payload->>'proposalId' = '$PROP';
DELETE FROM purchases        WHERE opportunity_id = '$OPP'::uuid AND tenant_id = (SELECT id FROM tenants WHERE slug='$TENANT_SLUG');
DELETE FROM proposal_portals WHERE opportunity_id = '$OPP'::uuid AND tenant_id = (SELECT id FROM tenants WHERE slug='$TENANT_SLUG');
DELETE FROM proposals        WHERE id = '$PROP'::uuid;
COMMIT;
SQL

# Prove it. A reset that did not delete the proposal must fail loudly, or the next drive silently
# reuses it and reports success on stale state.
LEFT=$(psql -tAq -h localhost -U govtech -d govtech_intel -c "SELECT count(*) FROM proposals WHERE id = '$PROP'::uuid")
if [ "$LEFT" != "0" ]; then
  echo "reset FAILED — proposal $PROP still present" >&2
  exit 1
fi
echo "reset $PROP"
