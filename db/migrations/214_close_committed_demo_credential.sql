-- 214_close_committed_demo_credential.sql
--
-- One seeded account is a usable production login with a password published in this repository.
--
-- `191_seed_immobileyes_proposals.sql` inserts `admin@immobileyes.test` as a **tenant_admin** with
-- `is_active = true`, `temp_password = false`, and a literal bcrypt hash. Its plaintext —
-- `DemoPass123!` — is committed in five driver scripts (`j1-cold-start.mjs`,
-- `immo-purchase-release.mts`, `mirage-ingest.mts`, `immo-finalize3.mts`, and the sandbox reset).
-- Anyone who can read the repo can sign in to that tenant on any environment the migrations have
-- been applied to.
--
-- WHY THIS IS A REGRESSION AND NOT AN OVERSIGHT. Migration 124 —
-- "launch_security_rotate_seed_credentials" — was written to remove exactly this. Migrations 157
-- and 162 seed partner_admins and both follow its pattern, each saying so in a comment:
-- "plaintext delivered out-of-band; temp_password=true forces a reset on first login". Migration
-- 191, sixty-seven migrations after the cleanup, is the only credential-seeding migration that
-- sets `temp_password = false`.
--
-- The cleanup could not have caught it: 124 names three accounts in a `WHERE email IN (...)` list,
-- and 191 did not exist yet. A fixed allowlist cannot cover what has not been written. The guard
-- that replaces it (`__tests__/seeded-credentials.test.ts`) asserts the PROPERTY over every
-- migration instead — no account may end up active, with a real hash, and no forced reset.
--
-- WHAT THIS DOES. The mig-124/157/162 treatment, not deletion: invalidate the published hash and
-- force a reset. The account and its tenant stay intact — `immobileyes` is a live fixture, the
-- second tenant every isolation drive needs in order to prove that tenant B cannot read tenant A.
--
-- The sandbox is unaffected. `scripts/sandbox-reset-passwords.mjs` runs after migrations in
-- `sandbox-up.sh`, already targets this exact account, and re-establishes `DemoPass123!` with
-- `temp_password = false` locally. So every driver keeps working, and the credential exists only on
-- a box someone deliberately reset — never from a fresh deploy.
--
-- Idempotent: re-running re-asserts the same end state.

UPDATE users
SET password_hash = 'invalidated-committed-demo-credential-see-mig-214',
    temp_password  = true,
    updated_at     = now()
WHERE email = 'admin@immobileyes.test'
  AND password_hash LIKE '$2%';

-- Sweep, not a list. Any OTHER account still carrying a committed hash with no forced reset gets
-- the same treatment — the point of 214 is that naming names is what failed the first time.
-- Scoped to the seeded `.test` domains so a real customer account is never touched.
UPDATE users
SET password_hash = 'invalidated-committed-demo-credential-see-mig-214',
    temp_password  = true,
    updated_at     = now()
WHERE email LIKE '%.test'
  AND is_active = true
  AND temp_password = false
  AND password_hash LIKE '$2%';
