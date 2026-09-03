-- 248 · space_presence.last_interaction_at — separating "the tab is open" from "a person is working"
--
-- ── WHAT THIS FIXES ────────────────────────────────────────────────────────────────────────────
-- `space_presence` has ONE liveness column, `last_seen_at`, and two different things advance it:
--
--   · a request a PERSON caused — a page render inside the customer's workspace, an action, a save
--   · `PresenceHeartbeat`, a 2-minute client timer that fires while the tab is merely VISIBLE
--
-- The heartbeat was added for a good reason (the App Router does not re-run a shared layout on a
-- soft navigation, so an actor could work for the whole idle window without the layout running once,
-- and the sweep would write a false departure into that customer's trail). But collapsing both
-- signals into one column means an unattended tab on a lit monitor is indistinguishable from an
-- administrator at their desk. Measured consequence: the bracket never times out, and — because the
-- heartbeat route calls auth() — the SESSION never expires either. The component built to detect an
-- idle outside actor was the thing preventing their timeout.
--
-- So: two columns, two questions.
--
--   last_seen_at         is this tab still there?      advanced by the heartbeat AND by interaction
--   last_interaction_at  is a person still working?    advanced ONLY by a request a person caused
--
-- The sweep keeps reading `last_seen_at`: a closed tab should still close the bracket, and that
-- behaviour is correct and stays. The DESCENT GATE reads `last_interaction_at`, which is what makes
-- "you have been idle in this customer's workspace, re-enter to continue" possible at all.
--
-- ── WHY IT BACKFILLS TO last_seen_at RATHER THAN now() ────────────────────────────────────────
-- An open bracket today has a `last_seen_at` that means "seen, by either signal". Backfilling to
-- now() would silently grant every currently-open bracket a fresh idle window at deploy time, which
-- is the wrong direction for a control whose whole purpose is to expire them. Backfilling to
-- `last_seen_at` is the honest reading: it is the most recent moment we have any evidence for, and
-- for brackets opened before this migration those two facts genuinely were the same fact.
--
-- NOT NULL with a default, because a nullable liveness column invites `IS NULL` to be read as
-- "never idle" by one caller and "infinitely idle" by another, and both readings ship.

ALTER TABLE space_presence
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz;

UPDATE space_presence
   SET last_interaction_at = COALESCE(last_seen_at, entered_at)
 WHERE last_interaction_at IS NULL;

ALTER TABLE space_presence
  ALTER COLUMN last_interaction_at SET DEFAULT now();

ALTER TABLE space_presence
  ALTER COLUMN last_interaction_at SET NOT NULL;

COMMENT ON COLUMN space_presence.last_seen_at IS
  'Tab liveness. Advanced by PresenceHeartbeat (a 2-minute client timer on a visible tab) AND by '
  'person-driven requests. Read by sweepStalePresence, which closes a bracket whose tab is gone.';

COMMENT ON COLUMN space_presence.last_interaction_at IS
  'Person liveness. Advanced ONLY by a request a person caused, never by the heartbeat. Read by the '
  'descent idle gate, which refuses an outside actor who has stopped working inside a customer''s '
  'workspace even though their tab is still open. Splitting this from last_seen_at is what stops an '
  'unattended visible tab holding a descent — and a session — open indefinitely.';

-- The gate asks "which open brackets have gone idle", so the partial index matches that predicate.
CREATE INDEX IF NOT EXISTS idx_space_presence_interaction
  ON space_presence (last_interaction_at)
  WHERE closed_at IS NULL;
