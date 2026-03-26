-- =============================================================================
-- Migration 024 — Grinder System Config, Pipeline Schedules, Automation Rules
-- Seeds configuration for the AI-powered proposal assembly pipeline.
-- =============================================================================

BEGIN;

-- ─── System Config: AI & Embedding Settings ──────────────────
INSERT INTO system_config (key, value, description) VALUES
    ('ai.rfp_parser_model',          '"claude-sonnet-4-20250514"',   'Model for RFP shredding/parsing'),
    ('ai.reanimator_model',          '"claude-sonnet-4-20250514"',   'Model for proposal section drafting'),
    ('ai.refinement_model',          '"claude-haiku-4-5-20251001"',  'Fast model for page-fit refinement'),
    ('ai.categorization_model',      '"claude-haiku-4-5-20251001"',  'Fast model for atom categorization'),
    ('embeddings.model',             '"text-embedding-3-small"',     'OpenAI embedding model'),
    ('embeddings.dimensions',        '"1536"',                       'Embedding vector dimensions'),
    ('embeddings.batch_size',        '"100"',                        'Max items per embedding batch'),
    ('grinder.max_refinement_passes','"5"',                          'Max AI refinement passes per section'),
    ('grinder.page_chars_estimate',  '"3000"',                       'Estimated characters per page (12pt, single-spaced)'),
    ('grinder.min_confidence_auto',  '"0.75"',                       'Min confidence to auto-populate a section'),
    ('library.auto_approve_threshold','"0.90"',                      'Auto-approve atoms above this confidence'),
    ('library.max_atoms_per_upload', '"50"',                         'Safety limit for atoms extracted per upload')
ON CONFLICT (key) DO NOTHING;

-- ─── Pipeline Schedules: Docling & Embedding Workers ─────────
INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, priority, timeout_minutes) VALUES
    ('docling_processor',   'Upload Processor (Docling)',  'process', '*/5 * * * *',  2, 15),
    ('embedding_generator', 'Embedding Generator',         'embed',   '*/10 * * * *', 3, 10)
ON CONFLICT (source) DO NOTHING;

-- ─── Automation Rules: Library & Proposal Events ─────────────
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority) VALUES
    ('upload_ingested_log',
     'Log when an upload is ingested into the atomic library',
     'customer_events', '{library.upload_ingested}', '{}', 'log_only',
     '{"message_template": "Upload ingested for tenant {refs.tenant_id}: {payload.atom_count} atoms extracted from {payload.filename}"}',
     80),
    ('atom_approved_log',
     'Log atom approvals for quality tracking',
     'customer_events', '{library.atom_approved}', '{}', 'log_only',
     '{"message_template": "Library atom approved: {payload.category}/{payload.title} by {actor.email}"}',
     90),
    ('proposal_created_log',
     'Log proposal creation for pipeline tracking',
     'customer_events', '{proposal.created}', '{}', 'log_only',
     '{"message_template": "Proposal created: {payload.title} for opp {refs.opportunity_id} by {actor.email}"}',
     50),
    ('proposal_completed_notify',
     'Notify when a proposal is marked complete and ready for export',
     'customer_events', '{proposal.completed}', '{}', 'queue_notification',
     '{"notification_type": "proposal_complete", "subject_template": "Proposal ready for export: {payload.title}", "priority": 3}',
     30),
    ('proposal_exported_log',
     'Log proposal exports for audit trail',
     'customer_events', '{proposal.exported}', '{}', 'log_only',
     '{"message_template": "Proposal exported: {payload.title} as {payload.format} by {actor.email}"}',
     80),
    ('rfp_template_correction_log',
     'Log user corrections to AI-extracted RFP templates for learning loop',
     'customer_events', '{rfp.template_corrected}', '{}', 'log_only',
     '{"message_template": "Template correction for {payload.agency}/{payload.program_type}: {payload.correction_summary}"}',
     70)
ON CONFLICT (name) DO NOTHING;

COMMIT;
