-- Migration 034: CMS content status expansion + seed marketing page blocks
-- Replaces binary published boolean with multi-state status for content lifecycle management.

-- ── Step 1: Add status column ───────────────────────────────────────────
ALTER TABLE cms_content
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Backfill from existing published boolean
UPDATE cms_content SET status = 'published' WHERE published = true AND (status IS NULL OR status = 'draft');
UPDATE cms_content SET status = 'draft' WHERE status IS NULL;

-- Now add the check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'cms_content' AND constraint_name = 'cms_content_status_check'
  ) THEN
    ALTER TABLE cms_content ADD CONSTRAINT cms_content_status_check
      CHECK (status IN ('draft', 'pending', 'published', 'private', 'archived'));
  END IF;

  -- Set NOT NULL after backfill
  ALTER TABLE cms_content ALTER COLUMN status SET NOT NULL;
  ALTER TABLE cms_content ALTER COLUMN status SET DEFAULT 'draft';
END $$;

-- ── Step 2: Index for status queries ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cms_content_status ON cms_content(status);
CREATE INDEX IF NOT EXISTS idx_cms_content_tags ON cms_content USING gin(tags);

-- ── Step 3: Seed marketing page blocks ──────────────────────────────────
-- Uses ON CONFLICT (slug) DO NOTHING so re-running is safe.
-- Images use publicly available Wikimedia Commons / government sources.

-- ─── HOMEPAGE ───────────────────────────────────────────────────────────

INSERT INTO cms_content (slug, title, content_type, body, excerpt, tags, published, status, display_order, metadata, featured_image)
VALUES
  ('homepage-hero', 'A proposal engine, not a proposal gamble.', 'page_block',
   'RFP Pipeline pairs isolated, company-specific AI with 25 years of hands-on federal R&D expertise — so small businesses can pursue SBIR, STTR, BAA, and OTA funding without burning a month of payroll on every submission.',
   'AI + Expert · From Application to Submission',
   '{homepage,hero}', true, 'published', 1,
   '{"primary_cta":{"label":"Apply for Founding Cohort","href":"/apply"},"secondary_cta":{"label":"See How It Works","href":"/value"},"note":"Platform launches July 2026. 20 founding-cohort seats. Applications reviewed weekly."}',
   NULL),

  ('homepage-stats-1', '4+', 'page_block', 'Federal Sources Ingested', NULL, '{homepage,stats}', true, 'published', 1, '{}', NULL),
  ('homepage-stats-2', '72h', 'page_block', 'Expert-Review SLA', NULL, '{homepage,stats}', true, 'published', 2, '{}', NULL),
  ('homepage-stats-3', '20', 'page_block', 'Founding Cohort Cap', NULL, '{homepage,stats}', true, 'published', 3, '{}', NULL),
  ('homepage-stats-4', '25+', 'page_block', 'Years of Fed R&D Expertise', NULL, '{homepage,stats}', true, 'published', 4, '{}', NULL),

  ('homepage-stages-1', 'Apply', 'page_block', 'Company info, SAM.gov status, prior awards, tech summary. Filters tire-kickers. Nothing paid yet.', 'Short application.', '{homepage,stages}', true, 'published', 1, '{"num":"01"}', NULL),
  ('homepage-stages-2', 'Accepted', 'page_block', 'Personal review within 72 hours. Brief onboarding call. If you''re a fit for the cohort, you get an invite link.', 'Expert reviews every one.', '{homepage,stages}', true, 'published', 2, '{"num":"02"}', NULL),
  ('homepage-stages-3', 'Onboard', 'page_block', 'Upload capability statement, past performance, key personnel. Activate subscription. Your AI agents provisioned.', 'Your library goes live.', '{homepage,stages}', true, 'published', 3, '{"num":"03"}', NULL),
  ('homepage-stages-4', 'Spotlight', 'page_block', 'SAM.gov, SBIR.gov, Grants.gov, and agency portals ingested every day. Expert-curated matches ranked to your technology innovation areas.', 'Daily curated pipeline.', '{homepage,stages}', true, 'published', 4, '{"num":"04"}', NULL),
  ('homepage-stages-5', 'Purchase Portal', 'page_block', 'Purchase individual Proposal Portal when you find a fit. Expert builds the compliance matrix in 72 hours. AI drafts against your library. Your team revises.', 'Pay per build.', '{homepage,stages}', true, 'published', 5, '{"num":"05"}', NULL),
  ('homepage-stages-6', 'Submit & Learn', 'page_block', 'Every submission, every verified value, every debrief feeds future cycles. The AI gets more accurate — and intelligent — enabling proposal development at scale.', 'The system gets smarter.', '{homepage,stages}', true, 'published', 6, '{"num":"06"}', NULL),

  ('homepage-pricing-hero', 'One subscription. Per-proposal portals.', 'page_block',
   'Priced and built specifically for small businesses, not enterprise. Low cost subscription provides find and remind capabilities. Per proposal pricing ensures you only pay for builds you choose.',
   'How We Charge', '{homepage,pricing-hero}', true, 'published', 1, '{}', NULL),

  ('homepage-pricing-1', 'Spotlight Subscription', 'page_block',
   'Daily ingestion. AI-powered ranking against your profile. Expert-curated compliance matrix. Deadline alerts. 15 min of Ask-the-Expert each month (rolls over).',
   'Required · Monthly', '{homepage,pricing}', true, 'published', 1,
   '{"price":"$299","period":"/mo","note":"Required to purchase any portal"}', NULL),
  ('homepage-pricing-2', 'Phase I — Like Effort', 'page_block',
   'SBIR/STTR Phase I, smaller BAA topics, OTA/CSO short-form. 72-hour curation by Expert. Stage-gated workspace. Custom AI drafting.',
   'Per-Proposal', '{homepage,pricing}', true, 'published', 2,
   '{"price":"$999","period":"per proposal"}', NULL),
  ('homepage-pricing-3', 'Phase II — Like Effort', 'page_block',
   'SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. 20-50+ page tech volumes. Commercialization plans included.',
   'Per-Proposal', '{homepage,pricing}', true, 'published', 3,
   '{"price":"$1,999","period":"per proposal"}', NULL),

  ('homepage-expert-gate', 'The AI drafts. The Expert verifies. Your Team collaborates.', 'page_block',
   'The Expert personally reviews every application, curates every solicitation released into your Spotlight, and is available for pre-submission review. As the service scales, additional experts will join the roster — you will always know which expert reviewed your pipeline.',
   'The Expert Gate', '{homepage,expert-gate}', true, 'published', 1,
   '{"expert_name":"Eric Wagner","bullets":["72-hour application & curation SLA","15 min of strategy calls per month","Agency-specific: DoD, NSF, DOE, DARPA, DOT","Additional time on demand — $500/hr"]}',
   NULL),

  ('homepage-quote', 'Quote', 'page_block',
   'Free trials attract tire-kickers who waste expert time that serious applicants need. The application itself is the qualifier.',
   'Why No Free Trial', '{homepage,quote}', true, 'published', 1, '{}', NULL),

  ('homepage-cta', 'Apply today. Draft your first proposal on launch day.', 'page_block',
   '', 'Applications Open · Launch July 2026', '{homepage,cta}', true, 'published', 1,
   '{"cta":{"label":"Apply Now","href":"/apply"}}', NULL),

-- ─── ABOUT PAGE ─────────────────────────────────────────────────────────

  ('about-hero', 'Expert + AI + Automation + Collaboration = Win.', 'page_block',
   'Most AI tools give you speed without accuracy. Most consultants give you accuracy without scale. We built the thing that does both — and gets better every time you use it.',
   'About RFP Pipeline', '{about,hero}', true, 'published', 1, '{}', NULL),

  ('about-pillars-1', '25 years in the arena.', 'page_block',
   'Eric Wagner has personally secured hundreds of millions in SBIR, STTR, BAA, and OTA funding. He reviews every application, curates every solicitation, and is available for strategy calls. You always know who curated your pipeline — and why.',
   'The Expert', '{about,pillars}', true, 'published', 1,
   '{"href":"/the-expert"}', NULL),
  ('about-pillars-2', 'Isolated. Trained on you.', 'page_block',
   'Your company gets its own AI team provisioned at signup. Your agents only see your data. They learn from your uploads, your past proposals, and your verified compliance decisions. No cross-contamination. No shared context windows.',
   'The AI', '{about,pillars}', true, 'published', 2,
   '{"href":"/engine"}', NULL),
  ('about-pillars-3', 'Stage-gated, not free-form.', 'page_block',
   'Proposal development follows a structured pipeline: draft, review, revise, accept. Every stage has compliance checks, deadline tracking, and role-gated access. Your admin controls who sees what at every phase.',
   'The Automation', '{about,pillars}', true, 'published', 3,
   '{"href":"/how-it-works"}', NULL),
  ('about-pillars-4', 'Your team. Your rules.', 'page_block',
   'Invite internal team members and external collaborators to specific sections of specific proposals. Control access by role, document, and phase. Revoke instantly. Every edit is audited. Every version is tracked.',
   'The Collaboration', '{about,pillars}', true, 'published', 4,
   '{"href":"/infosec"}', NULL),

  ('about-founder', 'Eric Wagner', 'page_block',
   'Built RFP Pipeline to replicate the playbook that generated hundreds of millions in federal R&D funding across 25+ years — with AI doing the mechanical work and the expert handling the judgment.

Former President of D&S Consultants ($270M revenue, 750 employees). Associate Director at Ohio State''s CDME. CEO of Ubihere. B.S. Computer Science and Executive MBA from The Ohio State University. Phase I through Phase III, across DoD, NSF, DOE, DARPA.',
   'Founder & Architect', '{about,founder}', true, 'published', 1,
   '{"cta":{"label":"Apply to Work with Eric","href":"/apply"}}',
   NULL),

-- ─── FEATURES PAGE ──────────────────────────────────────────────────────

  ('features-hero', 'Everything you need to win.', 'page_block',
   'From opportunity discovery to submission-ready packages. Expert curation, isolated AI, and structured workflows — designed for small businesses pursuing federal R&D funding.',
   'Platform Features', '{features,hero}', true, 'published', 1, '{}', NULL),

  ('features-item-1', 'Source Scout', 'page_block',
   'Automated monitoring of SAM.gov, SBIR.gov, and agency portals. Source Scout detects new opportunities, tracks changes to existing solicitations, and alerts your team before deadlines sneak up.',
   NULL, '{features,items}', true, 'published', 1,
   '{"href":"/engine","icon":"🔍"}', NULL),
  ('features-item-2', 'RFP Curation', 'page_block',
   'Every solicitation is reviewed by a federal R&D expert with 25 years of experience. Topics are scored, categorized, and annotated with compliance requirements before they reach your pipeline.',
   NULL, '{features,items}', true, 'published', 2,
   '{"href":"/the-expert","icon":"📋"}', NULL),
  ('features-item-3', 'Spotlight Feed', 'page_block',
   'Your personalized opportunity feed, scored against your company profile. NAICS codes, keywords, agency priorities, and set-aside types all factor into your match score.',
   NULL, '{features,items}', true, 'published', 3,
   '{"icon":"⭐"}', NULL),
  ('features-item-4', 'Proposal Workspace', 'page_block',
   'A structured, stage-gated workspace for building federal proposals. Draft, review, and finalize with your team. Invite internal contributors and external partners with role-based access control.',
   NULL, '{features,items}', true, 'published', 4,
   '{"icon":"📝"}', NULL),
  ('features-item-5', 'AI Drafting', 'page_block',
   'Your tenant gets its own isolated AI team. Agents draft sections using your content library, past proposals, and the solicitation requirements. Every draft is clearly marked and requires human review.',
   NULL, '{features,items}', true, 'published', 5,
   '{"icon":"🤖"}', NULL),
  ('features-item-6', 'Content Library', 'page_block',
   'Build a reusable catalog of proven content atoms — technical descriptions, past performance narratives, capability statements, and more. Tag winning content and track usage across proposals.',
   NULL, '{features,items}', true, 'published', 6,
   '{"icon":"📚"}', NULL),
  ('features-item-7', 'Compliance Engine', 'page_block',
   'Automated compliance matrix tracking against solicitation requirements. Every requirement is mapped to a proposal section with status tracking.',
   NULL, '{features,items}', true, 'published', 7,
   '{"icon":"✅"}', NULL),
  ('features-item-8', 'Export Package', 'page_block',
   'Generate submission-ready document packages that meet federal formatting requirements. Page limits, font specifications, margin requirements, and section ordering enforced.',
   NULL, '{features,items}', true, 'published', 8,
   '{"icon":"📦"}', NULL),

  ('features-cta', 'Ready to see it in action?', 'page_block',
   'Join the founding cohort and get early access to every feature.',
   NULL, '{features,cta}', true, 'published', 1, '{}', NULL),

-- ─── VALUE PAGE ─────────────────────────────────────────────────────────

  ('value-hero', 'The more you use it, the better it gets.', 'page_block',
   'Every verified compliance value, every submitted proposal, every expert decision makes the next cycle cheaper, faster, and more accurate for your company.',
   'The Value Loop', '{value,hero}', true, 'published', 1, '{}', NULL),

  ('value-spotlight', 'Spotlight', 'page_block',
   'Never miss a relevant opportunity again. We ingest SAM.gov, SBIR.gov, Grants.gov, and agency-specific portals daily. Expert-curated compliance matrices are built for every ingested solicitation.',
   'Low-cost entry. High-value signal. The foundation that makes everything else work.',
   '{value,spotlight}', true, 'published', 1, '{"price_label":"$299/mo · Cancel Anytime"}', NULL),

  ('value-portals', 'Proposal Portals', 'page_block',
   'When you see something worth pursuing, buy a portal. Eric builds the compliance matrix within 72 hours. Your custom AI team drafts the technical volume, cost volume, and abstract against your uploaded library.',
   'Pay per pursuit. Only when you''re serious. No annual commitment beyond Spotlight.',
   '{value,portals}', true, 'published', 1, '{"price_label":"$999 Phase I · $1,999 Phase II"}', NULL),

  ('value-curation', 'Expert Curation', 'page_block',
   'Every solicitation released into your Spotlight has been reviewed by a human with real federal R&D experience. Every compliance matrix is verified against the source document.',
   'The AI drafts. The expert verifies. No unvetted AI output reaches your submission.',
   '{value,curation}', true, 'published', 1, '{"sla_label":"72-hour SLA"}', NULL),

  ('value-flywheel-1', 'Your library grows.', 'page_block',
   'Every upload, every proposal section, every past-performance narrative becomes reusable material for future proposals. Your AI team gets smarter with every document.',
   NULL, '{value,flywheel}', true, 'published', 1, '{}', NULL),
  ('value-flywheel-2', 'Compliance pre-fills.', 'page_block',
   'Verified values from your last DoD SBIR cycle auto-suggest for the next one. Page limits, font rules, submission format — the system remembers what the expert already verified.',
   NULL, '{value,flywheel}', true, 'published', 2, '{}', NULL),
  ('value-flywheel-3', 'Your win rate compounds.', 'page_block',
   'More proposals submitted. Higher quality per submission. Less time per cycle. Your cost-per-proposal drops. Your BD pipeline scales without hiring a BD department.',
   NULL, '{value,flywheel}', true, 'published', 3, '{}', NULL),

-- ─── RESOURCES (program links with agency logos) ────────────────────────

  ('resources-sbir', 'SBIR.gov — America''s Seed Fund', 'page_block',
   'The official Small Business Innovation Research portal. Search active solicitations, find participating agencies, and track your submissions across all 11 federal SBIR agencies.',
   'Federal Opportunity Source', '{resources,portals}', true, 'published', 1,
   '{"href":"https://www.sbir.gov","icon":"🏛️"}',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Seal_of_the_United_States_Small_Business_Administration.svg/200px-Seal_of_the_United_States_Small_Business_Administration.svg.png'),

  ('resources-sam', 'SAM.gov — System for Award Management', 'page_block',
   'The primary registration and search portal for federal contracting. Required for all government contractors. Search contract opportunities, verify entity registrations, and track awards.',
   'Federal Opportunity Source', '{resources,portals}', true, 'published', 2,
   '{"href":"https://sam.gov"}',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/US-GeneralServicesAdministration-Seal.svg/200px-US-GeneralServicesAdministration-Seal.svg.png'),

  ('resources-grants', 'Grants.gov — Federal Grant Opportunities', 'page_block',
   'The central clearinghouse for federal grant opportunities. Covers NSF, DOE, DOT, and dozens of other agencies. Required for many NOFO and BAA submissions.',
   'Federal Opportunity Source', '{resources,portals}', true, 'published', 3,
   '{"href":"https://www.grants.gov","icon":"📋"}', NULL),

  ('resources-dsip', 'DSIP — Defense SBIR/STTR Innovation Portal', 'page_block',
   'The DoD-specific portal for SBIR and STTR topics. Browse open topics by component (Army, Navy, Air Force, DARPA, MDA, etc.), download topic descriptions, and submit proposals.',
   'DoD Opportunity Source', '{resources,portals}', true, 'published', 4,
   '{"href":"https://www.defensesbirsttr.mil"}',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/United_States_Department_of_Defense_Seal.svg/200px-United_States_Department_of_Defense_Seal.svg.png'),

  ('resources-nsf', 'NSF Seed Fund', 'page_block',
   'The National Science Foundation''s SBIR/STTR program. Focused on deep tech: AI, biotech, advanced materials, quantum, semiconductors. Phase I up to $275K, Phase II up to $1M.',
   'Agency Program', '{resources,portals}', true, 'published', 5,
   '{"href":"https://seedfund.nsf.gov"}',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/NSF_logo.svg/200px-NSF_logo.svg.png'),

  ('resources-darpa', 'DARPA — Broad Agency Announcements', 'page_block',
   'Defense Advanced Research Projects Agency. High-risk, high-reward R&D funding. BAAs and research announcements for breakthrough technologies across cyber, bio, space, and autonomy.',
   'Agency Program', '{resources,portals}', true, 'published', 6,
   '{"href":"https://www.darpa.mil/work-with-us"}',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/DARPA_Logo.jpg/200px-DARPA_Logo.jpg'),

  ('resources-doe', 'DOE SBIR/STTR', 'page_block',
   'Department of Energy R&D funding for clean energy, nuclear, grid modernization, and advanced manufacturing. Phase I up to $250K with 6-9 month periods of performance.',
   'Agency Program', '{resources,portals}', true, 'published', 7,
   '{"href":"https://science.osti.gov/sbir"}',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Seal_of_the_United_States_Department_of_Energy.svg/200px-Seal_of_the_United_States_Department_of_Energy.svg.png')

ON CONFLICT (slug) DO NOTHING;
