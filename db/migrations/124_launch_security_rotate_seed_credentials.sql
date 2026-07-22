-- 124_launch_security_rotate_seed_credentials.sql
--
-- SECURITY BLOCKER FIX. Prior seed/reset migrations committed KNOWN plaintext passwords
-- into git for the production master_admin and for test accounts, and re-clobbered them via
-- ON CONFLICT DO UPDATE:
--   • 051_reset_admin_launch.sql — master_admin eric.c.wagner@gmail.com = 'GovWin2026!'
--   • 041_seed_test_accounts.sql — admin@apexdefense.test / james@apexdefense.test /
--     partner@techalliance.test (+ the apex-defense test tenant)
-- master_admin is unconditional god-view over every tenant (lib/db.ts verifyTenantAccess),
-- so a repo-readable password = full multi-tenant compromise.
--
-- This migration sorts AFTER 041/051, so on ANY fresh apply it WINS the ON-CONFLICT race and
-- leaves the credentials neutralized:
--   1. The real master_admin is rotated to a NEW strong random password whose bcrypt hash is
--      below. Only the hash is in source (bcrypt is one-way); the plaintext was delivered to
--      the account owner out-of-band. temp_password=true forces a change on first login.
--   2. The *.test seed accounts are DEACTIVATED (never hard-deleted — access off, history
--      kept) and their known hashes invalidated (a non-bcrypt string can never match).
--   3. The apex-defense TEST tenant is archived so it drops out of company/login lists.
-- Idempotent: re-running re-asserts the same end state.

-- 1. Rotate the real master_admin off the committed 'GovWin2026!' credential.
UPDATE users
SET password_hash = '$2a$12$05z1E/tO2oIV8xP2fSnyk.K0ypchgTbHe4IMG8mL.zYuVOb3qa2Q6',
    temp_password = true,
    is_active = true
WHERE email = 'eric.c.wagner@gmail.com';

-- 2. Deactivate + neutralize the committed test accounts.
UPDATE users
SET is_active = false,
    password_hash = 'invalidated-seed-account-do-not-use'
WHERE email IN ('admin@apexdefense.test', 'james@apexdefense.test', 'partner@techalliance.test');

-- 3. Archive the test tenant (reversible; drops out of getActiveMemberships).
UPDATE tenants
SET archived_at = now()
WHERE slug = 'apex-defense' AND archived_at IS NULL;
