-- =============================================================================
-- CMS Database Migration 007 — Template Trigger Flag System
--
-- Enables closed-loop email automation: outgoing emails embed machine-readable
-- context (trigger flags) that the sweep worker uses to route and auto-respond
-- to replies.
--
-- Changes:
--   email_templates: trigger_config, response_map, profile_variables, template_category
--   email_sends:     trigger_metadata
--   Seed templates for common outreach scenarios
-- =============================================================================

-- =============================================================================
-- EXTEND email_templates — trigger automation config
-- =============================================================================

-- trigger_config: defines what events this template participates in,
-- expected responses, and whether auto-response is enabled
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS trigger_config JSONB DEFAULT '{}';

-- response_map: maps reply classifications to response template slugs
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS response_map JSONB DEFAULT '{}';

-- profile_variables: list of profile fields this template needs resolved
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS profile_variables TEXT[] DEFAULT '{}';

-- template_category: finer-grained category for trigger routing
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS template_category TEXT DEFAULT 'outreach'
    CHECK (template_category IN (
        'outreach', 'response', 'drip', 'notification', 'digest', 'system', 'follow_up'
    ));

-- =============================================================================
-- EXTEND email_sends — trigger metadata on each send
-- =============================================================================

-- trigger_metadata: embedded context that travels with the email and comes back
-- on replies for closed-loop routing
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS trigger_metadata JSONB DEFAULT '{}';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Templates with auto-response enabled
CREATE INDEX IF NOT EXISTS idx_email_templates_trigger_enabled
    ON email_templates ((trigger_config->>'auto_response_enabled'))
    WHERE trigger_config->>'auto_response_enabled' = 'true';

-- Template category
CREATE INDEX IF NOT EXISTS idx_email_templates_template_category
    ON email_templates(template_category);

-- Sends with trigger metadata (for sweep worker lookups)
CREATE INDEX IF NOT EXISTS idx_email_sends_trigger_metadata
    ON email_sends ((trigger_metadata->>'namespace'))
    WHERE trigger_metadata != '{}';

-- =============================================================================
-- SEED TEMPLATES — Common outreach and response scenarios
-- =============================================================================

INSERT INTO email_templates (
    slug, name, subject_template, body_html, template_category,
    trigger_config, response_map, profile_variables, tags, category
) VALUES
(
    'lead-initial-outreach',
    'Lead Initial Outreach',
    'Government Contracting Opportunities for {{company_name}}',
    '<h2>Hi {{contact_name}},</h2><p>I noticed {{company_name}} has capabilities that align well with several upcoming {{tier}} opportunities we''re tracking...</p><p>Would you be interested in learning how our AI-powered platform can help {{company_name}} discover and win more contracts?</p><p>Best regards,<br>RFP Pipeline Team</p>',
    'outreach',
    '{"namespace": "capture", "type": "lead.outreach", "expected_responses": ["interest","question","decline","out_of_office"], "auto_response_enabled": true, "escalation_on": ["urgent","complaint"]}',
    '{"interest": {"template_slug": "lead-interest-followup", "delay_hours": 0, "priority": "high"}, "question": {"template_slug": "lead-question-response", "delay_hours": 0, "priority": "high"}, "decline": {"template_slug": "lead-decline-graceful", "delay_hours": 24, "priority": "low"}, "default": {"template_slug": "lead-generic-followup", "delay_hours": 4, "priority": "medium"}}',
    ARRAY['company_name', 'contact_name', 'tier', 'lifecycle_stage'],
    ARRAY['outreach', 'lead'],
    'campaign'
),
(
    'lead-interest-followup',
    'Lead Interest Follow-up',
    'Re: Government Contracting Opportunities for {{company_name}}',
    '<p>Thank you for your interest, {{contact_name}}!</p><p>Based on {{company_name}}''s profile, I''ve identified {{matched_count}} opportunities that could be a strong fit. Here are the top matches:</p><p>{{opportunity_summary}}</p><p>I''d love to schedule a brief demo to show you how our platform works. Would any of these times work?</p>',
    'response',
    '{"namespace": "capture", "type": "lead.interest_followup", "auto_response_enabled": false}',
    '{}',
    ARRAY['company_name', 'contact_name', 'matched_count', 'opportunity_summary'],
    ARRAY['response', 'lead', 'interest'],
    'campaign'
),
(
    'lead-question-response',
    'Lead Question Response',
    'Re: Government Contracting Opportunities for {{company_name}}',
    '<p>Great question, {{contact_name}}!</p><p>{{ai_response}}</p><p>Let me know if you have any other questions. I''m happy to set up a call to discuss further.</p>',
    'response',
    '{"namespace": "capture", "type": "lead.question_response", "auto_response_enabled": false}',
    '{}',
    ARRAY['company_name', 'contact_name', 'ai_response'],
    ARRAY['response', 'lead', 'question'],
    'campaign'
),
(
    'lead-decline-graceful',
    'Lead Graceful Decline',
    'Re: Government Contracting Opportunities for {{company_name}}',
    '<p>I completely understand, {{contact_name}}. Thank you for letting me know.</p><p>If {{company_name}}''s priorities change in the future, we''ll be here. We track opportunities across SBIR, STTR, BAA, and OTA programs and would be happy to help whenever you''re ready.</p><p>Wishing you all the best.</p>',
    'response',
    '{"namespace": "capture", "type": "lead.decline_acknowledged", "auto_response_enabled": false}',
    '{}',
    ARRAY['company_name', 'contact_name'],
    ARRAY['response', 'lead', 'decline'],
    'campaign'
),
(
    'customer-welcome-drip-1',
    'Customer Welcome - Day 1',
    'Welcome to RFP Pipeline, {{contact_name}}!',
    '<h2>Welcome aboard, {{contact_name}}!</h2><p>Your {{company_name}} workspace is ready. Here''s what you can do right away:</p><ul><li>Browse your personalized opportunity feed</li><li>Review your AI-generated match scores</li><li>Start your first proposal with our guided builder</li></ul><p>Your account manager will reach out within 24 hours to help you get the most out of the platform.</p>',
    'drip',
    '{"namespace": "capture", "type": "customer.welcome_drip", "step": "day_1", "auto_response_enabled": true, "expected_responses": ["question","help_request","feedback"]}',
    '{"question": {"template_slug": "lead-question-response", "delay_hours": 0, "priority": "high"}, "help_request": {"template_slug": "customer-help-response", "delay_hours": 0, "priority": "critical"}}',
    ARRAY['company_name', 'contact_name'],
    ARRAY['drip', 'welcome', 'onboarding'],
    'onboarding'
),
(
    'customer-help-response',
    'Customer Help Response',
    'Re: {{original_subject}}',
    '<p>Hi {{contact_name}},</p><p>Thank you for reaching out! I want to make sure we get this resolved for you quickly.</p><p>{{ai_response}}</p><p>If you need immediate assistance, you can reach our support team directly at support@rfppipeline.com.</p><p>Best regards,<br>RFP Pipeline Team</p>',
    'response',
    '{"namespace": "capture", "type": "customer.help_response", "auto_response_enabled": false}',
    '{}',
    ARRAY['contact_name', 'original_subject', 'ai_response'],
    ARRAY['response', 'customer', 'help'],
    'onboarding'
),
(
    'lead-generic-followup',
    'Lead Generic Follow-up',
    'Re: Government Contracting Opportunities for {{company_name}}',
    '<p>Hi {{contact_name}},</p><p>Thank you for getting back to us regarding government contracting opportunities for {{company_name}}.</p><p>I''d be happy to discuss this further. Would you have time for a brief call this week? We can walk through how our platform helps companies like yours discover and win more contracts.</p><p>Best regards,<br>RFP Pipeline Team</p>',
    'response',
    '{"namespace": "capture", "type": "lead.generic_followup", "auto_response_enabled": false}',
    '{}',
    ARRAY['company_name', 'contact_name'],
    ARRAY['response', 'lead', 'followup'],
    'campaign'
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- CONFIG updates
-- =============================================================================
INSERT INTO cms_config (key, value, description) VALUES
    ('email.auto_response_enabled', 'true', 'Global toggle for trigger-based auto-response system'),
    ('email.auto_response_always_hitl', 'true', 'Auto-responses always go through HITL queue (never bypass)')
ON CONFLICT (key) DO NOTHING;
