-- 251 · Who asked for this agent work?
--
-- ── THE QUESTION THAT COULD NOT BE ANSWERED ────────────────────────────────────────────────────
-- `agent_task_queue` records the tenant, the archetype, the proposal and the section — and never
-- who ASKED. Every row looks the same whether a person pressed a button, a workflow step fired, or
-- a scheduled sweep queued it.
--
-- That was tolerable while a stuck task was invisible anyway. It stopped being tolerable when the
-- reaper (P4) started failing abandoned work and emitting `tool:agent.task_abandoned`: the event
-- can now say WHICH task was dropped, for which customer, and still cannot say whose action it was
-- — so the one person who could decide whether to re-run it is the one person the record does not
-- name. An audit trail that reaches a dead end at the most important question is a log, not a trail.
--
-- ── TWO COLUMNS, TWO DIFFERENT FACTS ───────────────────────────────────────────────────────────
--   requested_by  the PERSON whose action put this in the queue. NULL when nothing human did —
--                 a scheduled sweep, a workflow step advancing on its own. NULL is a real answer
--                 here and must not be faked with a service account, which would make automated
--                 work indistinguishable from a person's and put a name on a decision nobody made.
--   source_task_id the ToDo it came from, when there was one. This is what lets an abandoned agent
--                 task be reconnected to the human queue item still sitting in somebody's list —
--                 without it, the ToDo waits forever on work that already failed.
--
-- ON DELETE SET NULL on both: losing a user or a ToDo must not delete the record of what the agent
-- did. The same reasoning as project_deliverables.document_id — the obligation outlives the link.

ALTER TABLE agent_task_queue
  ADD COLUMN IF NOT EXISTS requested_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

-- The reaper's question: which abandoned rows belong to whom. Partial, because attribution is only
-- ever asked of rows that HAVE an issuer, and the vast majority of historical rows do not.
CREATE INDEX IF NOT EXISTS idx_agent_task_queue_requested_by
  ON agent_task_queue (requested_by, created_at DESC)
  WHERE requested_by IS NOT NULL;

COMMENT ON COLUMN agent_task_queue.requested_by IS
  'The person whose action queued this. NULL when no human did — a schedule, or a workflow step '
  'advancing itself. NULL is a real answer and is deliberately not filled with a service account: '
  'automated work must stay distinguishable from a person''s, and a name on a decision nobody made '
  'is worse than no name.';

COMMENT ON COLUMN agent_task_queue.source_task_id IS
  'The ToDo this agent work was queued for, when there was one. Lets an abandoned agent task be '
  'reconnected to the human queue item still waiting on it — otherwise that ToDo waits forever on '
  'work that already failed.';
