-- 156_seed_tvsf_compliance_preset.sql
-- Systemic fix for TVSF compliance: a reusable compliance_presets row encoding the EC/DMVEC
-- Round-45 rules section-by-section, so curating ANY Ohio TVSF via apply-preset produces the
-- correct matrix (narrative vs native-table per §; the $200k / 20%-personnel / no-cost-share
-- budget caps; pro-forma 2027-2031 + mandatory TVSF row; the required native tables). This is
-- what makes the fully-automated doorbell build come out compliant instead of the auto-mode
-- failures Paul Jackson's deterministic parser caught. See docs/TVSF_PAUL_TWO_ROLE_GUIDE.md.
-- Idempotent (guarded by name). jsonb written as proper jsonb (apply-preset coerceJsonb-safe).

INSERT INTO compliance_presets (name, phase_type, agency, program_type, is_system, compliance_data, volumes_data)
SELECT
  'Ohio TVSF Round 45 (DMVEC)', 'tvsf', 'Ohio Third Frontier', 'tvsf', true,
  '{
    "page_limit_technical": 7,
    "font_family": "Times New Roman",
    "font_size": "11",
    "margins": "0.75 inch (all sides)",
    "line_spacing": "exactly 12 pt",
    "submission_format": "Proposal (<=7 pages, Abstract excluded) + Budget",
    "slides_allowed": false,
    "itar_required": false,
    "header_required": false,
    "footer_required": false,
    "required_sections": ["Abstract","1. Market Opportunity","2. Overview of Technology/Product","3. Development Stage & Timeline","4. Commercialization Strategy","5. Intellectual Property","6. Business Model & Pro-forma P&L","7. Current Financial Stage","8. Economic Impact on Ohio","9. Management Team","10. ESP Engagement","11. Project Plan","12. Budget","13. Next Steps","14. Major Risks & Mitigation"],
    "required_documents": ["Willingness-to-License Letter","ESP Support Letter"],
    "custom_variables": {
      "budget_cap_usd": {"value": "200000"},
      "personnel_max_pct": {"value": "20"},
      "cost_share_allowed": {"value": "false"},
      "pro_forma_years": {"value": "2027-2031"},
      "pro_forma_mandatory_rows": {"value": "TVSF revenue row; Total revenues; Gross profit; Total other expenses; Net profit"},
      "required_native_tables": {"value": "Competitor (2); Gantt (3); Pro-forma P&L (6); Milestone (11); Budget (12); Risk (14)"},
      "market_opportunity_external_only": {"value": "true"},
      "submission_format": {"value": "Proposal (<=7 pages, Abstract excluded) + Budget"}
    }
  }'::jsonb,
  '[
    {"volume_name":"Proposal","volume_number":1,"volume_format":"tvsf_narrative","description":"7-page narrative (Abstract excluded). US-Letter, 0.75in margins, 11pt Times New Roman, exactly 12pt line spacing, left-aligned.","items":[
      {"item_name":"Abstract (public; excluded from 7-page count; no trade secrets)","item_type":"word_doc","required":true},
      {"item_name":"1. Market Opportunity (external only; state TAM; SAM/SOM; hyperlinks allowed here only)","item_type":"word_doc","required":true},
      {"item_name":"2. Overview of Technology/Product (native competitor comparison table)","item_type":"word_doc","required":true},
      {"item_name":"3. Development Stage & Timeline (native Gantt/timeline table; state TRL)","item_type":"word_doc","required":true},
      {"item_name":"4. Commercialization Strategy (open with the SAM)","item_type":"word_doc","required":true},
      {"item_name":"5. Intellectual Property (licensed IP + compare vs alternatives)","item_type":"word_doc","required":true},
      {"item_name":"6. Business Model & Pro-forma P&L (native table 2027-2031; mandatory TVSF revenue row)","item_type":"word_doc","required":true},
      {"item_name":"7. Current Financial Stage","item_type":"word_doc","required":true},
      {"item_name":"8. Economic Impact on Ohio","item_type":"word_doc","required":true},
      {"item_name":"9. Management Team (highest-weighted; names, FTE %, $ raised across ventures)","item_type":"word_doc","required":true},
      {"item_name":"10. ESP Engagement (the Entrepreneurs Center)","item_type":"word_doc","required":true},
      {"item_name":"11. Project Plan (native milestone table: Name/Desc/Timeframe/Funds/Vendor; funds sum to ask)","item_type":"word_doc","required":true},
      {"item_name":"12. Budget: Table & Narrative (ask <= $200k; Personnel <= 20%; no cost share; narrate every line)","item_type":"word_doc","required":true},
      {"item_name":"13. Next Steps (no exit language)","item_type":"word_doc","required":true},
      {"item_name":"14. Major Risks & Mitigation (native Risk table: Risk/Type/Severity/Mitigation)","item_type":"word_doc","required":true}
    ]},
    {"volume_name":"Budget","volume_number":2,"volume_format":"tvsf_budget","description":"Spend-type budget: Personnel / Equipment / Supplies / Purchased Services / Total. OTF ask <= $200,000; no cost share.","items":[
      {"item_name":"Budget (spend-type table; $200,000 cap; Personnel <= $40,000)","item_type":"spreadsheet","required":true}
    ]},
    {"volume_name":"Supporting Letters","volume_number":3,"volume_format":"tvsf_letters","description":"Two required <=1-page letters.","items":[
      {"item_name":"Willingness-to-License Letter (from the IP-owning institution)","item_type":"pdf","required":true},
      {"item_name":"ESP Support Letter (from the EC)","item_type":"pdf","required":true}
    ]}
  ]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM compliance_presets WHERE name = 'Ohio TVSF Round 45 (DMVEC)');
