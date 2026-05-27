-- =============================================================================
-- Migration 049: Clean slate for HITL testing
-- Depends on: 048
--
-- Removes all tenant-generated data while preserving:
--   - User accounts (migration 041 test accounts + any others)
--   - System config, migration history
--   - CMS content (marketing site content)
--   - SBIR reference data (sbir_companies, sbir_awards)
--   - Source profiles (admin-configured scouts)
--   - Compliance presets (admin-configured templates)
--   - Automation rules (system-seeded)
--
-- After this migration, HITL testing starts from the application/onboarding
-- flow and builds up real data through the documented test sessions.
--
-- Safe to run multiple times (all DELETEs are idempotent).
-- =============================================================================

-- ── Proposal workspace data (most dependent, delete first) ───────────
DELETE FROM proposal_activity_log;
DELETE FROM stage_completion_snapshots;
DELETE FROM canvas_versions;
DELETE FROM proposal_supporting_docs;
DELETE FROM stage_gate_requirements;
DELETE FROM proposal_compliance_matrix;
DELETE FROM proposal_reviews;
DELETE FROM proposal_comments;
DELETE FROM proposal_stage_history;
DELETE FROM collaborator_stage_access;
DELETE FROM proposal_collaborators;
DELETE FROM proposal_sections;
DELETE FROM proposals;

-- ── Library data ─────────────────────────────────────────────────────
DELETE FROM library_atom_outcomes;
DELETE FROM library_harvest_log;
DELETE FROM library_units;
DELETE FROM tenant_uploads;

-- ── Pipeline scoring data ────────────────────────────────────────────
DELETE FROM tenant_actions;
DELETE FROM tenant_pipeline_items;

-- ── Agent memory + task data ─────────────────────────────────────────
DELETE FROM agent_task_results;
DELETE FROM agent_task_log;
DELETE FROM agent_task_queue;
DELETE FROM agent_performance;
DELETE FROM procedural_memories;
DELETE FROM semantic_memories;
DELETE FROM episodic_memories;
DELETE FROM tenant_agent_config;

-- ── Purchases ────────────────────────────────────────────────────────
DELETE FROM purchases;

-- ── Curation data (keep solicitations structure, clear work product) ─
DELETE FROM curation_revisions;
DELETE FROM solicitation_annotations;
DELETE FROM triage_actions;

-- ── Workflow instances ───────────────────────────────────────────────
DELETE FROM process_instance_transitions;
DELETE FROM process_instances;

-- ── Events (clear the audit trail for fresh start) ───────────────────
DELETE FROM system_events;
DELETE FROM opportunity_events;
DELETE FROM customer_events;
DELETE FROM content_events;
DELETE FROM automation_log;

-- ── Analytics ────────────────────────────────────────────────────────
DELETE FROM page_views;
DELETE FROM visitor_sessions;
DELETE FROM tool_invocation_metrics;
DELETE FROM system_health_snapshots;

-- ── Spotlights ───────────────────────────────────────────────────────
DELETE FROM spotlights;

-- ── Invitations + consent ────────────────────────────────────────────
DELETE FROM invitations;
DELETE FROM consent_records;

-- ── Tenant profiles (will be re-created during HITL profile setup) ───
DELETE FROM tenant_profiles;

-- ── Tenants (remove all tenants — users keep their tenant_id but
--    tenants themselves are gone; HITL creates new ones via accept flow)
-- First detach users from tenants so FK doesn't block
UPDATE users SET tenant_id = NULL WHERE tenant_id IS NOT NULL
  AND role NOT IN ('master_admin', 'rfp_admin');

DELETE FROM tenants;

-- ── Applications + waitlist (clear so HITL starts fresh) ─────────────
DELETE FROM applications;
DELETE FROM waitlist;

-- ── Curated solicitations + opportunities (clear RFP pipeline) ───────
-- Order matters for FK constraints
DELETE FROM volume_required_items;
DELETE FROM solicitation_volumes;
DELETE FROM solicitation_documents;
DELETE FROM solicitation_outlines;
DELETE FROM solicitation_templates;
DELETE FROM solicitation_compliance;
DELETE FROM curated_solicitations;
DELETE FROM opportunities;

-- ── Pipeline jobs (clear job history) ────────────────────────────────
DELETE FROM pipeline_runs;
DELETE FROM pipeline_jobs;

-- ── Reset pipeline schedule next_run_at so ingesters run fresh ───────
UPDATE pipeline_schedules SET next_run_at = now() WHERE is_active = true;

-- ── Source scout data (keep profiles, clear snapshots/diffs) ─────────
DELETE FROM source_diffs;
DELETE FROM source_snapshots;
DELETE FROM source_visits;
-- Keep source_profiles and source_regions (admin configuration)
