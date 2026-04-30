-- 024_environment_marker.sql
--
-- Adds a deploy_environment column to system_config so we can verify
-- which environment a database belongs to from the admin health panel.
-- Purely additive. Idempotent.

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS deploy_environment TEXT DEFAULT 'production';
