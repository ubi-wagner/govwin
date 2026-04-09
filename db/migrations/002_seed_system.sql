-- System configuration seeds
INSERT INTO system_config (key, value, description) VALUES
('llm_trigger_score', '50', 'Minimum score to trigger LLM analysis'),
('max_llm_adjustment', '15', 'Maximum LLM score adjustment (positive or negative)'),
('pipeline_retry_attempts', '3', 'Max retries for failed pipeline jobs'),
('default_claude_model', 'claude-sonnet-4-20250514', 'Default Claude model for agents'),
('agent_max_tokens_default', '4096', 'Default max output tokens for agents'),
('memory_decay_rate', '0.995', 'Daily memory decay multiplier'),
('memory_compaction_age_days', '30', 'Days before episodic memories eligible for compaction'),
('memory_gc_archive_age_days', '180', 'Days before archived memories are hard-deleted')
ON CONFLICT (key) DO NOTHING;

-- API key registry
INSERT INTO api_key_registry (source) VALUES ('sam_gov'), ('anthropic'), ('sbir_gov'), ('grants_gov')
ON CONFLICT (source) DO NOTHING;

-- Rate limits
INSERT INTO rate_limit_state (source, daily_limit, hourly_limit) VALUES
('sam_gov', 1000, 100),
('sbir_gov', 500, 30),
('grants_gov', 500, 50)
ON CONFLICT (source) DO NOTHING;

-- Source health
INSERT INTO source_health (source, status) VALUES
('sam_gov', 'unknown'),
('sbir_gov', 'unknown'),
('grants_gov', 'unknown')
ON CONFLICT (source) DO NOTHING;

-- Pipeline schedules
-- Idempotent via ON CONFLICT (source) DO NOTHING. Requires the
-- UNIQUE(source) constraint added to pipeline_schedules in
-- 001_baseline.sql. Pre-fix versions of this seed used unscoped
-- ON CONFLICT DO NOTHING with no constraint to bind to, which
-- silently inserted duplicates on every re-run. Migration
-- 005_dedupe_pipeline_schedules.sql cleans up any duplicates that
-- accumulated under that prior behavior on existing deploys.
INSERT INTO pipeline_schedules (source, run_type, cron_expression, enabled) VALUES
('sam_gov', 'incremental', '0 6 * * *', true),
('sbir_gov', 'full', '0 7 * * 1', true),
('grants_gov', 'incremental', '0 8 * * *', true),
('scoring', 'full', '30 6 * * *', true),
('memory_decay', 'full', '0 3 * * *', true),
('memory_gc', 'full', '0 4 * * 0', true),
('memory_compaction', 'full', '0 4 1 * *', true)
ON CONFLICT (source) DO NOTHING;

-- Legal documents
INSERT INTO legal_document_versions (document_type, version, effective_date) VALUES
('terms_of_service', '2026-04-v1', '2026-04-07'),
('privacy_policy', '2026-04-v1', '2026-04-07'),
('ai_disclosure', '2026-04-v1', '2026-04-07')
ON CONFLICT DO NOTHING;
