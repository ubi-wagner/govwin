-- 005_bootstrap_master_admin.sql
--
-- Bootstrap the initial master_admin user so the first deployment has
-- a login. This exists because the Python seed in
-- pipeline/src/seeds/master_admin.py only inserts a row when the
-- INITIAL_MASTER_ADMIN_PASSWORD env var is set on Railway, which was
-- never set — so no admin user was ever created on first boot.
--
-- Idempotent: ON CONFLICT DO NOTHING means this is a one-time insert.
-- Once the user logs in and changes their password via /change-password,
-- subsequent runs of this migration are a no-op and never touch the row.
--
-- The bcrypt hash below was generated with bcryptjs cost 12 and
-- corresponds to the bootstrap temp password `!Wags$$`. It is meant
-- to be rotated on first login — the temp_password=true flag forces
-- the middleware to redirect to /change-password before any other
-- route is accessible.
--
-- If a future bootstrap needs to happen on a different email, create
-- a new migration 00N_bootstrap_*.sql rather than editing this file.

INSERT INTO users (email, name, role, password_hash, is_active, temp_password)
VALUES (
  'eric@rfppipeline.com',
  'Eric (Master Admin)',
  'master_admin',
  '$2a$12$tM8UzLbaFSjxViTNhC13V.fuj.G56EDgIQZh4oRbthERf9PFs2T7S',
  true,
  true
)
ON CONFLICT (email) DO NOTHING;
