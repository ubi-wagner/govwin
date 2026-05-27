-- =============================================================================
-- Migration 041: Seed test accounts for HITL testing
-- Depends on: 040
--
-- Creates:
--   1. Admin user (eric.c.wagner@gmail.com / master_admin)
--   2. Test tenant: Apex Defense Solutions
--   3. Tenant admin: admin@apexdefense.test
--   4. Tenant employee: james@apexdefense.test
--   5. Partner user: partner@techalliance.test
--   6. Tenant profile for Apex Defense
--
-- All inserts use ON CONFLICT DO NOTHING — safe to run multiple times.
-- Uses a fixed tenant UUID so user inserts can reference it deterministically.
-- =============================================================================

-- --------------------------------------------------------------------------
-- 1. Admin user
-- --------------------------------------------------------------------------
-- Password: TestAdmin2026!  (bcrypt cost 12)
INSERT INTO users (email, name, role, password_hash, is_active, temp_password)
VALUES (
  'eric.c.wagner@gmail.com',
  'Eric Wagner',
  'master_admin',
  '$2b$12$3OrhHRfX7ipdRKLAQQQX1OK4opoS04zAzfyA.kJpMJoP4rjYdrHjC',
  true,
  false
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  temp_password = false,
  is_active = true;

-- --------------------------------------------------------------------------
-- 2. Test tenant: Apex Defense Solutions
-- --------------------------------------------------------------------------
-- Fixed UUID so subsequent inserts can reference it without a subquery.
INSERT INTO tenants (id, name, slug, status, product_tier, subscription_status, lifecycle_stage)
VALUES (
  'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4',
  'Apex Defense Solutions',
  'apex-defense',
  'active',
  'grinder',           -- highest product tier
  'active',
  'customer'
)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 3. Tenant admin: Sarah Mitchell
-- --------------------------------------------------------------------------
-- Password: TestCustomer2026!  (bcrypt cost 12)
INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
VALUES (
  'admin@apexdefense.test',
  'Sarah Mitchell',
  'tenant_admin',
  'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4',
  '$2b$12$7irrAI9BX1sOSZLPKEzt/eXH45pPRKRkbCmxD.jTM163ftkXiDcJO',
  true,
  false
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  tenant_id = EXCLUDED.tenant_id,
  temp_password = false,
  is_active = true;

-- --------------------------------------------------------------------------
-- 4. Tenant employee: James Chen
-- --------------------------------------------------------------------------
-- Password: TestEmployee2026!  (bcrypt cost 12)
INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
VALUES (
  'james@apexdefense.test',
  'James Chen',
  'tenant_user',
  'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4',
  '$2b$12$qBIXiSUCUhI1kw5tbACDZeIiEM5AupaFP/mhqmBA1DWU5Bsw5C38u',
  true,
  false
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  tenant_id = EXCLUDED.tenant_id,
  temp_password = false,
  is_active = true;

-- --------------------------------------------------------------------------
-- 5. External partner: Maria Santos
-- --------------------------------------------------------------------------
-- Password: TestPartner2026!  (bcrypt cost 12)
INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
VALUES (
  'partner@techalliance.test',
  'Maria Santos',
  'partner_user',
  'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4',
  '$2b$12$RjseW95gv0NKiMb5um0JhuCDLTtFCJqWE6499pl9wsBzaEOHPluL6',
  true,
  false
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  tenant_id = EXCLUDED.tenant_id,
  temp_password = false,
  is_active = true;

-- --------------------------------------------------------------------------
-- 6. Tenant profile for Apex Defense
-- --------------------------------------------------------------------------
INSERT INTO tenant_profiles (
  tenant_id,
  naics_codes,
  technology_focus,
  agency_priorities,
  research_areas,
  keywords
)
VALUES (
  'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4',
  ARRAY['541330', '541511', '541512', '541519', '334111'],
  'Artificial intelligence, machine learning, cybersecurity, cloud computing, data analytics, autonomous systems',
  ARRAY['DoD', 'Air Force', 'Navy', 'DARPA', 'NSA'],
  ARRAY['Computer vision', 'NLP', 'Edge computing', 'Zero trust architecture'],
  ARRAY['AI', 'ML', 'cyber', 'cloud', 'autonomy', 'ISR', 'C4ISR']
)
ON CONFLICT (tenant_id) DO NOTHING;
