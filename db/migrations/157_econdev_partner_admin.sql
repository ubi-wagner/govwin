-- 157_econdev_partner_admin.sql
-- EconDev partner-admin: an owner-scoped platform role for Economic-Development groups
-- (e.g. the Entrepreneurs' Center) that run a STABLE of client companies as tenants.
-- Design (fail-closed): docs/ECONDEV_PARTNER_ADMIN.md.
--   • New base role `partner_admin` (RBAC rank 50) — BELOW rfp_admin (80), so it is DENIED the
--     global /admin god-view by the middleware guard. It reaches only the new owner-scoped
--     /partner surface + the normal tenant portal for tenants it is a MEMBER of. No cross-customer
--     visibility, even if a route is missed (denied by rank).
--   • tenants.owner_id — which partner owns/created each tenant (NULL = platform/global, unchanged
--     for every existing tenant). A partner sees ONLY tenants they own; creating one sets owner_id
--     = self and grants them a tenant_admin membership (so they build proposals via the tested
--     membership-scoped portal). Buckets + pipeline + starter library auto-provision on create
--     (no Stripe — the comp/bypass model for EconDev clients).
-- Idempotent. Paul Jackson (EC) is seeded partner_admin with a TEMP password (bcrypt hash only in
-- git; plaintext delivered out-of-band; temp_password=true forces a reset on first login — the
-- mig-124 credential pattern). Foundation becomes his first owned company.

-- 1) Extend the users.role CHECK to admit the new role (robustly drop any existing role check first).
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'users'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%role%' LOOP
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('master_admin','rfp_admin','partner_admin','tenant_admin','tenant_user','partner_user'));

-- 2) Tenant ownership (NULL = platform-owned; unchanged for all existing tenants).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_tenants_owner ON tenants(owner_id) WHERE owner_id IS NOT NULL;

-- 3) Seed / elevate Paul Jackson (Entrepreneurs' Center) as an EconDev partner_admin.
--    TEMP password 'EconDev-TVSF-2026!' (hash below); temp_password=true forces a reset at first login.
INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
VALUES ('pjackson@ecinnovates.com', 'Paul Jackson',
        'partner_admin', NULL,
        '$2a$10$YiOaeBl6rM8Dr.tnL8khoOFO6Z1TVa0/5XDbxjFThbGKLx8IM4VJO', true, true)
ON CONFLICT (email) DO UPDATE SET
  role = 'partner_admin', temp_password = true, is_active = true,
  password_hash = EXCLUDED.password_hash;

-- 4) Foundation becomes Paul's first owned company (so his TVSF build shows in his stable).
UPDATE tenants
   SET owner_id = (SELECT id FROM users WHERE email = 'pjackson@ecinnovates.com')
 WHERE slug = 'foundation' AND owner_id IS NULL;
