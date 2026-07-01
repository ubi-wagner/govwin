-- Migration 098: per-portal workflow — RFP-admin-settable guardrail limits + defaults,
-- and portal stage progress.
--
-- The global default guardrail template (guardrail_templates, tenant_id NULL,
-- is_default) holds the HARD LIMITS (max 3 stages, 10 collaborators, 1 manager, 3
-- nudges) and the DEFAULTS the RFP admin can change for future portals. A customer's
-- per-portal guardrails are validated against these limits at accept-launch, then the
-- workflow is instantiated (stage ToDos in the existing tasks/nudge ledger).

ALTER TABLE proposal_portals
    ADD COLUMN IF NOT EXISTS current_stage_index INT NOT NULL DEFAULT 0;

-- Seed the RFP-admin-editable system defaults (idempotent).
INSERT INTO guardrail_templates (tenant_id, name, description, config, is_default)
SELECT NULL,
       'System Defaults',
       'RFP-admin default guardrails + hard limits for customer portals',
       jsonb_build_object(
         'limits',   jsonb_build_object('maxStages', 3, 'maxCollaborators', 10, 'maxManagers', 1, 'maxNudges', 3),
         'defaults', jsonb_build_object(
           'nudgeDays', jsonb_build_array(2, 5, 9),
           'todoTypes', jsonb_build_array('acknowledge', 'complete_sections', 'upload_documents'),
           'stages', jsonb_build_array(
             jsonb_build_object('key', 'draft',  'label', 'Draft'),
             jsonb_build_object('key', 'review', 'label', 'Review'),
             jsonb_build_object('key', 'final',  'label', 'Final')
           )
         )
       ),
       true
WHERE NOT EXISTS (SELECT 1 FROM guardrail_templates WHERE tenant_id IS NULL AND is_default = true);
