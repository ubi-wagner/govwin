-- Migration 084: structured + enforceable artifact specs (E2).
--
-- Adds min_font_size — the missing enforcement source (§8 prerequisite: E4
-- min-font enforcement had nothing to enforce; only a TEXT font_size existed) —
-- to both the compliance matrix and the per-volume items. Also gives
-- volume_required_items a structured canvas_preset / compliance_preset JSONB
-- home: the Template Studio editor (E3) writes these going forward, and the
-- create-route freezes a CanvasRules + ComplianceSpec onto proposal_artifacts at
-- purchase (E2.3). The legacy TEXT spec columns (font_size / margins /
-- line_spacing) stay as the human-authored source and are parsed into structured
-- specs at freeze time (frontend/lib/artifact-spec.ts).

ALTER TABLE solicitation_compliance
    ADD COLUMN IF NOT EXISTS min_font_size NUMERIC;

ALTER TABLE volume_required_items
    ADD COLUMN IF NOT EXISTS min_font_size     NUMERIC,
    ADD COLUMN IF NOT EXISTS canvas_preset     JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS compliance_preset JSONB NOT NULL DEFAULT '{}'::jsonb;
