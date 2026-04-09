-- 006_normalize_user_emails.sql
--
-- Defense-in-depth for the case-normalization contract between
-- frontend/auth.ts and the users.email column.
--
-- auth.ts:38 lowercases and trims the email at query time:
--
--   WHERE email = ${email.toLowerCase().trim()}
--
-- If any insertion path into `users` stores a mixed-case or
-- whitespace-padded email (a future invite flow forgetting to
-- normalize, a direct SQL insert, a script that reads ADMIN_EMAIL
-- from an env var without lowercasing), the login lookup will
-- silently fail to match and the affected user will see "Invalid
-- email or password" even with correct credentials.
--
-- This migration adds a BEFORE INSERT/UPDATE trigger on `users`
-- that normalizes the email column server-side, so code callers
-- don't need to remember. Also backfills any existing mixed-case
-- rows.
--
-- Idempotent:
--   - The UPDATE only touches rows that actually need normalization
--     (WHERE email != lower(trim(email))). On fresh deploys where
--     every row is already lowercase, the UPDATE affects zero rows.
--   - The trigger uses DROP TRIGGER IF EXISTS before CREATE, so
--     re-running the migration is safe.
--   - The function uses CREATE OR REPLACE FUNCTION so it can be
--     redefined without conflict.

-- Step 1: backfill existing rows (no-op on fresh deploys).
UPDATE users
SET email = lower(trim(email))
WHERE email IS NOT NULL
  AND email != lower(trim(email));

-- Step 2: define the normalization function.
CREATE OR REPLACE FUNCTION normalize_user_email() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: attach the trigger to the users table. DROP first so
-- re-running this migration replaces the trigger cleanly.
DROP TRIGGER IF EXISTS users_normalize_email ON users;
CREATE TRIGGER users_normalize_email
  BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW
  EXECUTE FUNCTION normalize_user_email();
