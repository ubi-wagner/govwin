-- 200_promo_code_issuance.sql
--
-- Make comp codes ISSUABLE, so we can hand a buyer a one-time code that opens a proposal portal
-- without a card.
--
-- The redemption half already works. app/api/portal/[tenantSlug]/purchase/route.ts looks a code up
-- with `active = true AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR
-- used_count < max_uses) FOR UPDATE`, so a row with max_uses = 1 is genuinely single-use and the
-- row lock stops two simultaneous redemptions from both winning. What was missing is everything
-- around it: the only code in the table is the founding-cohort test code (unlimited uses, no
-- expiry), and the only way to make another was to write SQL by hand. Nothing recorded who issued a
-- code, who it was for, or which company burned it.
--
-- These columns are all NULLABLE and nothing reads them for authorization, so the existing code and
-- the existing redemption path behave exactly as before.

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES users(id);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS issued_to TEXT;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(id);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS first_redeemed_at TIMESTAMPTZ;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS redeemed_by_tenant_id UUID REFERENCES tenants(id);

COMMENT ON COLUMN promo_codes.issued_to IS
  'Free text describing who this code was handed to — a name, an email, an event. A bearer code is '
  'not bound to that party; this is for the issuer to know which code went where.';
COMMENT ON COLUMN promo_codes.first_redeemed_at IS
  'When the code was first successfully redeemed. used_count carries the count; this carries the '
  'moment, so an issued-but-unused code is distinguishable from a burnt one at a glance.';

-- Find an unredeemed, still-live code without scanning: the admin list is "what is outstanding".
CREATE INDEX IF NOT EXISTS idx_promo_codes_outstanding
  ON promo_codes (created_at DESC)
  WHERE active = true AND revoked_at IS NULL AND first_redeemed_at IS NULL;

-- Revoking is a soft state, and the redemption lookup only reads `active`. Keep the two in step so
-- a revoke cannot be defeated by a later UPDATE that flips active back without clearing revoked_at.
ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_revoked_inactive;
ALTER TABLE promo_codes
  ADD CONSTRAINT promo_codes_revoked_inactive
  CHECK (revoked_at IS NULL OR active = false);
