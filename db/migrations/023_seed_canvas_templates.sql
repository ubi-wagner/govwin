-- 023_seed_canvas_templates.sql
--
-- Seed system-level canvas document templates for common DoD proposal types.
-- These define the section structure, compliance rules, and starter content
-- for each template type. The full CanvasDocument JSON lives in S3; the
-- canvas_preset column here stores the CanvasRules (fonts, margins, page limits).
--
-- Purely additive. Idempotent.

-- ─── 1. SBIR Phase I Technical Volume (15 pages, Word) ────────────────
INSERT INTO document_templates (
  name, description, template_type, agency, program_type,
  storage_key, canvas_preset, node_count, is_system, metadata
) VALUES (
  'DoD SBIR Phase I — Technical Volume',
  '15-page technical volume for DoD SBIR Phase I proposals. Times New Roman 10pt, 1-inch margins, single-spaced. Structured per standard DoD BAA requirements with all required sections.',
  'technical_volume',
  'Department of Defense',
  'sbir_phase_1',
  'rfp-admin/system/templates/dod-sbir-phase1-technical.json',
  '{
    "format": "letter",
    "width": 612, "height": 792,
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "header": { "template": "{topic_number} — {company_name}", "height": 36, "font": { "family": "Times New Roman", "size": 10 } },
    "footer": { "template": "{company_name} | Page {n} of {N}", "height": 36, "font": { "family": "Times New Roman", "size": 10 } },
    "font_default": { "family": "Times New Roman", "size": 10 },
    "line_spacing": 1.0,
    "max_pages": 15,
    "max_slides": null
  }'::jsonb,
  42,
  true,
  '{
    "version": "2026.1",
    "sections": [
      "Cover Page",
      "Table of Contents",
      "Technical Approach",
      "Key Personnel",
      "Facilities / Equipment",
      "Related Work",
      "Cost Proposal Summary",
      "Commercialization Strategy",
      "TABA Plan"
    ],
    "compliance_notes": "Per DSIP standard BAA. Verify against specific BAA preface for topic-specific requirements.",
    "typical_eval_criteria": ["technical_merit", "qualifications", "price_reasonableness", "commercialization_potential"]
  }'::jsonb
)
ON CONFLICT DO NOTHING;

-- ─── 2. DoD SBIR Phase II Technical Volume (30 pages, Word) ───────────
INSERT INTO document_templates (
  name, description, template_type, agency, program_type,
  storage_key, canvas_preset, node_count, is_system, metadata
) VALUES (
  'DoD SBIR Phase II — Technical Volume',
  '30-page technical volume for DoD SBIR Phase II proposals. Times New Roman 12pt, 1-inch margins. More detailed than Phase I with expanded sections for prior Phase I results.',
  'technical_volume',
  'Department of Defense',
  'sbir_phase_2',
  'rfp-admin/system/templates/dod-sbir-phase2-technical.json',
  '{
    "format": "letter",
    "width": 612, "height": 792,
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "header": { "template": "{topic_number} — {company_name}", "height": 36, "font": { "family": "Times New Roman", "size": 10 } },
    "footer": { "template": "{company_name} | Page {n} of {N}", "height": 36, "font": { "family": "Times New Roman", "size": 10 } },
    "font_default": { "family": "Times New Roman", "size": 12 },
    "line_spacing": 1.0,
    "max_pages": 30,
    "max_slides": null
  }'::jsonb,
  56,
  true,
  '{
    "version": "2026.1",
    "sections": [
      "Cover Page",
      "Table of Contents",
      "Phase I Results Summary",
      "Technical Approach",
      "Phase II Work Plan",
      "Schedule and Milestones",
      "Key Personnel",
      "Facilities / Equipment",
      "Related Work",
      "Subcontractor Plan",
      "Commercialization Strategy",
      "TABA Plan"
    ],
    "compliance_notes": "Per DSIP standard BAA. Phase II requires Phase I results summary and detailed work plan with milestones.",
    "typical_eval_criteria": ["technical_merit", "phase1_results", "qualifications", "work_plan", "commercialization_potential", "price_reasonableness"]
  }'::jsonb
)
ON CONFLICT DO NOTHING;

-- ─── 3. CSO Phase I Briefing (10 slides, PPTX) ───────────────────────
INSERT INTO document_templates (
  name, description, template_type, agency, program_type,
  storage_key, canvas_preset, node_count, is_system, metadata
) VALUES (
  'DoD CSO Phase I — Pitch Briefing',
  '10-slide pitch briefing for CSO (Commercialization-focused SBIR/STTR Open) Phase I. Arial 18pt, 16:9 widescreen format. Structured per standard AFWERX/CSO pitch deck requirements.',
  'slide_deck',
  'Department of Defense',
  'cso',
  'rfp-admin/system/templates/dod-cso-phase1-briefing.json',
  '{
    "format": "slide_16_9",
    "width": 960, "height": 540,
    "margins": { "top": 40, "right": 40, "bottom": 40, "left": 40 },
    "header": null,
    "footer": null,
    "font_default": { "family": "Arial", "size": 18 },
    "line_spacing": 1.2,
    "max_pages": null,
    "max_slides": 10
  }'::jsonb,
  35,
  true,
  '{
    "version": "2026.1",
    "slides": [
      "Title Slide",
      "Problem / Need Statement",
      "Proposed Solution / Innovation",
      "Technical Approach",
      "Team Qualifications",
      "Phase I Objectives & Milestones",
      "Phase II Vision",
      "Commercialization Strategy",
      "Budget Overview",
      "Summary / Questions"
    ],
    "compliance_notes": "CSO briefings are typically 10 slides max. No backup slides allowed in scoring. Verify slide limit against specific CSO solicitation.",
    "typical_eval_criteria": ["innovation", "technical_feasibility", "team", "commercialization", "schedule_risk"]
  }'::jsonb
)
ON CONFLICT DO NOTHING;

-- ─── 4. Cost Volume — SBIR Phase I (Excel-style, Word) ────────────────
INSERT INTO document_templates (
  name, description, template_type, agency, program_type,
  storage_key, canvas_preset, node_count, is_system, metadata
) VALUES (
  'DoD SBIR Phase I — Cost Volume',
  'Cost proposal template for DoD SBIR Phase I. Includes labor categories, rates, materials, travel, subcontracts, and indirect costs. Standard cost format accepted by most DoD agencies.',
  'cost_volume',
  'Department of Defense',
  'sbir_phase_1',
  'rfp-admin/system/templates/dod-sbir-phase1-cost.json',
  '{
    "format": "letter",
    "width": 612, "height": 792,
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "header": { "template": "Cost Proposal — {topic_number}", "height": 36, "font": { "family": "Arial", "size": 10 } },
    "footer": { "template": "{company_name} | PROPRIETARY", "height": 36, "font": { "family": "Arial", "size": 10 } },
    "font_default": { "family": "Arial", "size": 10 },
    "line_spacing": 1.15,
    "max_pages": null,
    "max_slides": null
  }'::jsonb,
  18,
  true,
  '{
    "version": "2026.1",
    "sections": [
      "Cost Summary",
      "Labor Categories & Rates",
      "Materials & Supplies",
      "Travel",
      "Subcontracts / Consultants",
      "Other Direct Costs",
      "Indirect Costs",
      "Fee / Profit"
    ],
    "compliance_notes": "SBIR Phase I budget typically $50K-$275K for 6-12 month PoP. Fee/profit capped at reasonable rate (typically 7-10%)."
  }'::jsonb
)
ON CONFLICT DO NOTHING;

-- ─── 5. Key Personnel Bio Template ────────────────────────────────────
INSERT INTO document_templates (
  name, description, template_type, agency, program_type,
  storage_key, canvas_preset, node_count, is_system, metadata
) VALUES (
  'Key Personnel — Bio Template',
  'Standard key personnel biography format for DoD SBIR/STTR proposals. One page per person: name, title, role, education, relevant experience, publications, current/pending support.',
  'key_personnel',
  NULL,
  NULL,
  'rfp-admin/system/templates/key-personnel-bio.json',
  '{
    "format": "letter",
    "width": 612, "height": 792,
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "header": null,
    "footer": null,
    "font_default": { "family": "Times New Roman", "size": 10 },
    "line_spacing": 1.0,
    "max_pages": 1,
    "max_slides": null
  }'::jsonb,
  12,
  true,
  '{
    "version": "2026.1",
    "per_person": true,
    "fields": ["name", "title", "role", "education", "experience", "publications", "current_pending_support"]
  }'::jsonb
)
ON CONFLICT DO NOTHING;

-- ─── 6. Past Performance Template ─────────────────────────────────────
INSERT INTO document_templates (
  name, description, template_type, agency, program_type,
  storage_key, canvas_preset, node_count, is_system, metadata
) VALUES (
  'Past Performance — Narrative Template',
  'Past performance narrative for DoD proposals. Per-contract format: contract info, relevance statement, technical outcomes, schedule performance, cost performance, customer reference contact.',
  'past_performance',
  NULL,
  NULL,
  'rfp-admin/system/templates/past-performance-narrative.json',
  '{
    "format": "letter",
    "width": 612, "height": 792,
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "header": null,
    "footer": null,
    "font_default": { "family": "Times New Roman", "size": 10 },
    "line_spacing": 1.0,
    "max_pages": null,
    "max_slides": null
  }'::jsonb,
  14,
  true,
  '{
    "version": "2026.1",
    "per_contract": true,
    "fields": ["contract_number", "agency", "period_of_performance", "contract_value", "relevance", "technical_outcomes", "schedule_performance", "cost_performance", "reference_name", "reference_phone", "reference_email"]
  }'::jsonb
)
ON CONFLICT DO NOTHING;
