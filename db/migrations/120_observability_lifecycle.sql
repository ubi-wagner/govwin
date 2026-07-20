-- 120_observability_lifecycle.sql
--
-- Cross-board "stateless-but-observable" contract (One Brain, two spines, a bridge):
-- give the audit tables a real START→FINALIZE lifecycle so an in-flight — or crashed —
-- operation is reconstructable from the DB with zero in-memory state. Pairs with the
-- namespaced :start/:end event emission added across the fabric + automation engines.
--
-- Idempotent.

-- 1. automation_log: WIDEN the status vocabulary. The frontend engine (lib/automation/
--    triggers.ts) writes 'deferred' and 'error', NEITHER allowed by the old CHECK
--    ('success','failed','skipped') → the INSERT threw and was swallowed, so EVERY
--    non-success frontend automation outcome persisted NO ROW (silent audit loss; a
--    deferred/failed/crashed rule fire left nothing in the DB). Add 'running' (the
--    start-row state), 'deferred', and 'error'.
ALTER TABLE automation_log DROP CONSTRAINT IF EXISTS automation_log_status_check;
ALTER TABLE automation_log ADD CONSTRAINT automation_log_status_check
  CHECK (status = ANY (ARRAY[
    'running', 'success', 'failed', 'skipped', 'deferred', 'error'
  ]));

-- 2. agent_task_log: add a LIFECYCLE. Today it is a single TERMINAL insert (only
--    created_at + error) — an agent that is in-flight, or that crashes between its
--    tool:agent.invoked:start event and the terminal insert, leaves NO row at all, so
--    its run state is not reconstructable. Add status + started_at + completed_at +
--    guardrail_decision; the fabric now inserts a 'running' row at start and finalizes
--    it at end. Backfill existing terminal rows (error IS NULL → completed, else failed).
--    Intentionally NO CHECK on status — keep the vocabulary open so the fabric can add
--    states without a migration (the very trap automation_log fell into above).
ALTER TABLE agent_task_log ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE agent_task_log ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE agent_task_log ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE agent_task_log ADD COLUMN IF NOT EXISTS guardrail_decision text;

UPDATE agent_task_log
   SET status = CASE WHEN error IS NULL THEN 'completed' ELSE 'failed' END
 WHERE status IS NULL;

-- A running-agent sweep can find abandoned invocations (started, never finalized).
CREATE INDEX IF NOT EXISTS idx_agent_task_log_running
  ON agent_task_log (started_at) WHERE status = 'running';
