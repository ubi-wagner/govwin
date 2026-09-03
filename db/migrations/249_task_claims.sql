-- 249 · A ToDo can be CLAIMED, and a claim can expire
--
-- ── WHAT WAS MISSING ───────────────────────────────────────────────────────────────────────────
-- `tasks.status` has allowed 'in_progress' since the table was created, `idx_tasks_nudge_sweep`
-- indexes it, and **nothing has ever written it**. Measured distribution before this migration:
--
--     open 47 · completed 65 · expired 2 · in_progress 0
--
-- So a ToDo is binary, and four things follow from that, all of them costs a person pays:
--
--   · nothing records that work was STARTED, so an interrupted task is indistinguishable from an
--     untouched one — the person who comes back cannot tell which of 47 items they had begun
--   · two people can start the same item with no signal to either
--   · an operator reading the queue cannot tell untouched from half-done
--   · and there is nowhere to come back TO, so the work restarts
--
-- The last one is the whole point. A session that ends on time — which P1 and P2 now guarantee —
-- strands MORE in-flight work than a session that never ends, so a claim is not a nicety attached
-- to the timeout work, it is the other half of it.
--
-- ── WHY A CLAIM AND NOT A LOCK ─────────────────────────────────────────────────────────────────
-- A lock asks to be released and blocks when it is not. A claim EXPIRES: the sweep returns a stale
-- one to 'open' and emits an event. That is the right shape here because the thing being protected
-- is attention, not correctness — two people drafting the same section is wasteful, whereas two
-- people holding a lock forever is an outage. Nothing about a claim can prevent work; it can only
-- say who is already doing it.
--
-- ── resume_href ────────────────────────────────────────────────────────────────────────────────
-- Where the work actually happens: the section, the solicitation, the milestone. `entity_type` +
-- `entity_id` already say WHAT the task is about, but turning that pair into a URL is a per-type
-- mapping that every reader would have to duplicate and each would drift. The writer knows the
-- destination at creation time; storing it is one string and removes the whole class.
--
-- Nullable, because a task genuinely may have nowhere to go (a broadcast, an acknowledgement) and a
-- fabricated link is worse than none — it sends a person somewhere that does not answer.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS claimed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS resume_href  text;

-- `claimed_by` and `claimed_at` are one fact and must move together. Written as a CHECK rather than
-- left to the callers, because "claimed by nobody at 10:04" and "claimed by someone at no time" are
-- both readable as claimed by one query and unclaimed by another, and both readings then ship. Same
-- shape as space_presence_closed_pair (mig 246).
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_claim_pair;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_claim_pair CHECK (
    (claimed_by IS NULL AND claimed_at IS NULL)
    OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
  );

-- The sweep's question: which claims have gone stale? Partial, because a claim on a finished task
-- is history and must never be swept.
CREATE INDEX IF NOT EXISTS idx_tasks_stale_claim
  ON tasks (claimed_at)
  WHERE status = 'in_progress' AND claimed_at IS NOT NULL;

COMMENT ON COLUMN tasks.claimed_by IS
  'Who is working on this now. Set with status=''in_progress'' by the claim route; cleared when the '
  'claim expires, is released, or the task completes. A claim is not a lock: it cannot block anyone, '
  'it only says who is already here.';

COMMENT ON COLUMN tasks.claimed_at IS
  'When the claim was taken. Read by the stale-claim sweep, which returns an abandoned claim to '
  '''open'' and emits system:task.claim_expired rather than leaving the queue asserting that '
  'somebody is working on something they were signed out of.';

COMMENT ON COLUMN tasks.resume_href IS
  'Where the work happens — the section, solicitation or milestone this ToDo points at. Stored by '
  'the writer, which knows the destination, rather than derived from entity_type/entity_id by every '
  'reader. NULL when a task genuinely has nowhere to go; a fabricated link is worse than none.';
