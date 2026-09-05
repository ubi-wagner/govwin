-- 250 · `forced` — an operator can end somebody's presence in a customer's workspace
--
-- ── WHY A SIXTH CLOSE REASON ───────────────────────────────────────────────────────────────────
-- `/admin/workspace-access` answers "is anyone inside a customer's account right now, and for how
-- long" — and could do nothing about it. Every existing closer is something the ACTOR does, or the
-- clock doing it for them: explicit · left_space · moved · signed_out · timeout. There was no way
-- for a second person to end a presence, which is the one thing an operator looking at that page
-- actually wants when they see a bracket that should not be open.
--
-- ── WHY IT IS A COOLDOWN AND NOT A BAN ─────────────────────────────────────────────────────────
-- An rfp_admin has nothing to ascend FROM: `isShadowAdmin` is computed per render as "is an admin
-- and is not a member here", so being on the URL *is* the descent. Closing the bracket alone evicts
-- the RECORD and not the ACTOR — their next portal render calls `syncPortalPresence` and simply
-- opens a new one.
--
-- A flag cleared only by the explicit door (`/api/admin/shadow-transition`) would not hold either,
-- because the portal layout opens on render and bypasses that door entirely.
--
-- So the honest mechanism is TIME: while the most recent bracket for this (user, tenant) is closed
-- as `forced` and still inside the cooldown, the descent gate refuses. It is deliberately not a
-- permanent revocation — that would need a real grant model and an un-ban surface, and an operator
-- silently holding a permanent block is worse than one holding a visible thirty minutes.
--
-- `timeout` is NOT reused for this. "The clock ended it" and "a named person ended it" are different
-- facts, and the customer's audit trail is the place that difference matters most.

ALTER TABLE space_presence
  DROP CONSTRAINT IF EXISTS space_presence_close_reason_check;

ALTER TABLE space_presence
  ADD CONSTRAINT space_presence_close_reason_check
  CHECK (close_reason = ANY (ARRAY[
    'explicit'::text,     -- the actor pressed exit
    'left_space'::text,   -- the actor turned up on their own console
    'moved'::text,        -- the actor entered a different company
    'timeout'::text,      -- the idle sweep, or the descent gate
    'signed_out'::text,   -- the session ended
    'forced'::text        -- another operator ended it (mig 250)
  ]));

COMMENT ON COLUMN space_presence.close_reason IS
  'How the presence ended. Five of the six are the actor or the clock; `forced` is the only one '
  'caused by a DIFFERENT person, and it is what /admin/workspace-access uses to eject somebody from '
  'a customer''s workspace. It works as a cooldown rather than a ban: the descent gate refuses while '
  'the latest bracket is `forced` and still inside the window, because an rfp_admin has no descent '
  'flag to clear — being on the URL is the descent, so closing the row alone evicts the record and '
  'not the actor.';
