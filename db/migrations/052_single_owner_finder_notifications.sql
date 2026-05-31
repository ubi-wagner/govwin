-- Migration 052: Single-owner notifications for finder uploads / scout changes
--
-- Kills the template-vs-rule DUPLICATE notification (EVENT_CONTRACT_V3 gap 4;
-- CLAUDE_CLIFFNOTES Mistake 20). Migration 028 seeded two automation_rules that
-- send notify_admin for finder:rfp.uploaded and finder:source.change_detected.
-- But the Process Templates already OWN those flows and notify rfp_admin via a
-- NOTIFY step AFTER the upstream work completes (shred/extract, draft creation):
--   * OnRfpUploaded.notify_curator         (to_role=rfp_admin, rfp_ready_for_curation)
--   * OnSourceChangeDetected.notify_rfp_admin
--
-- Net effect today: 2 admin emails per upload (template NOTIFY + rule notify_admin),
-- plus the rule itself double-fired on start AND end before the phase guard landed.
-- The template is the single owner — it runs after the work and can include the
-- compliance / draft context the bare rule cannot. Deactivate the duplicates.
--
-- Reversible: set is_active = true to restore the standalone rules.

UPDATE automation_rules
SET is_active = false
WHERE name IN ('New RFP ready for curation', 'Source change detected')
  AND action_type = 'notify_admin';
