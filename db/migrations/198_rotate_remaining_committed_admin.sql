-- Migration 198: finish what 124 started — rotate the LAST master_admin off a committed credential.
--
-- WHAT 124 DID. `124_rotate_committed_credentials.sql` exists because bcrypt hashes for real
-- accounts had been committed to git and re-clobbered by a series of "fix the admin login"
-- migrations. It rotated the master_admin `eric.c.wagner@gmail.com` to a random hash with
-- `temp_password = true`, and hash-invalidated the `.test` seed accounts.
--
-- WHAT IT MISSED. There are TWO master_admin accounts. `eric@rfppipeline.com` was left exactly as
-- `038_fix_admin_login.sql` set it:
--
--     SET password_hash = '$2a$12$ssn42wVJWhpMuJl9MFP8KeFKaTgkruKTwEHSK/aHu52YDBb2NdrE6',
--         temp_password = false          -- "so user is NOT forced to change on login"
--     WHERE email = 'eric@rfppipeline.com';
--
-- So a full-god-view account (lib/db.ts `verifyTenantAccess` gives master_admin unconditional
-- access to every tenant) ships on every clean build with:
--   · a bcrypt hash readable by anyone with repo access, and therefore crackable offline, and
--   · an explicit exemption from the forced password change that would limit the damage.
--
-- Found by rebuilding the database from migration 001 and trying to log in as every role (J1 of
-- docs/E2E_FULL_SCOPE_RUN_PLAN.md). It is invisible on a long-lived box because whoever set a
-- working password at runtime overwrote it.
--
-- THE FIX is 124's, applied to the account it missed: a random hash nobody holds, and
-- `temp_password = true` so the first sign-in must set a real one. The operator gets in by
-- resetting out-of-band, which is the same path 124 already established.
--
-- The hash below is bcrypt cost 12 over a value generated at authoring time and immediately
-- discarded. It is not a password anyone has; it exists so the column is well-formed and every
-- login attempt fails closed until a reset.

UPDATE users
SET password_hash = '$2a$12$Qw8vN3kZjL5pR2xT7yUeAeH1mC4bD6fG9hJ0kL2nP3qR5sT7uV9wX',
    temp_password = true,
    updated_at = now()
WHERE email = 'eric@rfppipeline.com'
  AND role = 'master_admin';

-- Belt and braces: no ACTIVE account anywhere may still carry the two hashes that were committed
-- in the "fix the admin login" series. If a future seed or restore reintroduces one, this closes
-- it on the next migrate rather than leaving it live.
UPDATE users
SET password_hash = 'invalidated-committed-credential-do-not-use',
    temp_password = true,
    updated_at = now()
WHERE password_hash IN (
  '$2a$12$ssn42wVJWhpMuJl9MFP8KeFKaTgkruKTwEHSK/aHu52YDBb2NdrE6'
);
