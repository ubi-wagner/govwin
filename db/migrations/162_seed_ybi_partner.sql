-- 162_seed_ybi_partner.sql
-- Durable seed of a SECOND partner-manager (docs/PARTNER_MANAGER_DESIGN.md D4) so any replica of the
-- Claude VM lands with the full V1 partner demo: Paul Jackson / Entrepreneurs' Center (migs 157/159)
-- + Stephanie Gaffney / Youngstown Business Incubator (this mig). Mirrors migs 157 + 159.
--
-- Structural rows only (user + partner_org tenant + home membership + home pointer). Buckets / cards /
-- starter library provision idempotently at runtime on Stephanie's first /partner visit
-- (lib/partner/own-org.ts). Idempotent. TEMP password 'YBI-Partner-2026!' (bcrypt hash only in git;
-- plaintext delivered out-of-band; temp_password=true forces a reset on first login — mig-124 pattern).

-- 1) Stephanie Gaffney (YBI, VP Advanced Manufacturing Programs) as a partner_admin.
INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
VALUES ('sgaffney@ybi.org', 'Stephanie Gaffney',
        'partner_admin', NULL,
        '$2a$10$58SmlOxvB1r3x/l/qeQeH.elGi0gv80lnQ6ZLvgXehADwkrwD7.Bi', true, true)
ON CONFLICT (email) DO UPDATE SET
  role = 'partner_admin', name = 'Stephanie Gaffney', temp_password = true, is_active = true,
  password_hash = EXCLUDED.password_hash;

-- 2) Youngstown Business Incubator — Stephanie's OWN org (kind='partner_org'). https://ybi.org.
INSERT INTO tenants (slug, name, legal_name, website, status, lifecycle_stage, kind, owner_id)
SELECT 'youngstown-business-incubator', 'Youngstown Business Incubator', 'Youngstown Business Incubator',
       'https://ybi.org', 'active', 'customer', 'partner_org', u.id
FROM users u
WHERE u.email = 'sgaffney@ybi.org'
ON CONFLICT (slug) DO NOTHING;

-- 3) Stephanie is tenant_admin of YBI (home membership → builds via the tested portal).
INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
SELECT u.id, t.id, 'tenant_admin', 'active', 'home', u.id
FROM users u
JOIN tenants t ON t.slug = 'youngstown-business-incubator'
WHERE u.email = 'sgaffney@ybi.org'
ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'active', role = 'tenant_admin';

-- 4) Make YBI Stephanie's HOME tenant — only if she has none yet (never clobber).
UPDATE users u
   SET tenant_id = t.id
  FROM tenants t
 WHERE u.email = 'sgaffney@ybi.org'
   AND t.slug = 'youngstown-business-incubator'
   AND u.tenant_id IS NULL;
