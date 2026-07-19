-- 113_tenant_archive.sql
-- Company-level "slumber" (license expired). When a company loses its license the
-- whole tenant is ARCHIVED — every user loses access at once — WITHOUT touching each
-- user's individual membership state. On renewal the tenant is un-archived and everyone
-- returns to EXACTLY their prior per-user state (active users active, individually
-- inactive users still inactive) — because we never changed those rows. This is the
-- third state (active / inactive / archived) where archived is orthogonal, tenant-wide,
-- and reversible. See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md ("Never hard-delete").
--
-- Access = membership active AND tenant NOT archived. RFP/master admins remain exempt
-- (they enter a slumbering company to renew it).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
