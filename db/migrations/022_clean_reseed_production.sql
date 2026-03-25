-- Migration 022: Clean Reseed — Production Data Reset
-- Removes all test/seed data and creates the real master admin:
--   eric@rfppipeline.com (master_admin, no tenant)
-- All legal consents are recorded as accepted.
--
-- WARNING: This is a destructive migration. It deletes all existing
-- users, tenants, opportunities, and related data.

BEGIN;

-- ─── 1. DELETE ALL EXISTING DATA ──────────────────────────────────
-- Order matters: delete from leaf tables first, then parents.
-- Most have ON DELETE CASCADE from tenants/users, but be explicit.

-- Event tables (no FK cascade from users/tenants in all cases)
DELETE FROM content_events;
DELETE FROM customer_events;
DELETE FROM opportunity_events;

-- Consent & audit
DELETE FROM consent_records;
DELETE FROM audit_log;

-- Automation
DELETE FROM automation_log;
DELETE FROM automation_rules;

-- Notifications
DELETE FROM notifications_queue;

-- Pipeline jobs & schedules are system config — keep schedules, clear jobs
DELETE FROM pipeline_jobs;

-- Content library junction tables
DELETE FROM boilerplate_focus_areas;
DELETE FROM partner_focus_areas;
DELETE FROM personnel_focus_areas;
DELETE FROM capability_focus_areas;
DELETE FROM past_performance_focus_areas;
DELETE FROM teaming_partners;
DELETE FROM focus_areas;

-- Knowledge base
DELETE FROM boilerplate_sections;
DELETE FROM key_personnel;
DELETE FROM capabilities;
DELETE FROM past_performance;

-- Stored files / uploads
DELETE FROM stored_files;
DELETE FROM tenant_uploads;
DELETE FROM download_links;

-- Opportunities & tenant-opportunity relationships
DELETE FROM tenant_actions;
DELETE FROM tenant_opportunities;
DELETE FROM opportunities;

-- Tenant profiles
DELETE FROM tenant_profiles;

-- Auth tables (sessions, accounts reference users with CASCADE)
DELETE FROM sessions;
DELETE FROM accounts;

-- Null out site_content user references (FK without CASCADE — keep CMS pages)
UPDATE site_content SET draft_updated_by = NULL, published_by = NULL;

-- Users (this cascades to anything referencing users not already deleted)
DELETE FROM users;

-- Tenants (this cascades to anything referencing tenants not already deleted)
DELETE FROM tenants;

-- ─── 2. CREATE MASTER ADMIN ──────────────────────────────────────
-- eric@rfppipeline.com — master_admin, no tenant association
-- Password: TestPass123! (bcrypt 10 rounds)

INSERT INTO users (
    id, name, email, role, tenant_id,
    password_hash, temp_password, is_active,
    email_verified,
    terms_accepted_at, terms_version,
    privacy_accepted_at, authority_confirmed_at,
    consent_required
) VALUES (
    'user-admin-eric-001',
    'Eric Wagner',
    'eric@rfppipeline.com',
    'master_admin',
    NULL,
    '$2a$10$ZPoqemSglbgkcTkf5/qkHOsZ11MG.qHBSAq4rMzMSqKOE.i0LdN0O',
    false,
    true,
    NOW(),
    NOW(), '2026-03-25-v1',
    NOW(), NOW(),
    false
);

-- ─── 3. RECORD CONSENT (immutable audit trail) ───────────────────
-- One row per document type = full legal coverage at account creation

INSERT INTO consent_records (user_id, tenant_id, document_type, document_version, action, summary, ip_address, user_agent)
VALUES
    ('user-admin-eric-001', NULL, 'terms_of_service',         '2026-03-25-v1', 'accept',
     'Accepted Terms of Service at account creation (migration seed)', '127.0.0.1', 'migration/022_clean_reseed_production'),

    ('user-admin-eric-001', NULL, 'privacy_policy',           '2026-03-25-v1', 'accept',
     'Accepted Privacy Policy at account creation (migration seed)', '127.0.0.1', 'migration/022_clean_reseed_production'),

    ('user-admin-eric-001', NULL, 'acceptable_use',           '2026-03-25-v1', 'accept',
     'Accepted Acceptable Use Policy at account creation (migration seed)', '127.0.0.1', 'migration/022_clean_reseed_production'),

    ('user-admin-eric-001', NULL, 'ai_disclosure',            '2026-03-25-v1', 'accept',
     'Accepted AI/LLM Disclosure at account creation (migration seed)', '127.0.0.1', 'migration/022_clean_reseed_production'),

    ('user-admin-eric-001', NULL, 'authority_representation', '2026-03-25-v1', 'accept',
     'Confirmed authority to represent organization at account creation (migration seed)', '127.0.0.1', 'migration/022_clean_reseed_production');

-- ─── 4. RESET SOURCE HEALTH (clean slate for pipeline) ──────────
UPDATE source_health SET status = 'unknown', last_checked_at = NULL, last_error = NULL, metadata = '{}';

-- ─── 5. CLEAR RATE LIMIT STATE ──────────────────────────────────
UPDATE rate_limit_state SET requests_today = 0, last_request_at = NULL;

COMMIT;
