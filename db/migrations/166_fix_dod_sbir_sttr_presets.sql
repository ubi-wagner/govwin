-- 166_fix_dod_sbir_sttr_presets.sql
--
-- Correct the DoD compliance presets to the REAL DSIP program requirements (the seeded ones had a
-- simplified 3-volume shape and wrong page limits). Sourced from the DoD SBIR/STTR component BAAs:
--   • DoD SBIR/STTR proposals are a 5-volume DSIP set: Cover Sheet (form, no page count) · Technical
--     Volume (the only page-limited one) · Cost Volume (form) · Company Commercialization Report (form)
--     · Supporting Documents. Cover/Cost/CCR do NOT count toward the page limit.
--   • SBIR Phase I Technical Volume ~20 pages (DoD common; Navy/Army enforce 10 — component-specific).
--   • STTR Direct-to-Phase-II: Technical 20 pages + a Phase-I-equivalent/feasibility doc (~10 pages), and
--     the STTR work split — small business >= 40%, partner Research Institution >= 30% (by budget).
-- Also fixes the "15/1p" (a Cover Sheet is item_type=form_other now, so it never inherits the Technical
-- content template; resolveTemplateKey was hardened in the same change).

-- ── Correct the DoD SBIR Phase I preset (5-volume DSIP structure) ──────────────────────────────
UPDATE compliance_presets SET
  compliance_data = '{
    "page_limit_technical":20,"page_limit_cost":null,"font_family":"Times New Roman","font_size":"11pt",
    "min_font_size":10,"margins":"1 inch all sides","line_spacing":"single","header_required":true,
    "footer_required":true,"submission_format":"DSIP Volume Upload","pi_must_be_employee":true,
    "required_documents":["SBIR/STTR Certifications"]
  }'::jsonb,
  volumes_data = '[
    {"volume_number":1,"volume_name":"Proposal Cover Sheet","volume_format":"dsip_standard","items":[{"item_name":"Proposal Cover Sheet","item_type":"form_other","required":true}]},
    {"volume_number":2,"volume_name":"Technical Volume","volume_format":"dsip_standard","items":[{"item_name":"Technical Proposal","item_type":"word_doc","required":true,"page_limit":20}]},
    {"volume_number":3,"volume_name":"Cost Volume","volume_format":"dsip_standard","items":[{"item_name":"Cost Proposal","item_type":"spreadsheet","required":true}]},
    {"volume_number":4,"volume_name":"Company Commercialization Report","volume_format":"dsip_standard","items":[{"item_name":"Company Commercialization Report","item_type":"form_other","required":true}]},
    {"volume_number":5,"volume_name":"Supporting Documents","volume_format":"dsip_standard","items":[{"item_name":"Supporting Documents","item_type":"pdf","required":false},{"item_name":"SBIR/STTR Certifications","item_type":"form_sbir_certs","required":true}]}
  ]'::jsonb
WHERE name = 'DoD SBIR Phase I Standard';

-- ── Add a proper DoD Direct-to-Phase-II STTR preset (with the RI 30% / SB 40% split) ─────────────
INSERT INTO compliance_presets (name, phase_type, agency, program_type, compliance_data, volumes_data, is_system)
SELECT 'DoD Direct-to-Phase-II STTR', 'direct_to_phase_2', 'Department of Defense', 'sttr',
  '{
    "page_limit_technical":20,"font_family":"Times New Roman","font_size":"11pt","min_font_size":10,
    "margins":"1 inch all sides","line_spacing":"single","header_required":true,"footer_required":true,
    "submission_format":"DSIP Volume Upload",
    "custom_variables":{"sttr_small_business_min_pct":40,"sttr_research_institution_min_pct":30,"phase_i_equivalent_required":true},
    "required_documents":["Research Institution Partnership Agreement","Allocation of Work (SB >= 40%, RI >= 30%)","Letters of Support"]
  }'::jsonb,
  '[
    {"volume_number":1,"volume_name":"Proposal Cover Sheet","volume_format":"dsip_standard","items":[{"item_name":"Proposal Cover Sheet","item_type":"form_other","required":true}]},
    {"volume_number":2,"volume_name":"Technical Volume","volume_format":"dsip_standard","items":[{"item_name":"Technical Proposal","item_type":"word_doc","required":true,"page_limit":20},{"item_name":"Phase I Equivalent / Feasibility Documentation","item_type":"pdf","required":true,"page_limit":10}]},
    {"volume_number":3,"volume_name":"Cost Volume","volume_format":"dsip_standard","items":[{"item_name":"Cost Proposal","item_type":"spreadsheet","required":true}]},
    {"volume_number":4,"volume_name":"Company Commercialization Report","volume_format":"dsip_standard","items":[{"item_name":"Company Commercialization Report","item_type":"form_other","required":true}]},
    {"volume_number":5,"volume_name":"Supporting Documents","volume_format":"dsip_standard","items":[{"item_name":"Research Institution Partnership Agreement","item_type":"pdf","required":true},{"item_name":"Letters of Support","item_type":"pdf","required":false}]}
  ]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM compliance_presets WHERE name = 'DoD Direct-to-Phase-II STTR');
