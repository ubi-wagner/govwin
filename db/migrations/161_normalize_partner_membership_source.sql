-- 161_normalize_partner_membership_source.sql
-- The old instant-create partner route granted the partner's membership on their owned company with
-- source='collaborator'. The canonical source for a partner MANAGING a client company is now
-- 'partner_manager' — what partnerCanEnter (descend gate) and the team-page Managers list read.
-- Normalize legacy partner tenant_admin memberships on partner-OWNED standard tenants to
-- 'partner_manager'. Own-org memberships (source='home') are intentionally left alone. Idempotent.
UPDATE user_memberships m
SET source = 'partner_manager'
FROM tenants t, users u
WHERE m.tenant_id = t.id AND m.user_id = u.id
  AND u.role = 'partner_admin'
  AND m.role = 'tenant_admin' AND m.status = 'active'
  AND t.kind = 'standard' AND t.owner_id = u.id
  AND m.source NOT IN ('home', 'partner_manager');
