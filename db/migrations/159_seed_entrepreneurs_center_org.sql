-- 159_seed_entrepreneurs_center_org.sql
-- Seed the Entrepreneurs' Center as Paul Jackson's partner-manager OWN organization
-- (docs/PARTNER_MANAGER_DESIGN.md D4). A partner is a higher-order tenant themselves: their own
-- org (kind='partner_org') is where they run their own buckets/opportunity pipeline and apply for
-- grants — distinct from the 'standard' client companies in their stable.
--
-- Structural rows only (tenant + home membership + home pointer). Buckets / cards / starter library
-- are provisioned idempotently at runtime on the partner's first /partner visit
-- (lib/partner/own-org.ts ensurePartnerOwnOrgProvisioned) — the TS provisioning helpers can't run
-- in SQL. Fully idempotent.

-- 1) The org tenant (owner = Paul). Legal: Miami Dayton Entrepreneurs' Center; https://ecinnovates.com.
INSERT INTO tenants (slug, name, legal_name, website, status, lifecycle_stage, kind, owner_id)
SELECT 'entrepreneurs-center', 'Entrepreneurs'' Center', 'Miami Dayton Entrepreneurs'' Center',
       'https://ecinnovates.com', 'active', 'customer', 'partner_org', u.id
FROM users u
WHERE u.email = 'pjackson@ecinnovates.com'
ON CONFLICT (slug) DO NOTHING;

-- 2) Paul is tenant_admin of his own org (home membership → he builds via the tested portal).
INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
SELECT u.id, t.id, 'tenant_admin', 'active', 'home', u.id
FROM users u
JOIN tenants t ON t.slug = 'entrepreneurs-center'
WHERE u.email = 'pjackson@ecinnovates.com'
ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'active', role = 'tenant_admin';

-- 3) Make the org Paul's HOME tenant — only if he has none yet (never clobber an existing home).
UPDATE users u
   SET tenant_id = t.id
  FROM tenants t
 WHERE u.email = 'pjackson@ecinnovates.com'
   AND t.slug = 'entrepreneurs-center'
   AND u.tenant_id IS NULL;
