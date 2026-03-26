-- =============================================================================
-- 000e — Views & Seed Data
-- Part 5 of 5 baseline migrations
-- =============================================================================

-- =============================================================================
-- VIEWS
-- =============================================================================

CREATE OR REPLACE VIEW api_key_status AS
SELECT
    source, key_hint, env_var, expires_date, is_valid,
    CASE WHEN expires_date IS NULL THEN NULL
         ELSE (expires_date - CURRENT_DATE)::INT END AS days_until_expiry,
    CASE WHEN expires_date IS NULL THEN 'no_expiry'
         WHEN (expires_date - CURRENT_DATE) < 0 THEN 'expired'
         WHEN (expires_date - CURRENT_DATE) < days_warning THEN 'expiring_soon'
         ELSE 'ok' END AS expiry_status,
    notes
FROM api_key_registry;

CREATE OR REPLACE VIEW tenant_opportunity_reactions AS
SELECT
    tenant_id, opportunity_id,
    COUNT(*) FILTER (WHERE action_type = 'thumbs_up')   AS thumbs_up,
    COUNT(*) FILTER (WHERE action_type = 'thumbs_down') AS thumbs_down,
    COUNT(*) FILTER (WHERE action_type = 'comment')     AS comment_count,
    COUNT(*) FILTER (WHERE action_type = 'pin')         AS is_pinned,
    MAX(created_at)                                      AS last_action_at
FROM tenant_actions
GROUP BY tenant_id, opportunity_id;

CREATE OR REPLACE VIEW tenant_pipeline AS
SELECT
    to2.id AS tenant_opp_id, to2.tenant_id,
    o.id AS opportunity_id, o.source, o.source_id, o.solicitation_number,
    o.title, o.description, o.agency, o.agency_code, o.department, o.sub_tier, o.office,
    o.naics_codes, o.classification_code, o.set_aside_type, o.set_aside_code,
    o.opportunity_type, o.base_type, o.posted_date, o.close_date, o.archive_date,
    o.estimated_value_min, o.estimated_value_max, o.source_url, o.sam_ui_link,
    o.additional_info_link, o.resource_links, o.status AS opp_status, o.is_active,
    o.pop_city, o.pop_state, o.pop_country, o.pop_zip,
    o.contact_name, o.contact_email, o.contact_phone, o.contact_title,
    o.award_date, o.award_number, o.award_amount, o.awardee_name, o.awardee_uei,
    to2.total_score, to2.llm_adjustment, to2.llm_rationale,
    to2.matched_keywords, to2.matched_domains, to2.pursuit_status,
    to2.pursuit_recommendation, to2.key_requirements, to2.competitive_risks,
    to2.questions_for_rfi, to2.priority_tier, to2.scored_at,
    EXTRACT(DAY FROM (o.close_date - NOW()))::INT AS days_to_close,
    CASE
        WHEN o.close_date < NOW() THEN 'closed'
        WHEN o.close_date < NOW() + INTERVAL '7 days' THEN 'urgent'
        WHEN o.close_date < NOW() + INTERVAL '14 days' THEN 'soon'
        ELSE 'ok'
    END AS deadline_status,
    COALESCE(r.thumbs_up, 0) AS thumbs_up,
    COALESCE(r.thumbs_down, 0) AS thumbs_down,
    COALESCE(r.comment_count, 0) AS comment_count,
    COALESCE(r.is_pinned, 0) > 0 AS is_pinned,
    r.last_action_at,
    (SELECT COUNT(*) FROM documents d WHERE d.opportunity_id = o.id) AS doc_count,
    (SELECT COUNT(*) FROM amendments a WHERE a.opportunity_id = o.id) AS amendment_count
FROM tenant_opportunities to2
JOIN opportunities o ON o.id = to2.opportunity_id
LEFT JOIN tenant_opportunity_reactions r
    ON r.tenant_id = to2.tenant_id AND r.opportunity_id = o.id
WHERE o.status = 'active';

CREATE OR REPLACE VIEW opportunity_tenant_coverage AS
SELECT
    o.id, o.title, o.agency, o.department, o.opportunity_type, o.close_date,
    o.award_amount, o.awardee_name,
    COUNT(DISTINCT to2.tenant_id) AS tenant_count,
    ROUND(AVG(to2.total_score), 1) AS avg_tenant_score,
    MAX(to2.total_score) AS max_tenant_score,
    COUNT(*) FILTER (WHERE to2.pursuit_status = 'pursuing') AS pursuing_count
FROM opportunities o
LEFT JOIN tenant_opportunities to2 ON to2.opportunity_id = o.id
WHERE o.status = 'active'
GROUP BY o.id, o.title, o.agency, o.department, o.opportunity_type, o.close_date, o.award_amount, o.awardee_name;

CREATE OR REPLACE VIEW tenant_analytics AS
SELECT
    tp.tenant_id, t.name AS tenant_name,
    COUNT(*) AS total_in_pipeline,
    COUNT(*) FILTER (WHERE tp.total_score >= 75) AS high_priority_count,
    COUNT(*) FILTER (WHERE tp.pursuit_status = 'pursuing') AS pursuing_count,
    COUNT(*) FILTER (WHERE tp.pursuit_status = 'monitoring') AS monitoring_count,
    ROUND(AVG(tp.total_score), 1) AS avg_score,
    COUNT(*) FILTER (WHERE o.close_date BETWEEN NOW() AND NOW() + INTERVAL '14 days') AS closing_14d,
    COUNT(*) FILTER (WHERE tp.scored_at > NOW() - INTERVAL '7 days') AS new_last_7d,
    SUM(COALESCE(r.thumbs_up, 0)) AS total_thumbs_up,
    SUM(COALESCE(r.thumbs_down, 0)) AS total_thumbs_down,
    MAX(tp.scored_at) AS last_scored_at
FROM tenant_opportunities tp
JOIN tenants t ON t.id = tp.tenant_id
JOIN opportunities o ON o.id = tp.opportunity_id
LEFT JOIN tenant_opportunity_reactions r
    ON r.tenant_id = tp.tenant_id AND r.opportunity_id = tp.opportunity_id
WHERE o.status = 'active'
GROUP BY tp.tenant_id, t.name;

CREATE OR REPLACE VIEW tenant_active_opps AS
SELECT
    t.id AS tenant_id, t.name AS tenant_name, t.product_tier, t.max_active_opps,
    COUNT(to2.id) FILTER (WHERE to2.pursuit_status = 'pursuing') AS pursuing_count,
    COUNT(to2.id) FILTER (WHERE to2.pursuit_status = 'monitoring') AS monitoring_count,
    COUNT(to2.id) FILTER (WHERE to2.pursuit_status IN ('pursuing', 'monitoring')) AS active_count,
    t.max_active_opps - COUNT(to2.id) FILTER (WHERE to2.pursuit_status IN ('pursuing', 'monitoring')) AS slots_remaining
FROM tenants t
LEFT JOIN tenant_opportunities to2 ON to2.tenant_id = t.id
WHERE t.status = 'active'
GROUP BY t.id, t.name, t.product_tier, t.max_active_opps;

CREATE OR REPLACE VIEW tenant_content_summary AS
SELECT
    t.id AS tenant_id, t.name AS tenant_name,
    (SELECT COUNT(*) FROM focus_areas fa WHERE fa.tenant_id = t.id AND fa.status = 'active') AS focus_area_count,
    (SELECT COUNT(*) FROM past_performance pp WHERE pp.tenant_id = t.id AND pp.active) AS past_performance_count,
    (SELECT COUNT(*) FROM capabilities c WHERE c.tenant_id = t.id AND c.active) AS capability_count,
    (SELECT COUNT(*) FROM key_personnel kp WHERE kp.tenant_id = t.id AND kp.active AND kp.affiliation = 'internal') AS internal_personnel_count,
    (SELECT COUNT(*) FROM key_personnel kp WHERE kp.tenant_id = t.id AND kp.active AND kp.affiliation != 'internal') AS partner_personnel_count,
    (SELECT COUNT(*) FROM teaming_partners tp WHERE tp.tenant_id = t.id AND tp.active) AS teaming_partner_count,
    (SELECT COUNT(*) FROM boilerplate_sections bs WHERE bs.tenant_id = t.id AND bs.active) AS boilerplate_count,
    (SELECT COUNT(*) FROM tenant_uploads tu WHERE tu.tenant_id = t.id AND tu.is_active) AS upload_count
FROM tenants t WHERE t.status = 'active';

CREATE OR REPLACE VIEW focus_area_content AS
SELECT
    fa.id AS focus_area_id, fa.tenant_id, fa.name AS focus_area_name,
    fa.naics_codes, fa.keywords,
    (SELECT COUNT(*) FROM past_performance_focus_areas ppfa WHERE ppfa.focus_area_id = fa.id) AS past_performance_count,
    (SELECT COUNT(*) FROM capability_focus_areas cfa WHERE cfa.focus_area_id = fa.id) AS capability_count,
    (SELECT COUNT(*) FROM personnel_focus_areas pfa WHERE pfa.focus_area_id = fa.id) AS personnel_count,
    (SELECT COUNT(*) FROM partner_focus_areas parfa WHERE parfa.focus_area_id = fa.id) AS partner_count,
    (SELECT COUNT(*) FROM boilerplate_focus_areas bfa WHERE bfa.focus_area_id = fa.id) AS boilerplate_count,
    (SELECT COUNT(*) FROM tenant_uploads tu WHERE tu.focus_area_id = fa.id AND tu.is_active) AS upload_count
FROM focus_areas fa WHERE fa.status = 'active';

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- ─── System Config ──────────────────────────────────────────────
INSERT INTO system_config (key, value, description) VALUES
    ('scoring.llm_trigger_score', '"50"', 'Min surface score to trigger LLM analysis'),
    ('scoring.llm_max_adjustment', '"20"', 'Max LLM can add/subtract from surface score'),
    ('pipeline.retry_attempts', '"3"', 'Number of retries for failed pipeline jobs'),
    ('pipeline.retry_delay_seconds', '"30"', 'Delay between retries'),
    ('pipeline.max_concurrent_jobs', '"2"', 'Max concurrent pipeline jobs'),
    ('notifications.digest_hour', '"7"', 'Hour (UTC) to send daily digest emails'),
    ('features.llm_analysis', '"true"', 'Enable LLM-powered opportunity analysis'),
    ('features.document_download', '"true"', 'Enable document downloads from SAM.gov'),
    ('features.embeddings', '"true"', 'Enable vector embeddings for semantic search'),
    ('features.tenant_self_service', '"false"', 'Allow tenants to self-register'),
    ('features.tenant_uploads', '"true"', 'Allow tenant file uploads'),
    ('features.portal_comments', '"true"', 'Allow portal commenting'),
    ('drive.root_folder_id', 'null', 'Google Drive root folder GID'),
    ('drive.opportunities_folder_id', 'null', 'Drive opportunities folder GID'),
    ('drive.customers_folder_id', 'null', 'Drive customers folder GID'),
    ('drive.templates_folder_id', 'null', 'Drive templates folder GID'),
    ('drive.current_week_folder_id', 'null', 'Drive current week folder GID'),
    ('drive.current_week_label', 'null', 'Current ISO week label'),
    ('tiers.finder.base_opps', '"10"', 'Base opportunities for Finder tier'),
    ('tiers.finder.upsell_opps', '"10"', 'Additional opps available for upsell'),
    ('tiers.finder.upsell_price', '"99"', 'Price per upsell batch'),
    ('storage.root_path', '"/"', 'Root storage path'),
    ('storage.opportunities_path', '"opportunities"', 'Opportunities storage path'),
    ('storage.customers_path', '"customers"', 'Customers storage path'),
    ('storage.templates_path', '"system/templates"', 'Templates storage path'),
    ('storage.backend', '"local"', 'Storage backend: local or s3'),
    ('storage.provisioned', '"false"', 'Whether storage has been provisioned')
ON CONFLICT (key) DO NOTHING;

-- ─── API Key Registry ───────────────────────────────────────────
INSERT INTO api_key_registry (source, env_var, days_warning, notes) VALUES
    ('sam_gov', 'SAM_GOV_API_KEY', 15, 'Expires every 90 days'),
    ('anthropic', 'ANTHROPIC_API_KEY', 30, 'No expiry')
ON CONFLICT (source) DO NOTHING;

-- ─── Pipeline Schedules ─────────────────────────────────────────
INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, priority) VALUES
    ('sam_gov',              'SAM.gov Daily',             'full',    '0 6 * * *',    1),
    ('grants_gov',           'Grants.gov Daily',          'full',    '0 6 * * *',    2),
    ('sbir',                 'SBIR Weekly',               'full',    '0 7 * * 1',    3),
    ('usaspending',          'USASpending Intel',         'intel',   '0 8 * * 0',    4),
    ('refresh',              'Open Opp Refresh',          'refresh', '0 */4 * * *',  2),
    ('scoring',              'Re-score All Tenants',      'score',   '0 5 * * *',    3),
    ('digest',               'Email Digests',             'notify',  '0 7 * * *',    5),
    ('drive_sync',           'Drive Sync (Post-Ingest)',  'sync',    '0 6 30 * *',   6),
    ('reminder_nudges',      'Deadline Nudge Check',      'notify',  '0 8 * * *',    3),
    ('reminder_amendments',  'Reminder Amendment Alerts', 'notify',  '0 */2 * * *',  5),
    ('tenant_snapshots',     'Tenant Snapshot Refresh',   'sync',    '0 7 * * *',    6),
    ('email_delivery',       'Email Queue Flush',         'notify',  '*/15 * * * *', 4)
ON CONFLICT (source) DO NOTHING;

-- ─── Rate Limit State ───────────────────────────────────────────
INSERT INTO rate_limit_state (source, daily_limit, hourly_limit) VALUES
    ('sam_gov',     1000, NULL),
    ('sbir',        NULL, 30),
    ('grants_gov',  NULL, NULL),
    ('usaspending', NULL, NULL),
    ('anthropic',   NULL, NULL)
ON CONFLICT (source) DO NOTHING;

-- ─── Source Health ──────────────────────────────────────────────
INSERT INTO source_health (source) VALUES
    ('sam_gov'), ('sbir'), ('grants_gov'), ('usaspending')
ON CONFLICT (source) DO NOTHING;

-- ─── Site Content (CMS Pages) ───────────────────────────────────
INSERT INTO site_content (page_key, display_name) VALUES
    ('home',          'Home Page'),
    ('about',         'About'),
    ('team',          'Team'),
    ('tips',          'Tips & Tools'),
    ('customers',     'Customer Wins'),
    ('announcements', 'Announcements'),
    ('get_started',   'Get Started / Pricing')
ON CONFLICT (page_key) DO NOTHING;

-- ─── Automation Rules ───────────────────────────────────────────
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority) VALUES
    ('login_activity_log', 'Log every user login for audit trail', 'customer_events', '{account.login}', '{}', 'log_only', '{"message_template": "User {actor.email} logged in for tenant {refs.tenant_id}"}', 10),
    ('first_login_welcome', 'Send welcome email on first login', 'customer_events', '{account.login}', '{"$first_occurrence": true, "$entity_key": "actor.id"}', 'queue_notification', '{"notification_type": "welcome", "subject_template": "Welcome to RFP Pipeline!", "priority": 5}', 20),
    ('profile_update_rescore', 'Trigger scoring run when tenant profile is updated', 'customer_events', '{account.tenant_updated, account.profile_updated}', '{"payload.fields_changed": {"$contains_any": ["primary_naics", "secondary_naics", "keyword_domains", "agency_priorities", "set_aside"]}}', 'queue_job', '{"source": "scoring", "run_type": "score", "priority": 3}', 30),
    ('tenant_created_onboarding', 'Queue onboarding email when a new tenant is created', 'customer_events', '{account.tenant_created}', '{}', 'queue_notification', '{"notification_type": "onboarding", "subject_template": "Your RFP Pipeline account is ready!", "priority": 3}', 20),
    ('ingest_new_monitor', 'Log new opportunity ingestion for monitoring', 'opportunity_events', '{ingest.new}', '{}', 'log_only', '{"message_template": "New opportunity ingested: {payload.title} from {payload.agency}"}', 90),
    ('high_score_notify', 'Notify tenant when an opportunity scores above threshold', 'opportunity_events', '{scoring.scored}', '{"payload.total_score": {"$gte": 75}, "payload.recommendation": "pursue"}', 'emit_event', '{"bus": "customer_events", "event_type": "finder.high_score_alert", "description_template": "High-scoring opportunity ({payload.total_score}/100): recommend pursue"}', 40),
    ('llm_adjustment_log', 'Log LLM score adjustments for analysis', 'opportunity_events', '{scoring.llm_adjusted}', '{}', 'log_only', '{"message_template": "LLM adjusted score by {payload.llm_adjustment} for opp (surface: {payload.surface_score} -> final: {payload.final_score}): {payload.llm_rationale}"}', 80),
    ('amendment_ensure_email', 'Ensure amendment alerts result in email delivery', 'customer_events', '{reminder.amendment_alert}', '{}', 'log_only', '{"message_template": "Amendment alert for opp {refs.opportunity_id} sent to tenant {refs.tenant_id}"}', 70),
    ('urgent_nudge_escalation', 'Log urgent deadline nudges for SLA tracking', 'customer_events', '{reminder.nudge_sent}', '{"payload.nudge_type": "urgent"}', 'log_only', '{"message_template": "URGENT deadline nudge: {payload.solicitation_number} closes tomorrow for tenant {payload.tenant_name}"}', 50),
    ('content_publish_log', 'Log CMS content publish events for change tracking', 'content_events', '{content.published, content.rolled_back, content.unpublished}', '{}', 'log_only', '{"message_template": "CMS {trigger_event_type}: {payload.path}"}', 90),
    ('drive_archive_notify', 'Notify when opportunities are archived to Drive', 'opportunity_events', '{drive.archived}', '{}', 'log_only', '{"message_template": "Opportunity archived to Drive: {payload.title}"}', 80),
    ('user_added_welcome', 'Send welcome notification when a new user is added', 'customer_events', '{account.user_added}', '{}', 'queue_notification', '{"notification_type": "user_welcome", "subject_template": "You have been added to {payload.tenant_name} on RFP Pipeline", "priority": 3}', 20)
ON CONFLICT (name) DO NOTHING;

-- ─── Legal Document Versions ────────────────────────────────────
INSERT INTO legal_document_versions (document_type, version, effective_date, summary_of_changes, is_current) VALUES
    ('terms_of_service',         '2026-03-25-v1', '2026-03-25', 'Initial Terms of Service',         TRUE),
    ('privacy_policy',           '2026-03-25-v1', '2026-03-25', 'Initial Privacy Policy',            TRUE),
    ('acceptable_use',           '2026-03-25-v1', '2026-03-25', 'Initial Acceptable Use Policy',     TRUE),
    ('ai_disclosure',            '2026-03-25-v1', '2026-03-25', 'Initial AI/LLM Disclosure',         TRUE),
    ('authority_representation', '2026-03-25-v1', '2026-03-25', 'Initial Authority Representation',  TRUE)
ON CONFLICT (document_type, version) DO NOTHING;

-- ─── Master Admin User ──────────────────────────────────────────
INSERT INTO users (
    id, name, email, role, tenant_id, password_hash,
    temp_password, is_active, email_verified,
    terms_accepted_at, terms_version, privacy_accepted_at,
    authority_confirmed_at, consent_required
) VALUES (
    'user-admin-eric-001', 'Eric Wagner', 'eric@rfppipeline.com',
    'master_admin', NULL,
    '$2a$10$ZPoqemSglbgkcTkf5/qkHOsZ11MG.qHBSAq4rMzMSqKOE.i0LdN0O',
    false, true, NOW(),
    NOW(), '2026-03-25-v1', NOW(), NOW(), false
) ON CONFLICT (email) DO NOTHING;

-- ─── Master Admin Consent Records ───────────────────────────────
INSERT INTO consent_records (user_id, tenant_id, document_type, document_version, action, summary, ip_address, user_agent) VALUES
    ('user-admin-eric-001', NULL, 'terms_of_service',         '2026-03-25-v1', 'accept', 'Accepted Terms of Service at account creation',             '127.0.0.1', 'baseline/000e'),
    ('user-admin-eric-001', NULL, 'privacy_policy',           '2026-03-25-v1', 'accept', 'Accepted Privacy Policy at account creation',               '127.0.0.1', 'baseline/000e'),
    ('user-admin-eric-001', NULL, 'acceptable_use',           '2026-03-25-v1', 'accept', 'Accepted Acceptable Use Policy at account creation',        '127.0.0.1', 'baseline/000e'),
    ('user-admin-eric-001', NULL, 'ai_disclosure',            '2026-03-25-v1', 'accept', 'Accepted AI/LLM Disclosure at account creation',            '127.0.0.1', 'baseline/000e'),
    ('user-admin-eric-001', NULL, 'authority_representation', '2026-03-25-v1', 'accept', 'Confirmed authority to represent organization at creation', '127.0.0.1', 'baseline/000e');
