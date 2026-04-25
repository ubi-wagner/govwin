-- 016_system_tenant.sql
--
-- Platform-level operations (admin curation, shredder, ingestion)
-- write to episodic_memories with no customer tenant context.
-- The FK on episodic_memories.tenant_id requires a valid tenants row.
-- This migration creates a sentinel "system" tenant so those writes
-- don't violate the constraint.
--
-- Idempotent via ON CONFLICT.

INSERT INTO tenants (id, name, slug, status)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'RFP Pipeline (System)',
  'system',
  'active'
)
ON CONFLICT (id) DO NOTHING;
