-- =============================================================================
-- Migration 030 — Seed bootstrap events for all existing tenants
-- Ensures the events tables have baseline entries for monitoring
-- =============================================================================

BEGIN;

-- Bootstrap customer_events for each tenant so the Events page shows activity
INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type, entity_id, description, metadata)
SELECT
  t.id,
  (SELECT u.id FROM users u WHERE u.tenant_id = t.id AND u.role = 'tenant_admin' LIMIT 1),
  'account.tenant_created',
  'tenant',
  t.id::text,
  'Tenant "' || t.name || '" account created with plan: ' || t.plan,
  jsonb_build_object(
    'actor', jsonb_build_object('type', 'system', 'id', 'seed'),
    'payload', jsonb_build_object('name', t.name, 'slug', t.slug, 'plan', t.plan, 'bootstrapped', true)
  )
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM customer_events ce
  WHERE ce.tenant_id = t.id AND ce.event_type = 'account.tenant_created'
);

-- Bootstrap profile_updated events for tenants that have profiles configured
INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type, entity_id, description, metadata)
SELECT
  tp.tenant_id,
  (SELECT u.id FROM users u WHERE u.tenant_id = tp.tenant_id AND u.role = 'tenant_admin' LIMIT 1),
  'account.profile_updated',
  'tenant_profile',
  tp.tenant_id::text,
  'Scoring profile configured with NAICS codes and keywords',
  jsonb_build_object(
    'actor', jsonb_build_object('type', 'system', 'id', 'seed'),
    'payload', jsonb_build_object(
      'primary_naics', tp.primary_naics,
      'is_small_business', tp.is_small_business,
      'bootstrapped', true
    )
  )
FROM tenant_profiles tp
WHERE tp.primary_naics IS NOT NULL
  AND array_length(tp.primary_naics, 1) > 0
  AND NOT EXISTS (
    SELECT 1 FROM customer_events ce
    WHERE ce.tenant_id = tp.tenant_id AND ce.event_type = 'account.profile_updated'
  );

-- Bootstrap user_added events for each user
INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type, entity_id, description, metadata)
SELECT
  u.tenant_id,
  u.id,
  'account.user_added',
  'user',
  u.id,
  'User "' || u.name || '" (' || u.email || ') added as ' || u.role,
  jsonb_build_object(
    'actor', jsonb_build_object('type', 'system', 'id', 'seed'),
    'payload', jsonb_build_object(
      'new_user_name', u.name,
      'new_user_email', u.email,
      'new_user_role', u.role,
      'bootstrapped', true
    )
  )
FROM users u
WHERE u.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM customer_events ce
    WHERE ce.tenant_id = u.tenant_id
      AND ce.event_type = 'account.user_added'
      AND ce.entity_id = u.id
  );

COMMIT;
