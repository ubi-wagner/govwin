-- 131_expert_time_calendar.sql
--
-- Expert-time scheduling (the "super simple" calendar behind Terms §7):
--   • RFP-Pipeline admins post blocks of availability (discrete bookable slots).
--   • Tenants book an open slot, up to their ACCRUED balance (15 min / month for now,
--     computed — no accrual table; balance = 15 * months_since_created − booked minutes).
--   • Google-Meet auto-creation is DEFERRED (Terms §7(d)); a booking just reserves a slot.
--
-- Two tables:
--   expert_availability_blocks — admin-owned, NOT tenant-scoped (a global slot pool).
--       status open → booked (CAS on booking) → or admin-cancelled. Its 'booked' status is
--       the single, RLS-independent source of truth for slot availability, so the tenant
--       "open slots" query is correct under BOTH the current owner role and the future
--       NOBYPASSRLS govtech_app role (a tenant-scoped NOT EXISTS over bookings would show a
--       slot another tenant booked as still-open once RLS bites).
--   expert_time_bookings — tenant-scoped, RLS FORCEd (same tenant_isolation pattern as
--       tenant_automation_policies / proposal_portals). A partial unique index makes a slot
--       bookable exactly once across all tenants (the race backstop behind the CAS).

CREATE TABLE IF NOT EXISTS expert_availability_blocks (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at       TIMESTAMPTZ NOT NULL,
    end_at         TIMESTAMPTZ NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT eab_window_valid CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_eab_open ON expert_availability_blocks (start_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_eab_admin ON expert_availability_blocks (admin_user_id);

CREATE TABLE IF NOT EXISTS expert_time_bookings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    block_id          UUID NOT NULL REFERENCES expert_availability_blocks(id) ON DELETE CASCADE,
    booked_by_user_id UUID NOT NULL REFERENCES users(id),
    admin_user_id     UUID NOT NULL REFERENCES users(id),
    start_at          TIMESTAMPTZ NOT NULL,
    end_at            TIMESTAMPTZ NOT NULL,
    minutes           INTEGER NOT NULL CHECK (minutes > 0),
    status            TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
    note              TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etb_tenant ON expert_time_bookings (tenant_id, status);
-- A slot can carry exactly ONE active booking (global — RLS-independent race backstop).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_etb_block_active
    ON expert_time_bookings (block_id) WHERE status = 'booked';

-- RLS: FORCE tenant isolation on the bookings (same as tenant_automation_policies, mig 127).
-- expert_availability_blocks is intentionally NOT tenant-scoped (admin-global slot pool).
ALTER TABLE expert_time_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE expert_time_bookings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expert_time_bookings;
CREATE POLICY tenant_isolation ON expert_time_bookings
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Grants for the future non-owner govtech_app role (harmless under the current owner role).
GRANT SELECT, INSERT, UPDATE, DELETE ON expert_availability_blocks TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON expert_time_bookings      TO govtech_app;

DROP TRIGGER IF EXISTS eab_updated ON expert_availability_blocks;
CREATE TRIGGER eab_updated BEFORE UPDATE ON expert_availability_blocks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS etb_updated ON expert_time_bookings;
CREATE TRIGGER etb_updated BEFORE UPDATE ON expert_time_bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
