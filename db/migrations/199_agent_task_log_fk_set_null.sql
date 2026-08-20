-- 199_agent_task_log_fk_set_null.sql
--
-- An audit row must never keep its subject alive.
--
-- agent_task_log.proposal_id and .section_id reference proposals/proposal_sections with NO delete
-- rule, so the moment an agent touches a section that section becomes undeletable by anyone who has
-- not first hand-cleared the log:
--
--   update or delete on table "proposal_sections" violates foreign key constraint
--   "agent_task_log_section_id_fkey" on table "agent_task_log"
--
-- lib/proposal-archive.ts::hardDeleteProposalCascade — the one sanctioned hard-delete path — works
-- around this by DELETEing agent_task_log by proposal_id before it touches sections, and its own
-- comment says why the workaround exists: "the FK graph lives HERE so callers stop hand-ordering
-- DELETEs that break every time the provision fan-out grows". That is an admission that the schema
-- is the wrong shape. It also does not fully hold: a log row may carry a section_id while its
-- proposal_id is NULL or points elsewhere, and then the section DELETE still fails. That is exactly
-- how this surfaced — scripts/seed_e2e_fixtures.mjs resets fixture sections and started failing once
-- the section_drafter had written log rows against them, which broke the driven suite's seed.
--
-- Both columns are already NULLABLE, so ON DELETE SET NULL is available and is the right semantic
-- for a log: keep the record that an agent did work, drop the pointer to a row that no longer
-- exists. The sanctioned cascade still deletes these rows explicitly first, so its behaviour is
-- unchanged — the FK simply stops being a landmine for every other caller.
--
-- tenant_id is deliberately LEFT ALONE. Tenants are never hard-deleted (docs/ARCHIVABLE_CONTRACT.md
-- — a tenant archives into licence slumber), and CASCADE there would quietly destroy agent audit
-- history the one time someone did remove a tenant. A constraint that blocks is correct when the
-- delete itself should not be happening.

ALTER TABLE agent_task_log DROP CONSTRAINT IF EXISTS agent_task_log_section_id_fkey;
ALTER TABLE agent_task_log
  ADD CONSTRAINT agent_task_log_section_id_fkey
  FOREIGN KEY (section_id) REFERENCES proposal_sections(id) ON DELETE SET NULL;

ALTER TABLE agent_task_log DROP CONSTRAINT IF EXISTS agent_task_log_proposal_id_fkey;
ALTER TABLE agent_task_log
  ADD CONSTRAINT agent_task_log_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE SET NULL;
