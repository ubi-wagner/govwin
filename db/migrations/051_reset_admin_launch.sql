-- Migration 051: Reset admin account for HITL launch
-- Ensures eric.c.wagner@gmail.com exists as master_admin with known credentials.
-- Password: GovWin2026!

INSERT INTO users (email, name, role, password_hash, is_active, temp_password)
VALUES (
  'eric.c.wagner@gmail.com',
  'Eric Wagner',
  'master_admin',
  '$2a$12$k71Hi5xcgVugUU5xrV1KYOVc3YVknPUqfzFM5SAurJXQgOcaVFAyS',
  true,
  false
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = 'master_admin',
  is_active = true,
  temp_password = false;
