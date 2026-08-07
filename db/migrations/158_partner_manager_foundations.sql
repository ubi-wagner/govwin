-- 158_partner_manager_foundations.sql
-- Partner-Manager actor — Phase 0 foundations (docs/PARTNER_MANAGER_DESIGN.md §2).
-- Additive + idempotent. Every existing row keeps its current behavior:
--   • existing memberships keep their source; the CHECK only ADMITS a new value.
--   • every existing tenant defaults kind='standard'; every application source='public'.
--
-- 1) user_memberships.source += 'partner_manager' — an external manager grant (a partner
--    holding tenant_admin on a client company they don't home at). Robustly drop any existing
--    CHECK on source first (mirrors mig 157's role-CHECK swap), then re-add the widened one.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'user_memberships'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%source%' LOOP
    EXECUTE 'ALTER TABLE user_memberships DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;
ALTER TABLE user_memberships ADD CONSTRAINT user_memberships_source_check
  CHECK (source IN ('home','shadow_t_and_c','collaborator','manual','partner_manager'));

-- 2) tenants.kind — 'partner_org' marks a partner-manager's OWN organization (a higher-order
--    tenant they run for grants etc.), distinct from the 'standard' client companies in their
--    stable. NULL/absent → 'standard' for every existing tenant.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'tenants'::regclass AND conname = 'tenants_kind_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_kind_check CHECK (kind IN ('standard','partner_org'));
  END IF;
END $$;

-- 3) applications.source — 'partner' marks a partner-submitted registration (thin form,
--    attributed via metadata.partnerId) vs the 'public' /apply intake. Same table, same
--    RFP-admin approval; the accept route reads source+partnerId to attribute ownership.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'public';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_source_check'
  ) THEN
    ALTER TABLE applications ADD CONSTRAINT applications_source_check CHECK (source IN ('public','partner'));
  END IF;
END $$;

-- 4) Fuzzy company-name matching for the add-company dedup precheck (pg_trgm is installed in
--    mig 001). GIN trigram index accelerates similarity(name, $1) / name % $1 scans.
CREATE INDEX IF NOT EXISTS idx_tenants_name_trgm ON tenants USING gin (name gin_trgm_ops);
