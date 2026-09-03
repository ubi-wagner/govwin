-- 247 · `signed_out` — the fifth way a space-presence bracket closes.
--
-- Mig 246 named four: `explicit` (they pressed exit), `left_space` (they turned up outside any
-- tenant), `moved` (they turned up inside a different one) and `timeout` (the sweep closed what
-- nobody did). All four are things the person did INSIDE the product.
--
-- Signing out is not one of them. It ends the session from anywhere — including from inside a
-- customer's workspace, which is precisely where it matters: the actor is gone, immediately and
-- unambiguously, and every bracket they hold is over in that instant. Waiting up to an idle period
-- for the sweep to notice would leave a customer's trail saying an administrator was in their
-- workspace at a moment when they had demonstrably logged out.
--
-- It is a SEPARATE reason rather than a reuse of `timeout` because they mean different things to
-- the person reading the trail six months later: "they signed out" is a fact, "we stopped seeing
-- them" is an inference. Collapsing the two would make every certain departure look like a guess.
--
-- Session EXPIRY deliberately does NOT get its own reason. Nothing fires when a JWT quietly
-- expires — there is no request to observe — so the only honest record is the sweep's `timeout`,
-- which is exactly what it means: we stopped seeing them. Inventing an `expired` reason would
-- assert a moment nobody measured.
--
-- Idempotent: drops the old CHECK by name and re-adds it widened.

ALTER TABLE space_presence DROP CONSTRAINT IF EXISTS space_presence_close_reason_check;
ALTER TABLE space_presence ADD CONSTRAINT space_presence_close_reason_check
  CHECK (close_reason IN ('explicit', 'left_space', 'moved', 'timeout', 'signed_out'));
