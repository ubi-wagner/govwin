-- =============================================================================
-- Migration 048: Fix test account credentials
-- Depends on: 041 (seed test accounts)
--
-- Problem: Pipeline's seed_master_admin.py may have created the admin user
-- with a random password + temp_password=true BEFORE migration 041 ran.
-- Migration 041 used ON CONFLICT DO NOTHING, so the documented TestAdmin2026!
-- password was never written.
--
-- Fix: Unconditionally overwrite password_hash and temp_password for all
-- seeded test accounts to match the documented HITL credentials.
--
-- ALL PASSWORDS WILL BE CHANGED AT LAUNCH — no security concern.
-- =============================================================================

-- eric.c.wagner@gmail.com → TestAdmin2026!
UPDATE users SET
  password_hash = '$2b$12$3OrhHRfX7ipdRKLAQQQX1OK4opoS04zAzfyA.kJpMJoP4rjYdrHjC',
  temp_password = false,
  is_active = true
WHERE email = 'eric.c.wagner@gmail.com';

-- admin@apexdefense.test → TestCustomer2026!
UPDATE users SET
  password_hash = '$2b$12$7irrAI9BX1sOSZLPKEzt/eXH45pPRKRkbCmxD.jTM163ftkXiDcJO',
  temp_password = false,
  is_active = true
WHERE email = 'admin@apexdefense.test';

-- james@apexdefense.test → TestEmployee2026!
UPDATE users SET
  password_hash = '$2b$12$qBIXiSUCUhI1kw5tbACDZeIiEM5AupaFP/mhqmBA1DWU5Bsw5C38u',
  temp_password = false,
  is_active = true
WHERE email = 'james@apexdefense.test';

-- partner@techalliance.test → TestPartner2026!
UPDATE users SET
  password_hash = '$2b$12$RjseW95gv0NKiMb5um0JhuCDLTtFCJqWE6499pl9wsBzaEOHPluL6',
  temp_password = false,
  is_active = true
WHERE email = 'partner@techalliance.test';
