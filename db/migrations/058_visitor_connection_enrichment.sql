-- =============================================================================
-- Migration 058: visitor connection enrichment (ISP / org / ASN / geo)
-- -----------------------------------------------------------------------------
-- Stores connection-derived attributes for each unique visitor session, looked
-- up server-side from the IP at session creation. The raw IP is NEVER stored —
-- only the SHA-256 ip_hash fingerprint (existing) plus these derived fields.
-- `country` already exists (migration 033); this adds the rest. All nullable;
-- enrichment is best-effort and degrades to NULL when no provider is configured.
-- =============================================================================

ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS region    TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS city      TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS isp       TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS org       TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS asn       TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS timezone  TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
