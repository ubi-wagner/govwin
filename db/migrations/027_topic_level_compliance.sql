-- 027_topic_level_compliance.sql
--
-- Support per-topic compliance overrides and per-topic volumes.
-- Topics inherit from the solicitation baseline but can override
-- any field. The proposal provisioning resolves: topic -> solicitation -> defaults.
--
-- Purely additive. Idempotent.

-- ── 1. Topic-level compliance overrides ─────────────────────────────
-- Nullable topic_id: when NULL, this is the solicitation baseline (existing behavior).
-- When set, it's an override for that specific topic.
ALTER TABLE solicitation_compliance
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES opportunities(id) ON DELETE CASCADE;

-- Allow multiple compliance rows per solicitation (one baseline + N topic overrides)
-- Uses COALESCE sentinel so NULL topic_id participates in uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_sol_topic
  ON solicitation_compliance (solicitation_id, COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'));

-- ── 2. Topic-level volumes ──────────────────────────────────────────
-- Same pattern: nullable topic_id. When NULL, applies to all topics (baseline).
-- When set, these volumes are specific to that topic.
ALTER TABLE solicitation_volumes
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES opportunities(id) ON DELETE CASCADE;

-- The old unique constraint is (solicitation_id, volume_number) from 012.
-- We need to widen it to include topic_id so the same volume_number can
-- exist for different topics under the same solicitation.
-- Note: must drop the CONSTRAINT (not the index) because the index backs
-- the UNIQUE table constraint created in 012.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'solicitation_volumes'
      AND constraint_name = 'solicitation_volumes_solicitation_id_volume_number_key'
  ) THEN
    ALTER TABLE solicitation_volumes
      DROP CONSTRAINT solicitation_volumes_solicitation_id_volume_number_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_volumes_sol_topic_num
  ON solicitation_volumes (solicitation_id, COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'), volume_number);

-- ── 3. Topic phase type for grouping ────────────────────────────────
-- Ensure opportunities table has a phase column for grouping.
-- (topic_status from 013 tracks lifecycle, not proposal phase type)
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS phase_type TEXT
    CHECK (phase_type IN ('phase_1','phase_2','direct_to_phase_2','phase_3','cso','ota','baa','other'));

-- ── 4. Compliance template presets (for "apply to all Phase I" UX) ──
CREATE TABLE IF NOT EXISTS compliance_presets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phase_type      TEXT NOT NULL,
  agency          TEXT,
  program_type    TEXT,
  compliance_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  volumes_data    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system       BOOLEAN DEFAULT false,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint so ON CONFLICT works for idempotent seeding
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_presets_name_phase
  ON compliance_presets (name, phase_type);

-- Seed common presets
INSERT INTO compliance_presets (name, phase_type, program_type, is_system, compliance_data, volumes_data)
VALUES
  (
    'DoD SBIR Phase I Standard',
    'phase_1',
    'sbir_phase_1',
    true,
    '{"page_limit_technical": 15, "font_family": "Times New Roman", "font_size": "10pt", "margins": "1 inch all sides", "line_spacing": "1.0", "submission_format": "DSIP Volume Upload", "header_required": true, "header_format": "{topic_number} — {company_name}", "footer_required": true, "footer_format": "{company_name} | Page {n} of {N}", "taba_allowed": true, "pi_must_be_employee": true}'::jsonb,
    '[{"volume_name": "Technical Volume", "volume_number": 1, "items": [{"item_name": "Technical Proposal", "item_type": "word_doc", "page_limit": 15}, {"item_name": "Cover Page", "item_type": "word_doc", "page_limit": 1}]}, {"volume_name": "Cost Volume", "volume_number": 2, "items": [{"item_name": "Cost Proposal", "item_type": "spreadsheet"}, {"item_name": "Budget Justification", "item_type": "word_doc"}]}, {"volume_name": "Supporting Documents", "volume_number": 3, "items": [{"item_name": "Company Commercialization Report", "item_type": "pdf"}, {"item_name": "SBIR/STTR Funding Agreement Certification", "item_type": "form_sbir_certs"}]}]'::jsonb
  ),
  (
    'DoD SBIR Phase II Standard',
    'phase_2',
    'sbir_phase_2',
    true,
    '{"page_limit_technical": 30, "font_family": "Times New Roman", "font_size": "12pt", "margins": "1 inch all sides", "line_spacing": "1.0", "submission_format": "DSIP Volume Upload", "header_required": true, "footer_required": true, "taba_allowed": true, "pi_must_be_employee": true}'::jsonb,
    '[{"volume_name": "Technical Volume", "volume_number": 1, "items": [{"item_name": "Technical Proposal", "item_type": "word_doc", "page_limit": 30}, {"item_name": "Phase I Results Summary", "item_type": "word_doc", "page_limit": 5}]}, {"volume_name": "Cost Volume", "volume_number": 2, "items": [{"item_name": "Cost Proposal", "item_type": "spreadsheet"}, {"item_name": "Budget Justification", "item_type": "word_doc"}]}, {"volume_name": "Supporting Documents", "volume_number": 3, "items": [{"item_name": "Company Commercialization Report", "item_type": "pdf"}, {"item_name": "SBIR/STTR Funding Agreement Certification", "item_type": "form_sbir_certs"}, {"item_name": "Subcontractor Budget", "item_type": "spreadsheet"}]}]'::jsonb
  ),
  (
    'DoD CSO Phase I Pitch',
    'phase_1',
    'cso',
    true,
    '{"slides_allowed": true, "slide_limit": 10, "font_family": "Arial", "font_size": "18pt", "submission_format": "PPTX Upload"}'::jsonb,
    '[{"volume_name": "Pitch Deck", "volume_number": 1, "items": [{"item_name": "Pitch Briefing", "item_type": "slide_deck", "slide_limit": 10}]}, {"volume_name": "Cost Volume", "volume_number": 2, "items": [{"item_name": "Cost Proposal", "item_type": "spreadsheet"}]}]'::jsonb
  ),
  (
    'DoD Direct to Phase II',
    'direct_to_phase_2',
    'sbir_phase_2',
    true,
    '{"page_limit_technical": 40, "font_family": "Times New Roman", "font_size": "12pt", "margins": "1 inch all sides", "line_spacing": "1.0", "submission_format": "DSIP Volume Upload", "header_required": true, "footer_required": true}'::jsonb,
    '[{"volume_name": "Technical Volume", "volume_number": 1, "items": [{"item_name": "Technical Proposal", "item_type": "word_doc", "page_limit": 40}, {"item_name": "Equivalent Phase I Report", "item_type": "word_doc", "page_limit": 10}]}, {"volume_name": "Cost Volume", "volume_number": 2, "items": [{"item_name": "Cost Proposal", "item_type": "spreadsheet"}]}, {"volume_name": "Supporting Documents", "volume_number": 3, "items": [{"item_name": "Phase I Equivalent Documentation", "item_type": "pdf"}, {"item_name": "Letters of Support", "item_type": "pdf"}]}]'::jsonb
  )
ON CONFLICT (name, phase_type) DO NOTHING;
