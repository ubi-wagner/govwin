-- 141_fix_paul_shadow_admin_role.sql
-- Paul Jackson (Entrepreneurs' Center) is the company-appointed SHADOW ADMIN of Foundation, but
-- migration 140 seeded him as `partner_user` — which ranks BELOW tenant_user, so a normal login
-- landed him at /portal/foundation/proposals with insufficient permissions: the spotlight buckets,
-- the ranked pipeline, and the proposal DOWNLOAD all returned 403. Elevate him to tenant_admin so
-- his membership-resolved login lands in the Foundation workspace with full shadow-admin access.
-- He stays external (no home tenant); the dispatcher resolves Foundation from his tenant_admin
-- membership, and his EC-partner origin remains recorded as a proposal collaborator. Idempotent.
UPDATE users
   SET role = 'tenant_admin', updated_at = now()
 WHERE email = 'pjackson@ecinnovates.com'
   AND role = 'partner_user';
