-- 160_backfill_partner_owner_memberships.sql
-- A partner can only DESCEND into a company where they hold the tenant_admin membership
-- verifyTenantAccess reads — owning it (tenants.owner_id) alone is NOT enough. Legacy ownership was
-- set without a membership (Foundation via mig 157 set owner_id only), so the partner couldn't enter
-- their own company. Backfill a partner_manager membership for every partner-owned standard tenant
-- that is missing the owner's active membership. Idempotent + general (covers any current/future gap;
-- the create/accept/own-org paths already write the membership, so this only catches legacy rows).
INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
SELECT t.owner_id, t.id, 'tenant_admin', 'active', 'partner_manager', t.owner_id
FROM tenants t
JOIN users u ON u.id = t.owner_id AND u.role = 'partner_admin'
WHERE t.owner_id IS NOT NULL AND t.kind = 'standard' AND t.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_memberships m
    WHERE m.user_id = t.owner_id AND m.tenant_id = t.id AND m.status = 'active'
  )
ON CONFLICT (user_id, tenant_id) DO UPDATE
  SET status = 'active', role = 'tenant_admin', source = 'partner_manager';
