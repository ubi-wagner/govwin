-- 254 · `govtech_app` can LOGIN — the half of the RLS cutover that lived only in a runbook
--
-- ── WHAT THIS FIXES ────────────────────────────────────────────────────────────────────────────
-- Migration 094 creates the application role `NOLOGIN`, and every migration since has left it that
-- way. That was deliberate: a role's PASSWORD cannot live in schema, so the role was created inert
-- and prod was expected to supply the credential by env. What nobody wrote down is that a password
-- alone does not make a role usable — LOGIN is a separate attribute, and `\password` does not grant
-- it.
--
-- The cost of that gap, measured on production 2026-09-05:
--
--     railway=# \password govtech_app          -- prompted twice, no error
--     railway=# SELECT rolcanlogin FROM pg_roles WHERE rolname='govtech_app';
--      f                                       -- still cannot connect
--
-- Read literally, the operator had just "set the password" and the role was still unusable, with no
-- error anywhere to say so. Pointing the app at it would have produced
-- `role "govtech_app" is not permitted to log in` on the next boot — a message that arrives at
-- deploy time, in a crash-loop, rather than at the moment the mistake was made.
--
-- LOGIN without a password authenticates NOTHING under scram-sha-256, so granting it here is inert
-- on its own. What it removes is a step that has to be remembered, in a procedure that is run once
-- per environment and then not again for months.
--
-- ── WHY THIS IS NOT A SECURITY WIDENING ────────────────────────────────────────────────────────
-- The role still has no password until someone sets one out of band, and it remains NOBYPASSRLS
-- with the same grants migration 136 gave it. A role that can log in but has no credential is
-- exactly as reachable as one that cannot log in at all. The privilege boundary is unchanged; only
-- the operator's error surface is.
--
-- ── THE ASSERTION, AND WHY IT WARNS RATHER THAN RAISES ─────────────────────────────────────────
-- `rolsuper` or `rolbypassrls` on this role would silently disable row-level security for every
-- customer request — the app would serve normally, every isolation drive would pass, and the
-- database layer would simply not be engaged. That is bug B86's shape, and it is the failure this
-- whole cutover exists to close.
--
-- It WARNS rather than RAISEs on purpose. `entrypoint.sh` runs migrations under `set -e`, so an
-- exception here crash-loops the deploy — and the condition it would fire on (someone granted the
-- app role superuser on a dev box) is a misconfiguration to shout about, not a reason to refuse to
-- start a production container that is otherwise fine. The gate for that belongs in the health
-- endpoint, where it can report without bricking a boot.
--
-- Idempotent: re-running re-asserts the same end state and says nothing.

DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT rolcanlogin, rolsuper, rolbypassrls INTO r
    FROM pg_roles WHERE rolname = 'govtech_app';

  IF NOT FOUND THEN
    -- Migration 094 creates it. If it is absent, the migration order is broken, not the role.
    RAISE WARNING '254: role govtech_app does not exist — expected it from migration 094. Skipping.';
    RETURN;
  END IF;

  IF NOT r.rolcanlogin THEN
    EXECUTE 'ALTER ROLE govtech_app LOGIN';
    RAISE NOTICE '254: granted LOGIN to govtech_app (no password is set by this migration).';
  ELSE
    RAISE NOTICE '254: govtech_app already has LOGIN — nothing to do.';
  END IF;

  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE WARNING
      '254: govtech_app has rolsuper=% rolbypassrls=% — ROW-LEVEL SECURITY IS BYPASSED for every '
      'request this role serves. The app would look completely normal and enforce no database-level '
      'tenant isolation. Fix with: ALTER ROLE govtech_app NOSUPERUSER NOBYPASSRLS;',
      r.rolsuper, r.rolbypassrls;
  END IF;
END $$;
