-- =============================================================================
-- Comprehensive Test Seed Data
-- Aligned with SAM.gov API response fields and real-world gov contracting data
--
-- Personas:
--   1. admin@govwin.test       — master_admin (platform operator)
--   2. alice@techforward.test  — tenant_admin at TechForward Solutions (SDVOSB)
--   3. bob@techforward.test    — tenant_user at TechForward Solutions
--   4. carol@clearpath.test    — tenant_admin at ClearPath Consulting (8a/SB)
--
-- Test Tenants:
--   1. techforward-solutions  — IT services SDVOSB small business
--   2. clearpath-consulting   — Management consulting 8(a) small business
-- =============================================================================

-- ─── 1. TENANTS ──────────────────────────────────────────────────

-- Tenant: TechForward Solutions — SDVOSB IT services company
INSERT INTO tenants (id, slug, name, legal_name, plan, status,
  primary_email, primary_phone, website, uei_number, cage_code,
  sam_registered, internal_notes, onboarded_at, features, billing_email)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'techforward-solutions',
  'TechForward Solutions LLC',
  'TechForward Solutions LLC',
  'professional',
  'active',
  'alice@techforward.test',
  '703-555-0101',
  'https://techforward.example.com',
  'JQKL789GH012',       -- SAM.gov UEI format: 12 chars alphanumeric
  '6AB34',               -- CAGE code: 5 chars
  true,
  'Pilot customer. SDVOSB IT services. Primary focus: cloud migration, cybersecurity, DevSecOps.',
  NOW() - INTERVAL '30 days',
  '{"llm_analysis": true, "document_download": true, "portal_comments": true}'::jsonb,
  'billing@techforward.example.com'
);

-- Tenant: ClearPath Consulting — 8(a) management consulting
INSERT INTO tenants (id, slug, name, legal_name, plan, status,
  primary_email, primary_phone, website, uei_number, cage_code,
  sam_registered, internal_notes, onboarded_at, trial_ends_at, features, billing_email)
VALUES (
  'b2222222-2222-2222-2222-222222222222',
  'clearpath-consulting',
  'ClearPath Consulting Group',
  'ClearPath Consulting Group Inc.',
  'starter',
  'trial',
  'carol@clearpath.test',
  '202-555-0202',
  'https://clearpath.example.com',
  'MNOP456QR789',
  '7CD56',
  true,
  'Trial customer. 8(a) certified. Management consulting, program management, training.',
  NOW() - INTERVAL '7 days',
  NOW() + INTERVAL '23 days',
  '{"llm_analysis": false, "document_download": true, "portal_comments": true}'::jsonb,
  'billing@clearpath.example.com'
);

-- ─── 2. USERS ────────────────────────────────────────────────────
-- Passwords: all set to 'TestPass123!' via bcrypt hash
-- bcrypt hash for 'TestPass123!' (10 rounds)

INSERT INTO users (id, name, email, role, tenant_id, password_hash, temp_password, is_active, last_login_at) VALUES
  ('user-admin-001',
   'Admin User',
   'admin@govwin.test',
   'master_admin',
   NULL,
   '$2a$10$8KzVHxKKRqGBqJN.Xf3bLOqLQHJV2DWF8G0wVZGtqk9E3V3bZmRKy',
   false,
   true,
   NOW() - INTERVAL '1 hour'),

  ('user-alice-001',
   'Alice Chen',
   'alice@techforward.test',
   'tenant_admin',
   'a1111111-1111-1111-1111-111111111111',
   '$2a$10$8KzVHxKKRqGBqJN.Xf3bLOqLQHJV2DWF8G0wVZGtqk9E3V3bZmRKy',
   false,
   true,
   NOW() - INTERVAL '2 hours'),

  ('user-bob-001',
   'Bob Martinez',
   'bob@techforward.test',
   'tenant_user',
   'a1111111-1111-1111-1111-111111111111',
   '$2a$10$8KzVHxKKRqGBqJN.Xf3bLOqLQHJV2DWF8G0wVZGtqk9E3V3bZmRKy',
   false,
   true,
   NOW() - INTERVAL '5 hours'),

  ('user-carol-001',
   'Carol Washington',
   'carol@clearpath.test',
   'tenant_admin',
   'b2222222-2222-2222-2222-222222222222',
   '$2a$10$8KzVHxKKRqGBqJN.Xf3bLOqLQHJV2DWF8G0wVZGtqk9E3V3bZmRKy',
   false,
   true,
   NOW() - INTERVAL '1 day');

-- ─── 3. TENANT PROFILES (Scoring Config) ────────────────────────

-- TechForward: Cloud/Cyber/DevSecOps IT company
INSERT INTO tenant_profiles (
  tenant_id, primary_naics, secondary_naics, keyword_domains,
  is_small_business, is_sdvosb, is_wosb, is_hubzone, is_8a,
  agency_priorities, min_contract_value, max_contract_value,
  min_surface_score, high_priority_score, self_service, updated_by
) VALUES (
  'a1111111-1111-1111-1111-111111111111',
  ARRAY['541512', '541519', '541511'],   -- Computer systems design, other IT, custom programming
  ARRAY['518210', '541513', '541690'],   -- Cloud hosting, managed services, other S&T consulting
  '{
    "Cloud & Infrastructure": ["cloud migration", "AWS", "Azure", "GovCloud", "FedRAMP", "cloud infrastructure"],
    "Cybersecurity": ["cybersecurity", "NIST 800-53", "zero trust", "STIG", "RMF", "ATO", "vulnerability assessment"],
    "DevSecOps": ["DevSecOps", "CI/CD", "containerization", "Kubernetes", "Docker", "GitLab"],
    "Data & AI": ["machine learning", "data analytics", "artificial intelligence", "data engineering"]
  }'::jsonb,
  true,   -- is_small_business
  true,   -- is_sdvosb (Service-Disabled Veteran-Owned Small Business)
  false,  -- is_wosb
  false,  -- is_hubzone
  false,  -- is_8a
  '{"047": 1, "097": 1, "012": 2, "070": 2, "089": 3}'::jsonb,
  -- Agency priorities: GSA=tier1, DoD=tier1, Army=tier2, DHS=tier2, VA=tier3
  50000,      -- min_contract_value
  25000000,   -- max_contract_value
  35,         -- min_surface_score (lower threshold for wider pipeline)
  70,         -- high_priority_score
  false,
  'admin'
);

-- ClearPath: Management consulting 8(a) company
INSERT INTO tenant_profiles (
  tenant_id, primary_naics, secondary_naics, keyword_domains,
  is_small_business, is_sdvosb, is_wosb, is_hubzone, is_8a,
  agency_priorities, min_contract_value, max_contract_value,
  min_surface_score, high_priority_score, self_service, updated_by
) VALUES (
  'b2222222-2222-2222-2222-222222222222',
  ARRAY['541611', '541618'],              -- Admin mgmt consulting, other mgmt consulting
  ARRAY['541612', '611430', '541690'],    -- HR consulting, professional development training, other S&T
  '{
    "Program Management": ["program management", "PMO", "EVMS", "earned value", "Agile program"],
    "Training & Development": ["training", "workforce development", "learning management", "instructor-led"],
    "Organizational Consulting": ["organizational change", "strategic planning", "process improvement", "Lean Six Sigma"]
  }'::jsonb,
  true,   -- is_small_business
  false,  -- is_sdvosb
  false,  -- is_wosb
  false,  -- is_hubzone
  true,   -- is_8a
  '{"075": 1, "036": 2, "097": 2}'::jsonb,
  -- Agency priorities: HHS=tier1, VA=tier2, DoD=tier2
  25000,
  10000000,
  40,
  75,
  false,
  'admin'
);

-- ─── 4. OPPORTUNITIES ───────────────────────────────────────────
-- These match the EXACT SAM.gov API field mappings:
--   noticeId → source_id
--   title → title
--   description.body → description
--   fullParentPathName → agency
--   fullParentPathCode (first segment) → agency_code (we store the top-level code)
--   naicsCode → naics_codes[0]
--   typeOfSetAsideDescription → set_aside_type
--   typeOfSetAside → set_aside_code
--   type → opportunity_type (mapped: "o"→solicitation, "k"→sources_sought, "p"→presolicitation)
--   postedDate → posted_date (YYYY-MM-DD from SAM.gov)
--   responseDeadLine → close_date (ISO 8601 from SAM.gov)
--   solicitationNumber → solicitation_number
--   uiLink → source_url (https://sam.gov/opp/{noticeId}/view)
--   raw_data → full SAM.gov response object stored as JSONB

-- Opp 1: Cloud Migration — perfect match for TechForward
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  estimated_value_min, estimated_value_max,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000001-0001-0001-0001-000000000001',
  'sam_gov',
  'a3b4c5d6e7f8g9h0i1j2k3l4',
  'Enterprise Cloud Migration and Managed Services',
  'The Department of Defense seeks a qualified Service-Disabled Veteran-Owned Small Business (SDVOSB) to provide enterprise cloud migration services including assessment, planning, and execution of migration from on-premises infrastructure to AWS GovCloud. Scope includes FedRAMP authorization support, continuous monitoring, and 24/7 managed cloud infrastructure services. The contractor shall provide cloud architecture design, migration execution, security compliance (NIST 800-53, STIG), and ongoing managed services for a period of 5 years.',
  'DEPT OF DEFENSE.DEFENSE INFORMATION SYSTEMS AGENCY.DISA PL8',
  '097',
  ARRAY['541512'],
  'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside',
  'SDVOSBA',
  'solicitation',
  NOW() - INTERVAL '3 days',
  NOW() + INTERVAL '25 days',
  5000000,
  15000000,
  'HC1028-24-R-0042',
  'https://sam.gov/opp/a3b4c5d6e7f8g9h0i1j2k3l4/view',
  'abc123hash001',
  'active',
  -- raw_data: simulates exact SAM.gov API response shape
  '{
    "noticeId": "a3b4c5d6e7f8g9h0i1j2k3l4",
    "title": "Enterprise Cloud Migration and Managed Services",
    "solicitationNumber": "HC1028-24-R-0042",
    "department": "DEPT OF DEFENSE",
    "subTier": "DEFENSE INFORMATION SYSTEMS AGENCY",
    "office": "DISA PL8",
    "fullParentPathName": "DEPT OF DEFENSE.DEFENSE INFORMATION SYSTEMS AGENCY.DISA PL8",
    "fullParentPathCode": "097.DISA.PL8",
    "postedDate": "2026-02-21",
    "type": "Solicitation",
    "baseType": "Solicitation",
    "archiveType": "autocustom",
    "archiveDate": "2026-04-21",
    "typeOfSetAside": "SDVOSBA",
    "typeOfSetAsideDescription": "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside",
    "responseDeadLine": "2026-03-21T17:00:00-05:00",
    "naicsCode": "541512",
    "classificationCode": "D302",
    "active": "Yes",
    "description": "https://api.sam.gov/prod/opportunities/v2/search?noticeid=a3b4c5d6e7f8g9h0i1j2k3l4&description=true",
    "organizationType": "OFFICE",
    "additionalInfoLink": null,
    "uiLink": "https://sam.gov/opp/a3b4c5d6e7f8g9h0i1j2k3l4/view",
    "award": null,
    "pointOfContact": [
      {"type": "primary", "fullName": "John Smith", "email": "john.smith@disa.mil", "phone": "571-555-0100"}
    ],
    "officeAddress": {"zipcode": "22060", "city": "Fort Belvoir", "countryCode": "USA", "state": "VA"},
    "placeOfPerformance": {"city": {"name": "Fort Belvoir"}, "state": {"code": "VA"}, "country": {"code": "USA"}}
  }'::jsonb
);

-- Opp 2: Cybersecurity Assessment — good match for TechForward
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  estimated_value_min, estimated_value_max,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000002-0002-0002-0002-000000000002',
  'sam_gov',
  'b4c5d6e7f8g9h0i1j2k3l4m5',
  'Cybersecurity Risk Assessment and Continuous Monitoring Services',
  'The General Services Administration requires a contractor to perform comprehensive cybersecurity risk assessments across multiple agency information systems. Services include vulnerability assessment, penetration testing, security control assessment per NIST 800-53 Rev 5, Risk Management Framework (RMF) support, and implementation of continuous monitoring solutions. The contractor must maintain personnel with active Secret clearance and hold relevant certifications (CISSP, CEH, or equivalent).',
  'GENERAL SERVICES ADMINISTRATION.FEDERAL ACQUISITION SERVICE.GSA/FAS OFFICE OF IT CATEGORY',
  '047',
  ARRAY['541512'],
  'Small Business Set-Aside (FAR 19.5)',
  'SBA',
  'solicitation',
  NOW() - INTERVAL '5 days',
  NOW() + INTERVAL '18 days',
  2000000,
  8000000,
  '47QTCA-24-R-0089',
  'https://sam.gov/opp/b4c5d6e7f8g9h0i1j2k3l4m5/view',
  'abc123hash002',
  'active',
  '{
    "noticeId": "b4c5d6e7f8g9h0i1j2k3l4m5",
    "title": "Cybersecurity Risk Assessment and Continuous Monitoring Services",
    "solicitationNumber": "47QTCA-24-R-0089",
    "fullParentPathName": "GENERAL SERVICES ADMINISTRATION.FEDERAL ACQUISITION SERVICE.GSA/FAS OFFICE OF IT CATEGORY",
    "fullParentPathCode": "047.4732.47QTCA",
    "postedDate": "2026-02-19",
    "type": "Solicitation",
    "baseType": "Combined Synopsis/Solicitation",
    "typeOfSetAside": "SBA",
    "typeOfSetAsideDescription": "Small Business Set-Aside (FAR 19.5)",
    "responseDeadLine": "2026-03-14T14:00:00-05:00",
    "naicsCode": "541512",
    "classificationCode": "D310",
    "active": "Yes",
    "award": null,
    "pointOfContact": [
      {"type": "primary", "fullName": "Maria Rodriguez", "email": "maria.rodriguez@gsa.gov", "phone": "202-555-0200"}
    ]
  }'::jsonb
);

-- Opp 3: Program Management Office Support — good match for ClearPath
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  estimated_value_min, estimated_value_max,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000003-0003-0003-0003-000000000003',
  'sam_gov',
  'c5d6e7f8g9h0i1j2k3l4m5n6',
  'Program Management Office (PMO) Support Services',
  'The Department of Health and Human Services (HHS) requires program management support services for its Office of the Chief Information Officer (OCIO). The contractor shall provide PMO support including earned value management (EVMS), Agile program management, risk management, and stakeholder reporting. Services include maintaining program schedules, conducting program reviews, and facilitating organizational change management. This requirement is set aside for 8(a) businesses.',
  'DEPARTMENT OF HEALTH AND HUMAN SERVICES.OFFICE OF THE SECRETARY.OS OFFICE OF THE CIO',
  '075',
  ARRAY['541611'],
  'Total Small Business Set-Aside',
  'SBA',
  'solicitation',
  NOW() - INTERVAL '7 days',
  NOW() + INTERVAL '10 days',
  1000000,
  5000000,
  'OS-OCIO-24-R-0015',
  'https://sam.gov/opp/c5d6e7f8g9h0i1j2k3l4m5n6/view',
  'abc123hash003',
  'active',
  '{
    "noticeId": "c5d6e7f8g9h0i1j2k3l4m5n6",
    "title": "Program Management Office (PMO) Support Services",
    "solicitationNumber": "OS-OCIO-24-R-0015",
    "fullParentPathName": "DEPARTMENT OF HEALTH AND HUMAN SERVICES.OFFICE OF THE SECRETARY.OS OFFICE OF THE CIO",
    "fullParentPathCode": "075.OS.OCIO",
    "postedDate": "2026-02-17",
    "type": "Solicitation",
    "baseType": "Solicitation",
    "typeOfSetAside": "SBA",
    "typeOfSetAsideDescription": "Total Small Business Set-Aside",
    "responseDeadLine": "2026-03-06T17:00:00-05:00",
    "naicsCode": "541611",
    "active": "Yes",
    "award": null,
    "pointOfContact": [
      {"type": "primary", "fullName": "James Williams", "email": "james.williams@hhs.gov", "phone": "202-555-0300"}
    ]
  }'::jsonb
);

-- Opp 4: DevSecOps Pipeline — very high match for TechForward
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  estimated_value_min, estimated_value_max,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000004-0004-0004-0004-000000000004',
  'sam_gov',
  'd6e7f8g9h0i1j2k3l4m5n6o7',
  'DevSecOps CI/CD Pipeline Implementation and Kubernetes Platform',
  'The U.S. Army requires a qualified small business to design, implement, and maintain a DevSecOps continuous integration/continuous delivery (CI/CD) pipeline. The platform shall be based on Kubernetes container orchestration with Docker containerization, GitLab CI/CD, and automated security scanning. The contractor shall implement zero trust architecture principles, integrate with existing STIG-hardened infrastructure, and provide comprehensive training to government personnel. FedRAMP High authorization is required.',
  'DEPT OF DEFENSE.DEPT OF THE ARMY.W6QK ACC-APG NATICK',
  '012',
  ARRAY['541512', '541519'],
  'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside',
  'SDVOSBA',
  'solicitation',
  NOW() - INTERVAL '2 days',
  NOW() + INTERVAL '30 days',
  3000000,
  12000000,
  'W911QY-24-R-0108',
  'https://sam.gov/opp/d6e7f8g9h0i1j2k3l4m5n6o7/view',
  'abc123hash004',
  'active',
  '{
    "noticeId": "d6e7f8g9h0i1j2k3l4m5n6o7",
    "title": "DevSecOps CI/CD Pipeline Implementation and Kubernetes Platform",
    "solicitationNumber": "W911QY-24-R-0108",
    "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE ARMY.W6QK ACC-APG NATICK",
    "fullParentPathCode": "012.21A1.W6QK",
    "postedDate": "2026-02-22",
    "type": "Solicitation",
    "typeOfSetAside": "SDVOSBA",
    "typeOfSetAsideDescription": "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside",
    "responseDeadLine": "2026-03-26T16:00:00-05:00",
    "naicsCode": "541512",
    "active": "Yes"
  }'::jsonb
);

-- Opp 5: Sources Sought — workforce training (ClearPath match)
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  estimated_value_min, estimated_value_max,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000005-0005-0005-0005-000000000005',
  'sam_gov',
  'e7f8g9h0i1j2k3l4m5n6o7p8',
  'Workforce Development and Training Program Support',
  'The Department of Veterans Affairs is seeking information from qualified small businesses capable of providing workforce development and training program support services. The VA requires instructor-led training, learning management system (LMS) administration, curriculum development, and strategic planning for organizational change management. Interested vendors should submit capability statements demonstrating experience with federal workforce development programs and Lean Six Sigma methodologies.',
  'DEPARTMENT OF VETERANS AFFAIRS.VA HUMAN RESOURCES AND ADMINISTRATION',
  '036',
  ARRAY['611430'],
  'Total Small Business Set-Aside',
  'SBA',
  'sources_sought',
  NOW() - INTERVAL '1 day',
  NOW() + INTERVAL '14 days',
  NULL,
  NULL,
  'VA-HRA-24-I-0033',
  'https://sam.gov/opp/e7f8g9h0i1j2k3l4m5n6o7p8/view',
  'abc123hash005',
  'active',
  '{
    "noticeId": "e7f8g9h0i1j2k3l4m5n6o7p8",
    "title": "Workforce Development and Training Program Support",
    "solicitationNumber": "VA-HRA-24-I-0033",
    "fullParentPathName": "DEPARTMENT OF VETERANS AFFAIRS.VA HUMAN RESOURCES AND ADMINISTRATION",
    "fullParentPathCode": "036.HRA",
    "postedDate": "2026-02-23",
    "type": "Sources Sought",
    "baseType": "Sources Sought",
    "typeOfSetAside": "SBA",
    "typeOfSetAsideDescription": "Total Small Business Set-Aside",
    "responseDeadLine": "2026-03-10T12:00:00-05:00",
    "naicsCode": "611430",
    "active": "Yes"
  }'::jsonb
);

-- Opp 6: Data Analytics — moderate match for TechForward
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  estimated_value_min, estimated_value_max,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000006-0006-0006-0006-000000000006',
  'sam_gov',
  'f8g9h0i1j2k3l4m5n6o7p8q9',
  'Advanced Data Analytics and Artificial Intelligence Platform',
  'The Department of Homeland Security seeks a contractor to develop and deploy an advanced data analytics and artificial intelligence platform for border security operations. Requirements include machine learning model development, data engineering pipeline creation, real-time data analytics dashboards, and integration with existing DHS data systems. The platform must process structured and unstructured data sources. Requires TS/SCI clearance.',
  'DEPARTMENT OF HOMELAND SECURITY.CUSTOMS AND BORDER PROTECTION.CBP OIT',
  '070',
  ARRAY['541512'],
  NULL,
  NULL,
  'solicitation',
  NOW() - INTERVAL '10 days',
  NOW() + INTERVAL '5 days',
  8000000,
  20000000,
  'CBP-OIT-24-R-0067',
  'https://sam.gov/opp/f8g9h0i1j2k3l4m5n6o7p8q9/view',
  'abc123hash006',
  'active',
  '{
    "noticeId": "f8g9h0i1j2k3l4m5n6o7p8q9",
    "title": "Advanced Data Analytics and Artificial Intelligence Platform",
    "solicitationNumber": "CBP-OIT-24-R-0067",
    "fullParentPathName": "DEPARTMENT OF HOMELAND SECURITY.CUSTOMS AND BORDER PROTECTION.CBP OIT",
    "fullParentPathCode": "070.CBP.OIT",
    "postedDate": "2026-02-14",
    "type": "Solicitation",
    "typeOfSetAside": null,
    "typeOfSetAsideDescription": null,
    "responseDeadLine": "2026-03-01T14:00:00-05:00",
    "naicsCode": "541512",
    "active": "Yes"
  }'::jsonb
);

-- Opp 7: Presolicitation — IT Modernization (TechForward interest)
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  estimated_value_min, estimated_value_max,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000007-0007-0007-0007-000000000007',
  'sam_gov',
  'g9h0i1j2k3l4m5n6o7p8q9r0',
  'IT Infrastructure Modernization and Cloud Transformation',
  'PRESOLICITATION NOTICE: The Department of Veterans Affairs anticipates a requirement for IT infrastructure modernization and cloud transformation services. This will include migration of legacy systems to AWS GovCloud, implementation of zero trust security architecture, and modernization of CI/CD development pipelines. This notice is for planning purposes only and does not constitute a solicitation. An RFP is expected within 60 days. Small business set-aside determination pending.',
  'DEPARTMENT OF VETERANS AFFAIRS.VA OFFICE OF INFORMATION AND TECHNOLOGY',
  '036',
  ARRAY['541512'],
  NULL,
  NULL,
  'presolicitation',
  NOW() - INTERVAL '4 days',
  NOW() + INTERVAL '45 days',
  10000000,
  50000000,
  'VA-OIT-24-P-0044',
  'https://sam.gov/opp/g9h0i1j2k3l4m5n6o7p8q9r0/view',
  'abc123hash007',
  'active',
  '{
    "noticeId": "g9h0i1j2k3l4m5n6o7p8q9r0",
    "title": "IT Infrastructure Modernization and Cloud Transformation",
    "solicitationNumber": "VA-OIT-24-P-0044",
    "fullParentPathName": "DEPARTMENT OF VETERANS AFFAIRS.VA OFFICE OF INFORMATION AND TECHNOLOGY",
    "fullParentPathCode": "036.OIT",
    "postedDate": "2026-02-20",
    "type": "Presolicitation",
    "baseType": "Presolicitation",
    "typeOfSetAside": null,
    "typeOfSetAsideDescription": null,
    "responseDeadLine": null,
    "archiveDate": "2026-04-10",
    "naicsCode": "541512",
    "active": "Yes"
  }'::jsonb
);

-- Opp 8: Closed opportunity (should NOT appear in tenant_pipeline view)
INSERT INTO opportunities (
  id, source, source_id, title, description,
  agency, agency_code, naics_codes, set_aside_type, set_aside_code,
  opportunity_type, posted_date, close_date,
  solicitation_number, source_url, content_hash, status, raw_data
) VALUES (
  'c0000008-0008-0008-0008-000000000008',
  'sam_gov',
  'h0i1j2k3l4m5n6o7p8q9r0s1',
  'Legacy System Maintenance — CLOSED',
  'This solicitation has been closed and awarded.',
  'GENERAL SERVICES ADMINISTRATION.PUBLIC BUILDINGS SERVICE.PBS R5',
  '047',
  ARRAY['541512'],
  NULL, NULL,
  'solicitation',
  NOW() - INTERVAL '60 days',
  NOW() - INTERVAL '30 days',
  'GS-05P-24-R-0001',
  'https://sam.gov/opp/h0i1j2k3l4m5n6o7p8q9r0s1/view',
  'abc123hash008',
  'closed',
  '{"noticeId": "h0i1j2k3l4m5n6o7p8q9r0s1", "active": "No"}'::jsonb
);

-- ─── 5. TENANT_OPPORTUNITIES (Scored) ───────────────────────────
-- Score breakdown: NAICS(0-25) + Keyword(0-25) + SetAside(0-15) + Agency(0-15) + Type(0-10) + Timeline(0-10) + LLM(-20 to +20)

-- TechForward scores
INSERT INTO tenant_opportunities (
  tenant_id, opportunity_id, total_score,
  naics_score, keyword_score, set_aside_score, agency_score, type_score, timeline_score,
  llm_adjustment, llm_rationale, matched_keywords, matched_domains,
  pursuit_status, pursuit_recommendation,
  key_requirements, competitive_risks, questions_for_rfi, scored_at
) VALUES
  -- Opp 1: Cloud Migration — NAICS match(25) + keyword(25) + set-aside SDVOSB(15) + DoD agency(15) + solicitation(10) + timeline(4) + LLM(+8) = 102→100
  ('a1111111-1111-1111-1111-111111111111', 'c0000001-0001-0001-0001-000000000001', 95.0,
   25, 25, 15, 15, 10, 4,
   8, 'Excellent SDVOSB cloud migration fit. FedRAMP and NIST 800-53 requirements directly align with company capabilities.',
   ARRAY['cloud migration', 'AWS', 'GovCloud', 'FedRAMP', 'NIST 800-53', 'STIG'],
   ARRAY['Cloud & Infrastructure', 'Cybersecurity'],
   'pursuing', 'pursue',
   ARRAY['AWS GovCloud migration expertise', 'FedRAMP authorization experience', 'NIST 800-53 Rev 5 compliance', '24/7 managed services capability'],
   ARRAY['Large business competitors may team with SDVOSBs', 'TS clearance requirement narrows field'],
   ARRAY['What is the current infrastructure footprint?', 'Is there an existing FedRAMP-authorized environment?'],
   NOW() - INTERVAL '2 days'),

  -- Opp 2: Cybersecurity — NAICS(25) + keyword(25) + SB set-aside(8) + GSA agency(15) + solicitation(10) + timeline(7) + LLM(+5) = 95
  ('a1111111-1111-1111-1111-111111111111', 'c0000002-0002-0002-0002-000000000002', 88.0,
   25, 25, 8, 15, 10, 7,
   5, 'Strong cybersecurity match. NIST/RMF requirements are core competency.',
   ARRAY['cybersecurity', 'NIST 800-53', 'vulnerability assessment', 'RMF'],
   ARRAY['Cybersecurity'],
   'pursuing', 'pursue',
   ARRAY['CISSP or CEH certified personnel', 'Active Secret clearance', 'NIST 800-53 Rev 5 assessment experience'],
   ARRAY['Competitive set-aside is SBA, not SDVOSB-exclusive'],
   ARRAY[]::text[],
   NOW() - INTERVAL '4 days'),

  -- Opp 4: DevSecOps — NAICS(25) + keyword(25) + SDVOSB(15) + Army(10) + solicitation(10) + timeline(4) + LLM(+10) = 99→95
  ('a1111111-1111-1111-1111-111111111111', 'c0000004-0004-0004-0004-000000000004', 92.0,
   25, 25, 15, 10, 10, 4,
   10, 'Perfect DevSecOps alignment. Kubernetes, Docker, GitLab CI/CD, zero trust — all core capabilities.',
   ARRAY['DevSecOps', 'CI/CD', 'Kubernetes', 'Docker', 'GitLab', 'zero trust', 'STIG'],
   ARRAY['DevSecOps', 'Cybersecurity', 'Cloud & Infrastructure'],
   'monitoring', 'pursue',
   ARRAY['Kubernetes container orchestration', 'GitLab CI/CD implementation', 'STIG-hardened infrastructure', 'Zero trust architecture'],
   ARRAY['Army procurement cycle may be lengthy', 'FedRAMP High adds compliance overhead'],
   ARRAY[]::text[],
   NOW() - INTERVAL '1 day'),

  -- Opp 6: Data Analytics — NAICS(25) + keyword(18) + no set-aside(0) + DHS(10) + solicitation(10) + timeline(10) = 73
  ('a1111111-1111-1111-1111-111111111111', 'c0000006-0006-0006-0006-000000000006', 73.0,
   25, 18, 0, 10, 10, 10,
   0, NULL,
   ARRAY['machine learning', 'data analytics', 'artificial intelligence', 'data engineering'],
   ARRAY['Data & AI'],
   'unreviewed', 'monitor',
   ARRAY['TS/SCI clearance required', 'Real-time data processing', 'ML model development'],
   ARRAY['No set-aside — open competition with large businesses', 'TS/SCI requirement limits candidate pool'],
   ARRAY[]::text[],
   NOW() - INTERVAL '9 days'),

  -- Opp 7: IT Modernization presol — NAICS(25) + keyword(25) + no set-aside(0) + VA(5) + presol(3) + timeline(1) = 59
  ('a1111111-1111-1111-1111-111111111111', 'c0000007-0007-0007-0007-000000000007', 59.0,
   25, 25, 0, 5, 3, 1,
   0, NULL,
   ARRAY['cloud migration', 'AWS', 'GovCloud', 'zero trust', 'CI/CD'],
   ARRAY['Cloud & Infrastructure', 'DevSecOps'],
   'monitoring', 'monitor',
   ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   NOW() - INTERVAL '3 days'),

  -- Opp 3: PMO (not a great match but above threshold) — NAICS(0) + keyword(0) + SB(8) + no agency(0) + solicitation(10) + timeline(7) = 25 (below 35 threshold, won't be inserted normally)
  -- We include it at 40 to test filter boundaries
  ('a1111111-1111-1111-1111-111111111111', 'c0000003-0003-0003-0003-000000000003', 40.0,
   0, 10, 8, 0, 10, 7,
   5, 'Some IT overlap but primarily management consulting. Monitor only.',
   ARRAY['program management'],
   ARRAY[]::text[],
   'passed', 'pass',
   ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   NOW() - INTERVAL '6 days');

-- ClearPath scores
INSERT INTO tenant_opportunities (
  tenant_id, opportunity_id, total_score,
  naics_score, keyword_score, set_aside_score, agency_score, type_score, timeline_score,
  llm_adjustment, llm_rationale, matched_keywords, matched_domains,
  pursuit_status, pursuit_recommendation,
  key_requirements, competitive_risks, questions_for_rfi, scored_at
) VALUES
  -- Opp 3: PMO — NAICS(25) + keyword(25) + SB(8) + HHS(15) + solicitation(10) + timeline(7) = 90
  ('b2222222-2222-2222-2222-222222222222', 'c0000003-0003-0003-0003-000000000003', 85.0,
   25, 25, 8, 15, 10, 7,
   0, NULL,
   ARRAY['program management', 'PMO', 'EVMS', 'earned value', 'organizational change'],
   ARRAY['Program Management', 'Organizational Consulting'],
   'pursuing', 'pursue',
   ARRAY['EVMS experience', 'Agile program management', 'Organizational change management'],
   ARRAY['Competition from established management consulting firms'],
   ARRAY[]::text[],
   NOW() - INTERVAL '6 days'),

  -- Opp 5: Workforce Training — NAICS(15) + keyword(25) + SB(8) + VA(10) + sources_sought(5) + timeline(7) = 70
  ('b2222222-2222-2222-2222-222222222222', 'c0000005-0005-0005-0005-000000000005', 70.0,
   15, 25, 8, 10, 5, 7,
   0, NULL,
   ARRAY['workforce development', 'training', 'instructor-led', 'learning management', 'Lean Six Sigma', 'strategic planning'],
   ARRAY['Training & Development', 'Organizational Consulting'],
   'monitoring', 'monitor',
   ARRAY['Instructor-led training capability', 'LMS administration', 'Federal workforce development experience'],
   ARRAY['Sources sought — no guarantee of solicitation'],
   ARRAY['What is the anticipated contract vehicle?', 'Is there an incumbent?', 'What LMS platforms are currently in use?'],
   NOW() - INTERVAL '1 day');

-- ─── 6. TENANT ACTIONS ──────────────────────────────────────────

INSERT INTO tenant_actions (tenant_id, opportunity_id, user_id, action_type, value, score_at_action, agency_at_action, type_at_action) VALUES
  -- Alice thumbs up Cloud Migration
  ('a1111111-1111-1111-1111-111111111111', 'c0000001-0001-0001-0001-000000000001', 'user-alice-001', 'thumbs_up', NULL, 95.0, '097', 'solicitation'),
  -- Bob thumbs up Cloud Migration
  ('a1111111-1111-1111-1111-111111111111', 'c0000001-0001-0001-0001-000000000001', 'user-bob-001', 'thumbs_up', NULL, 95.0, '097', 'solicitation'),
  -- Alice pins Cloud Migration
  ('a1111111-1111-1111-1111-111111111111', 'c0000001-0001-0001-0001-000000000001', 'user-alice-001', 'pin', NULL, 95.0, '097', 'solicitation'),
  -- Alice comments on Cybersecurity
  ('a1111111-1111-1111-1111-111111111111', 'c0000002-0002-0002-0002-000000000002', 'user-alice-001', 'comment', 'We should prioritize this — aligns perfectly with our NIST assessment team.', 88.0, '047', 'solicitation'),
  -- Bob status_change on DevSecOps
  ('a1111111-1111-1111-1111-111111111111', 'c0000004-0004-0004-0004-000000000004', 'user-bob-001', 'status_change', 'monitoring', 92.0, '012', 'solicitation'),
  -- Carol thumbs up PMO
  ('b2222222-2222-2222-2222-222222222222', 'c0000003-0003-0003-0003-000000000003', 'user-carol-001', 'thumbs_up', NULL, 85.0, '075', 'solicitation');

-- ─── 7. DOCUMENTS (attached to opportunities) ───────────────────

INSERT INTO documents (opportunity_id, filename, original_url, download_status, document_type, is_primary) VALUES
  ('c0000001-0001-0001-0001-000000000001', 'HC1028-24-R-0042_SOW.pdf', 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/a3b4/SOW.pdf', 'pending', 'SOW', true),
  ('c0000001-0001-0001-0001-000000000001', 'HC1028-24-R-0042_CDRLs.pdf', 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/a3b4/CDRLs.pdf', 'pending', 'CDRL', false),
  ('c0000002-0002-0002-0002-000000000002', '47QTCA-24-R-0089_RFP.pdf', 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/b4c5/RFP.pdf', 'pending', 'RFP', true),
  ('c0000004-0004-0004-0004-000000000004', 'W911QY-24-R-0108_PWS.pdf', 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/d6e7/PWS.pdf', 'pending', 'PWS', true);

-- ─── 8. AMENDMENTS ──────────────────────────────────────────────

INSERT INTO amendments (opportunity_id, change_type, old_value, new_value) VALUES
  ('c0000002-0002-0002-0002-000000000002', 'close_date_extended', '2026-03-07', '2026-03-14'),
  ('c0000001-0001-0001-0001-000000000001', 'content_update', 'abc123hash001_v1', 'abc123hash001');

-- ─── 9. DOWNLOAD LINKS (portal resources) ───────────────────────

INSERT INTO download_links (tenant_id, title, description, url, link_type, is_active, created_by) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'SDVOSB Self-Certification Guide', 'Updated guide for SDVOSB self-certification requirements', 'https://example.com/docs/sdvosb-guide.pdf', 'guidance', true, 'admin'),
  ('a1111111-1111-1111-1111-111111111111', 'Capability Statement Template', 'Standard capability statement template for IT services', 'https://example.com/docs/cap-stmt-template.docx', 'template', true, 'admin'),
  ('a1111111-1111-1111-1111-111111111111', 'Cloud Migration SOW', 'SOW document for Opp HC1028-24-R-0042', 'https://example.com/docs/cloud-sow.pdf', 'opportunity_doc', true, 'admin'),
  ('b2222222-2222-2222-2222-222222222222', '8(a) Program Requirements', 'SBA 8(a) Business Development Program requirements overview', 'https://example.com/docs/8a-requirements.pdf', 'guidance', true, 'admin');

-- ─── 10. PIPELINE JOBS (history) ────────────────────────────────

-- A completed SAM.gov ingest job
INSERT INTO pipeline_jobs (
  id, source, run_type, status, triggered_by, triggered_at, started_at, completed_at,
  worker_id, priority, attempt, max_attempts, parameters, result
) VALUES (
  'a0000001-0001-0001-0001-000000000001',
  'sam_gov', 'full', 'completed', 'scheduler',
  NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours' + INTERVAL '2 seconds', NOW() - INTERVAL '5 hours 55 minutes',
  'worker-1234', 1, 1, 3, '{}',
  '{"opportunities_fetched": 47, "opportunities_new": 12, "opportunities_updated": 8, "tenants_scored": 2, "documents_downloaded": 0, "llm_calls_made": 5, "llm_cost_usd": 0.12, "amendments_detected": 3, "errors": []}'::jsonb
);

-- A completed scoring job
INSERT INTO pipeline_jobs (
  id, source, run_type, status, triggered_by, triggered_at, started_at, completed_at,
  worker_id, priority, attempt, max_attempts, parameters, result
) VALUES (
  'a0000002-0002-0002-0002-000000000002',
  'scoring', 'score', 'completed', 'admin@govwin.test',
  NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours' + INTERVAL '1 second', NOW() - INTERVAL '2 hours 58 minutes',
  'worker-1234', 3, 1, 3, '{}',
  '{"opportunities_fetched": 0, "opportunities_new": 0, "opportunities_updated": 0, "tenants_scored": 2, "documents_downloaded": 0, "llm_calls_made": 8, "llm_cost_usd": 0.19, "amendments_detected": 0, "errors": []}'::jsonb
);

-- A failed job (for testing dashboard error display)
INSERT INTO pipeline_jobs (
  id, source, run_type, status, triggered_by, triggered_at, started_at, completed_at,
  worker_id, priority, attempt, max_attempts, parameters, result, error_message
) VALUES (
  'a0000003-0003-0003-0003-000000000003',
  'grants_gov', 'full', 'failed', 'scheduler',
  NOW() - INTERVAL '12 hours', NOW() - INTERVAL '12 hours' + INTERVAL '3 seconds', NOW() - INTERVAL '11 hours 50 minutes',
  'worker-1234', 2, 3, 3, '{}',
  '{"opportunities_fetched": 0, "opportunities_new": 0, "opportunities_updated": 0, "tenants_scored": 0, "documents_downloaded": 0, "llm_calls_made": 0, "llm_cost_usd": null, "amendments_detected": 0, "errors": ["Connection timeout after 30s", "Retry 2: Connection refused", "Retry 3: Connection refused"]}'::jsonb,
  'Connection refused after 3 attempts'
);

-- A pending job (in queue)
INSERT INTO pipeline_jobs (
  id, source, run_type, status, triggered_by, triggered_at,
  priority, attempt, max_attempts, parameters
) VALUES (
  'a0000004-0004-0004-0004-000000000004',
  'sam_gov', 'incremental', 'pending', 'scheduler',
  NOW() - INTERVAL '5 minutes',
  1, 1, 3, '{"days_back": 1}'::jsonb
);

-- ─── 11. PIPELINE RUNS (audit log) ─────────────────────────────

INSERT INTO pipeline_runs (
  job_id, source, run_type, started_at, completed_at, status,
  opportunities_fetched, opportunities_new, opportunities_updated,
  tenants_scored, documents_downloaded, llm_calls_made, llm_cost_usd,
  amendments_detected, errors
) VALUES
  ('a0000001-0001-0001-0001-000000000001', 'sam_gov', 'full',
   NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours 55 minutes', 'completed',
   47, 12, 8, 2, 0, 5, 0.12, 3, '[]'::jsonb),
  ('a0000002-0002-0002-0002-000000000002', 'scoring', 'score',
   NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours 58 minutes', 'completed',
   0, 0, 0, 2, 0, 8, 0.19, 0, '[]'::jsonb),
  ('a0000003-0003-0003-0003-000000000003', 'grants_gov', 'full',
   NOW() - INTERVAL '12 hours', NOW() - INTERVAL '11 hours 50 minutes', 'failed',
   0, 0, 0, 0, 0, 0, NULL, 0, '["Connection timeout after 30s", "Retry 2: Connection refused", "Retry 3: Connection refused"]'::jsonb);

-- ─── 12. SOURCE HEALTH (updated by pipeline runs) ───────────────

UPDATE source_health SET
  status = 'healthy', last_success_at = NOW() - INTERVAL '6 hours',
  consecutive_failures = 0, success_rate_30d = 98.5, avg_duration_seconds = 312.4
WHERE source = 'sam_gov';

UPDATE source_health SET
  status = 'error', last_error_at = NOW() - INTERVAL '12 hours',
  last_error_message = 'Connection refused after 3 attempts',
  consecutive_failures = 3, success_rate_30d = 45.2, avg_duration_seconds = NULL
WHERE source = 'grants_gov';

UPDATE source_health SET
  status = 'unknown'
WHERE source IN ('sbir', 'usaspending');

-- ─── 13. AUDIT LOG ──────────────────────────────────────────────

INSERT INTO audit_log (user_id, tenant_id, action, entity_type, entity_id, new_value) VALUES
  ('user-admin-001', 'a1111111-1111-1111-1111-111111111111', 'tenant.created', 'tenant', 'a1111111-1111-1111-1111-111111111111',
   '{"name": "TechForward Solutions LLC", "plan": "professional"}'::jsonb),
  ('user-admin-001', 'b2222222-2222-2222-2222-222222222222', 'tenant.created', 'tenant', 'b2222222-2222-2222-2222-222222222222',
   '{"name": "ClearPath Consulting Group", "plan": "starter"}'::jsonb),
  ('user-admin-001', NULL, 'pipeline.job_triggered', 'pipeline_job', 'a0000002-0002-0002-0002-000000000002',
   '{"source": "scoring", "runType": "score"}'::jsonb);

-- ─── 14. SESSIONS (for NextAuth database sessions) ──────────────
-- Create active sessions so auth() works during testing

INSERT INTO sessions (id, session_token, user_id, expires) VALUES
  ('sess-admin-001', 'test-session-admin', 'user-admin-001', NOW() + INTERVAL '30 days'),
  ('sess-alice-001', 'test-session-alice', 'user-alice-001', NOW() + INTERVAL '30 days'),
  ('sess-bob-001',   'test-session-bob',   'user-bob-001',   NOW() + INTERVAL '30 days'),
  ('sess-carol-001', 'test-session-carol', 'user-carol-001', NOW() + INTERVAL '30 days');

-- ─── VERIFY SEED DATA ───────────────────────────────────────────

DO $$
DECLARE
  t_count INT;
  u_count INT;
  o_count INT;
  to_count INT;
  act_count INT;
  j_count INT;
BEGIN
  SELECT COUNT(*) INTO t_count FROM tenants;
  SELECT COUNT(*) INTO u_count FROM users;
  SELECT COUNT(*) INTO o_count FROM opportunities;
  SELECT COUNT(*) INTO to_count FROM tenant_opportunities;
  SELECT COUNT(*) INTO act_count FROM tenant_actions;
  SELECT COUNT(*) INTO j_count FROM pipeline_jobs;

  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE ' SEED DATA VERIFICATION';
  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE ' Tenants:              % (expected 3)', t_count;  -- includes 'my-company' from migration
  RAISE NOTICE ' Users:                % (expected 4)', u_count;
  RAISE NOTICE ' Opportunities:        % (expected 8)', o_count;
  RAISE NOTICE ' Tenant Opportunities: % (expected 8)', to_count;
  RAISE NOTICE ' Tenant Actions:       % (expected 6)', act_count;
  RAISE NOTICE ' Pipeline Jobs:        % (expected 4)', j_count;
  RAISE NOTICE '════════════════════════════════════════════';
END $$;
