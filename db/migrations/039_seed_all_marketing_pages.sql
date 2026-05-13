-- 039: Seed all marketing pages with CMS content
-- Extracts hardcoded fallback content from page components into cms_content
-- so all marketing text is editable via the admin CMS.
-- Uses ON CONFLICT (slug) DO NOTHING for idempotency.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. PRICING PAGE  (/pricing)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  -- Hero
  ('pricing-hero', 'One subscription. Per-proposal portals. No surprises.', 'page_block',
   'We priced for small businesses, not enterprise. Every line item is a real cost tied to real expert time and real AI compute dedicated to you.',
   'Simple, Transparent Pricing',
   NULL, '{pricing,hero}', true, 'published', now(), 1,
   '{"primary_cta":{"label":"Apply Now","href":"/apply"},"secondary_cta":{"label":"See How It Works","href":"/how-it-works"},"note":"$299/month after acceptance. No free trial — serious applicants only. Cancel anytime."}'::jsonb, NULL),

  -- FAQs
  ('pricing-faqs-1', 'Why no free trial?', 'page_block',
   'Because Eric reviews every application and onboards every customer personally. Free trials attract tire-kickers who waste expert time that serious applicants need. The application itself is the qualifier — if you''re serious about federal R&D funding, the process is short and the value is immediate upon acceptance.',
   NULL,
   NULL, '{pricing,faqs}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('pricing-faqs-2', 'Do I need Spotlight to buy a Proposal Portal?', 'page_block',
   'Yes. Proposal Portals build on your company''s uploaded library and your subscription-based AI team. A portal without an active Spotlight subscription wouldn''t have the context needed to draft sections accurately.',
   NULL,
   NULL, '{pricing,faqs}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('pricing-faqs-3', 'What counts as "Phase I-equivalent" vs "Phase II-equivalent"?', 'page_block',
   'Phase I is for shorter-form proposals (typically 10-20 pages technical volume, <$250K funding). Phase II is for longer-form proposals (20-50+ pages, $1M+ funding, commercialization plans). If you''re unsure which tier fits your opportunity, use your monthly Ask-the-Expert time to check.',
   NULL,
   NULL, '{pricing,faqs}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  ('pricing-faqs-4', 'Can I upgrade a Phase I portal to Phase II?', 'page_block',
   'Yes. If a purchased Phase I portal becomes a Phase II effort, the $1,000 difference is credited toward the upgrade. No work is lost.',
   NULL,
   NULL, '{pricing,faqs}', true, 'published', now(), 4, '{}'::jsonb, NULL),

  ('pricing-faqs-5', 'What happens to my data if I cancel?', 'page_block',
   'You retain read access for 30 days so you can export everything. After 30 days your data is archived, isolated, and not accessible — but also not deleted, so you can resume anytime by reactivating your subscription.',
   NULL,
   NULL, '{pricing,faqs}', true, 'published', now(), 5, '{}'::jsonb, NULL),

  ('pricing-faqs-6', 'Does Eric actually review every opportunity, or is that an AI claim?', 'page_block',
   'Eric reviews every curation decision personally. The AI does the pre-shredding and extraction work; Eric verifies and releases opportunities into your Spotlight feed. As the service scales and additional experts join, customers will know which expert reviewed their pipeline — but every review is done by a real human with real federal R&D expertise.',
   NULL,
   NULL, '{pricing,faqs}', true, 'published', now(), 6, '{}'::jsonb, NULL),

  -- CTA
  ('pricing-cta', 'Apply now, launch your pipeline this month', 'page_block',
   'Applications reviewed weekly by Eric. Accepted applicants onboard within days.',
   'Ready to start?',
   NULL, '{pricing,cta}', true, 'published', now(), 1,
   '{"cta":{"label":"Apply for Founding Cohort","href":"/apply"},"note":"Limited to 20 founding members for the initial cohort."}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. HOW IT WORKS PAGE  (/how-it-works)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  -- Hero
  ('how-it-works-hero', 'From application to submitted proposal', 'page_block',
   'A single workflow that starts with a qualifying application and ends with a compliant, expert-curated proposal ready to submit. Every step is designed for small businesses that can''t afford to waste time on opportunities that won''t convert.',
   'How It Works',
   NULL, '{how-it-works,hero}', true, 'published', now(), 1,
   '{"primary_cta":{"label":"Apply Now","href":"/apply"},"secondary_cta":{"label":"See Pricing","href":"/pricing"}}'::jsonb, NULL),

  -- Steps
  ('how-it-works-steps-1', 'Apply', 'page_block',
   'You submit a short application describing your company, your technology, and the federal R&D funding you''re pursuing. This filters out tire-kickers and lets Eric assess fit before you pay anything.',
   NULL,
   NULL, '{how-it-works,steps}', true, 'published', now(), 1,
   '{"number":"01","details":["Company + admin contact info","SAM.gov registration status","Previous submissions and awards","Technology summary and desired outcomes","T&Cs acceptance"]}'::jsonb, NULL),

  ('how-it-works-steps-2', 'Accepted', 'page_block',
   'Eric personally reviews every application within 72 hours. If you''re a fit for the founding cohort (serious small businesses pursuing federal R&D funding), you''re invited to onboard.',
   NULL,
   NULL, '{how-it-works,steps}', true, 'published', now(), 2,
   '{"number":"02","details":["72-hour review SLA by Eric personally","Brief onboarding call to set expectations","Accepted applicants get an invite link to register"]}'::jsonb, NULL),

  ('how-it-works-steps-3', 'Onboard', 'page_block',
   'Your admin registers, uploads initial company documents (capability statement, past performance, key personnel bios), and activates your monthly subscription via Stripe.',
   NULL,
   NULL, '{how-it-works,steps}', true, 'published', now(), 3,
   '{"number":"03","details":["Admin creates account, verifies email","Upload foundational company docs (become your AI team''s library)","Activate $299/month subscription","Your isolated AI agents are provisioned"]}'::jsonb, NULL),

  ('how-it-works-steps-4', 'Spotlight', 'page_block',
   'Every day, our pipeline ingests SAM.gov, SBIR.gov, Grants.gov, and agency-specific portals. Expert-curated opportunities that match your tech areas surface at the top. You get deadline reminders and your monthly 15-min Ask-the-Expert call.',
   NULL,
   NULL, '{how-it-works,steps}', true, 'published', now(), 4,
   '{"number":"04","details":["Daily ingestion from 4+ federal opportunity sources","Expert-curated compliance matrix for every opportunity","Ranked and filtered to your company''s tech areas","Notifications for new matches and upcoming deadlines"]}'::jsonb, NULL),

  ('how-it-works-steps-5', 'Purchase a Proposal Portal', 'page_block',
   'When you find an opportunity worth pursuing, purchase a proposal portal ($999 Phase I, $1,999 Phase II). Eric builds your curated compliance matrix within 72 hours. Your custom AI team drafts sections against your uploaded library.',
   NULL,
   NULL, '{how-it-works,steps}', true, 'published', now(), 5,
   '{"number":"05","details":["Per-proposal purchase — no annual commitment","72-hour expert curation by Eric","Stage-gated workspace: draft → review → revise → accept","Collaborator access controls by section and phase"]}'::jsonb, NULL),

  ('how-it-works-steps-6', 'Submit + Learn', 'page_block',
   'You submit your proposal to the agency. Every curation decision, every verified compliance value, and every successful submission makes the AI smarter for your next proposal on the same program. The system gets more accurate and less expensive each cycle.',
   NULL,
   NULL, '{how-it-works,steps}', true, 'published', now(), 6,
   '{"number":"06","details":["Export-ready submission package (PDFs, forms, attachments)","Post-submission debrief stored in your library","Future cycles of same program pre-fill from prior verified data","Your library grows — so does the AI''s accuracy for your company"]}'::jsonb, NULL),

  -- Guardrails
  ('how-it-works-guardrails-1', 'Data isolation per customer', 'page_block',
   'Your company data, documents, and proposal drafts are fully isolated. Your AI agents only see your data. No data from any other customer ever touches your context window.',
   NULL,
   NULL, '{how-it-works,guardrails}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('how-it-works-guardrails-2', 'Expert gate at every high-stakes step', 'page_block',
   'Eric reviews your application, curates every solicitation you pursue, and is available for pre-submission review. The AI drafts; the expert verifies.',
   NULL,
   NULL, '{how-it-works,guardrails}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('how-it-works-guardrails-3', 'Collaborator controls', 'page_block',
   'Invite partners, subcontractors, and internal reviewers to specific sections of specific proposals. Control access by role, document, and phase. Revoke instantly.',
   NULL,
   NULL, '{how-it-works,guardrails}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  -- CTA
  ('how-it-works-cta', 'Founding cohort is limited to 20 small businesses', 'page_block',
   'Applications reviewed weekly. $299/month after acceptance. Cancel anytime.',
   'Ready to apply?',
   NULL, '{how-it-works,cta}', true, 'published', now(), 1,
   '{"cta":{"label":"Start Your Application","href":"/apply"}}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. ENGINE PAGE  (/engine)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  -- Hero
  ('engine-hero', 'Expert + AI + Process = Win.', 'page_block',
   'RFP Pipeline is not just software and not just a consultant. It is a structured system where expert curation, isolated AI, and stage-gated workflows work together at every step of the proposal lifecycle.',
   'The Engine',
   NULL, '{engine,hero}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  -- Steps
  ('engine-steps-1', 'Source Scout Finds', 'page_block',
   'Automated monitoring scans SAM.gov, SBIR.gov, DSIP, and agency portals daily. New solicitations, amendments, and deadline changes are captured and queued for expert review.',
   'No opportunity slips through the cracks. Source Scout runs on a schedule, compares page snapshots, and flags meaningful changes using Claude classification.',
   NULL, '{engine,steps}', true, 'published', now(), 1,
   '{"number":"01"}'::jsonb, NULL),

  ('engine-steps-2', 'Expert Curates', 'page_block',
   'Every solicitation is reviewed by Eric Wagner — 25 years of federal R&D experience. Topics are scored, compliance requirements are extracted, and volumes are structured before anything reaches your feed.',
   'This is not a raw data dump. Every opportunity in your pipeline has been human-verified, annotated with expert notes, and structured for proposal development.',
   NULL, '{engine,steps}', true, 'published', now(), 2,
   '{"number":"02"}'::jsonb, NULL),

  ('engine-steps-3', 'AI Structures', 'page_block',
   'Once curated, AI agents extract compliance matrices, map required sections, identify page limits and formatting rules, and build proposal outlines automatically.',
   'Your isolated AI team works only with your data. No cross-contamination between tenants. The compliance engine catches requirements that humans miss.',
   NULL, '{engine,steps}', true, 'published', now(), 3,
   '{"number":"03"}'::jsonb, NULL),

  ('engine-steps-4', 'Customer Writes', 'page_block',
   'You and your team fill in the proposal using the structured workspace. The content library suggests proven atoms from your past proposals. Section-level collaboration keeps everyone focused.',
   'Stage-gated progression ensures quality: draft, review, finalize. Role-based access means your PI sees their sections, your contracts person sees theirs, and external partners see only what you share.',
   NULL, '{engine,steps}', true, 'published', now(), 4,
   '{"number":"04"}'::jsonb, NULL),

  ('engine-steps-5', 'AI Assists', 'page_block',
   'AI agents draft sections using your content library, the solicitation requirements, and the compliance matrix. Every draft is clearly marked and requires human review.',
   'The AI does not submit for you. It drafts. You review, edit, accept, or reject. The compliance engine checks every section against the requirements matrix in real time.',
   NULL, '{engine,steps}', true, 'published', now(), 5,
   '{"number":"05"}'::jsonb, NULL),

  ('engine-steps-6', 'Expert Reviews', 'page_block',
   'Before submission, your proposal goes through a structured review process. Compliance checks, page counts, formatting verification, and expert feedback ensure submission readiness.',
   'The gold team review is where proposals go from good to winning. Our system tracks every requirement, every page limit, and every formatting rule so nothing is missed.',
   NULL, '{engine,steps}', true, 'published', now(), 6,
   '{"number":"06"}'::jsonb, NULL),

  -- Differentiators
  ('engine-differentiators-1', 'Your Data. Your AI.', 'page_block',
   'Every tenant gets isolated AI agents that only see their data. No shared context windows, no cross-contamination, no data leakage between companies.',
   'Isolation',
   NULL, '{engine,differentiators}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('engine-differentiators-2', 'Human in the Loop.', 'page_block',
   'Every AI output is clearly marked and requires human review. Every solicitation is expert-curated. Every submission decision is yours.',
   'Accountability',
   NULL, '{engine,differentiators}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('engine-differentiators-3', 'Stage-Gated Quality.', 'page_block',
   'Proposals progress through defined stages with compliance checks at every gate. No shortcutting the review process. No submitting without verification.',
   'Structure',
   NULL, '{engine,differentiators}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  -- CTA
  ('engine-cta', 'See the engine in action.', 'page_block',
   'Join the founding cohort and experience the full workflow.',
   NULL,
   NULL, '{engine,cta}', true, 'published', now(), 1,
   '{"cta":{"label":"Apply Now","href":"/apply"}}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. THE EXPERT PAGE  (/the-expert)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  -- Hero
  ('the-expert-hero', 'Eric Wagner', 'page_block',
   'Founder and CEO of RFP Pipeline. 25+ years in technology commercialization. Hundreds of millions in SBIR, STTR, BAA, and OTA funding secured. Former president of a $300M aerospace & defense company. Ohio State commercialization veteran who launched 22+ startups.',
   'Your Expert',
   NULL, '{the-expert,hero}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  -- Credentials
  ('the-expert-credentials-1', 'Funding Secured', 'page_block',
   'Personally secured hundreds of millions of dollars in SBIR, STTR, OTA, BAA, and related federal R&D funding across two decades — both for companies Eric led and for small businesses he advised. Phase I through Phase III, across DoD, NSF, DOE, DARPA, and more.',
   NULL,
   NULL, '{the-expert,credentials}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('the-expert-credentials-2', 'Operations Scale', 'page_block',
   'Former President of D&S Consultants (DSCI), an aerospace and defense commercialization company. Grew the company from 400 to 750+ employees at 70% CAGR, with 15 worldwide office locations and over $270M in annual revenue at time of departure.',
   NULL,
   NULL, '{the-expert,credentials}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('the-expert-credentials-3', 'Startup Launch Track Record', 'page_block',
   'Oversaw the successful launch of 22+ startups through The Ohio State University''s commercialization office. Co-founded Converge Technologies (commercialization services) and served as Co-Fund Manager at Ohio Gateway Tech Fund (pre-seed venture).',
   NULL,
   NULL, '{the-expert,credentials}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  ('the-expert-credentials-4', 'Executive Leadership', 'page_block',
   'Chief Executive Officer at Ubihere (2023-2026), Chief Strategy Officer at Lighthouse Avionics and Converge Technologies, Associate Director at Ohio State''s Center for Design and Manufacturing Excellence. Active startup investor via OTAF and individually.',
   NULL,
   NULL, '{the-expert,credentials}', true, 'published', now(), 4, '{}'::jsonb, NULL),

  -- Timeline
  ('the-expert-timeline-1', 'Founder & CEO', 'page_block',
   'Founded to help small businesses identify, engage, and win non-dilutive federal R&D funding. The company combines the proven commercialization playbook with custom AI agents trained per-customer and curated by human experts.',
   'RFP Pipeline',
   NULL, '{the-expert,timeline}', true, 'published', now(), 1,
   '{"period":"2026 – Present"}'::jsonb, NULL),

  ('the-expert-timeline-2', 'Chief Executive Officer', 'page_block',
   'Led the geospatial AI company toward commercialization of patented positioning analytics for asset tracking and vision-based business intelligence. Built the engineering and support teams that realized founder Dr. Alper Yilmaz''s vision.',
   'Ubihere',
   NULL, '{the-expert,timeline}', true, 'published', now(), 2,
   '{"period":"2023 – 2026"}'::jsonb, NULL),

  ('the-expert-timeline-3', 'Co-Fund Manager', 'page_block',
   'Led pre-seed investments in Ohio-based technology startups. Established partnership with Ohio Third Frontier''s Pre-Seed Fund Capitalization Program. Direct role in due diligence and portfolio growth.',
   'Ohio Gateway Tech Fund',
   NULL, '{the-expert,timeline}', true, 'published', now(), 3,
   '{"period":"2023 – 2024"}'::jsonb, NULL),

  ('the-expert-timeline-4', 'VP, Government Programs', 'page_block',
   'Drove federal program capture for the geospatial analytics company, securing R&D funding that fueled the core patented technology platform.',
   'Ubihere',
   NULL, '{the-expert,timeline}', true, 'published', now(), 4,
   '{"period":"2019 – 2023"}'::jsonb, NULL),

  ('the-expert-timeline-5', 'Associate Director, CDME', 'page_block',
   'Built a statewide support system for manufacturing-ecosystem technology commercialization. Led development of new programs including the Manufacturing Extension Partnership (MEP) and student experiential entrepreneurship (E3) programs.',
   'The Ohio State University',
   NULL, '{the-expert,timeline}', true, 'published', now(), 5,
   '{"period":"2015 – 2018"}'::jsonb, NULL),

  ('the-expert-timeline-6', 'Senior Business Analyst', 'page_block',
   'Evaluated university technologies and determined the best commercialization path — licensing, partnership, joint venture, or new startup. Oversaw the successful launch of 22+ companies founded on licensed OSU IP.',
   'OSU Technology Commercialization Office',
   NULL, '{the-expert,timeline}', true, 'published', now(), 6,
   '{"period":"2013 – 2015"}'::jsonb, NULL),

  ('the-expert-timeline-7', 'President / Chief Strategy Officer', 'page_block',
   'Led strategic vision, acquisitions, and organic growth for the aerospace & defense commercialization company. Grew from 400 to 750+ employees with 70% CAGR and $270M+ in annual revenue. 15 global offices.',
   'D&S Consultants (DSCI)',
   NULL, '{the-expert,timeline}', true, 'published', now(), 7,
   '{"period":"2009 – 2012"}'::jsonb, NULL),

  ('the-expert-timeline-8', 'SVP & Director / COO', 'page_block',
   'Established a new operating division that grew from 14 to 110+ revenue-generating employees via organic growth alone. Launched the company''s first commercial software product (awarded a patent). Assisted in two synergistic acquisitions.',
   'D&S Consultants',
   NULL, '{the-expert,timeline}', true, 'published', now(), 8,
   '{"period":"2003 – 2009"}'::jsonb, NULL),

  ('the-expert-timeline-9', 'Senior Program Manager', 'page_block',
   'Technically managed custom software development for federal customers. Grew to 14 employees across 4 programs and established the company''s overseas presence in Germany (now 30% of company revenue).',
   'D&S Consultants',
   NULL, '{the-expert,timeline}', true, 'published', now(), 9,
   '{"period":"2000 – 2003"}'::jsonb, NULL),

  ('the-expert-timeline-10', 'Research Analyst / Program Lead', 'page_block',
   'Technical lead on a $1.5M/year development effort requiring detailed requirements gathering and analysis. Grew from software developer into program lead. Received multiple customer satisfaction and product awards.',
   'Southwest Research Institute (SWRI)',
   NULL, '{the-expert,timeline}', true, 'published', now(), 10,
   '{"period":"1998 – 2000"}'::jsonb, NULL),

  -- CTA
  ('the-expert-cta', 'I''m taking 20 founding members. Apply if you''re serious.', 'page_block',
   'If you''re commercializing innovative technology and want non-dilutive federal R&D funding, let''s talk.',
   'Ready to work together?',
   NULL, '{the-expert,cta}', true, 'published', now(), 1,
   '{"cta":{"label":"Apply Now","href":"/apply"}}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 5. SECURITY PAGE  (/security)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  -- Hero
  ('security-hero', 'Federal-grade isolation. No cross-contamination, ever.', 'page_block',
   'Federal R&D customers have unique security needs — and we designed for that audience from day one. Every customer gets isolated AI, isolated storage, isolated processing. Your data never touches another customer''s workspace.',
   'Security & Data Isolation',
   NULL, '{security,hero}', true, 'published', now(), 1,
   '{"primary_cta":{"label":"Apply Now","href":"/apply"}}'::jsonb, NULL),

  -- Isolation layers
  ('security-isolation-1', 'Customer-level isolation', 'page_block',
   'Every customer account is rooted at a unique storage prefix and queried with tenant-scoped RLS (Row-Level Security) on every memory and document table. Your company data, uploaded files, and proposal drafts are cryptographically isolated from every other customer.',
   NULL,
   NULL, '{security,isolation}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('security-isolation-2', 'Proposal-level isolation', 'page_block',
   'Each purchased proposal portal gets its own sandboxed workspace. AI agents working on your Phase I cannot read data from your Phase II (or any other customer''s proposal) unless you explicitly grant cross-proposal library access.',
   NULL,
   NULL, '{security,isolation}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('security-isolation-3', 'Collaborator-level isolation', 'page_block',
   'Invite subcontractors, subject-matter experts, or team members to specific sections of specific proposals. Control access by role, document, and proposal phase. Revoke instantly. Collaborators see only what you authorize.',
   NULL,
   NULL, '{security,isolation}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  ('security-isolation-4', 'AI-level isolation', 'page_block',
   'AI agents are spun up per-customer and per-proposal. Your agents can only read data you uploaded or authorized them to access. Even a bug in the agent layer cannot cross the tenant boundary — the storage and database layers enforce isolation independently.',
   NULL,
   NULL, '{security,isolation}', true, 'published', now(), 4, '{}'::jsonb, NULL),

  -- Contracts
  ('security-contracts-1', 'Your IP stays yours', 'page_block',
   'Uploaded documents, proposal drafts, and company library materials are your intellectual property. We never use your data to train models, never share it with other customers, never sell it, and never use it for any purpose outside your own proposals and pipeline.',
   NULL,
   NULL, '{security,contracts}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('security-contracts-2', 'Federal contracting aware', 'page_block',
   'Eric has 25+ years of federal R&D funding experience. We understand ITAR, EAR, and export-control concerns common in DoD and DARPA work. The system is designed to support (not hinder) customers with such requirements.',
   NULL,
   NULL, '{security,contracts}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('security-contracts-3', 'Prompt injection defense', 'page_block',
   'User-uploaded content is clearly delimited from system instructions in every AI prompt. Malicious content in an uploaded document cannot instruct the AI to exfiltrate your data — a hard guardrail built into the prompt architecture.',
   NULL,
   NULL, '{security,contracts}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  ('security-contracts-4', 'No model-training on your data', 'page_block',
   'We use Anthropic''s Claude API for AI. Your data is sent as input for each request but is never used to train the underlying model. Claude''s enterprise API has strict no-training terms we rely on.',
   NULL,
   NULL, '{security,contracts}', true, 'published', now(), 4, '{}'::jsonb, NULL),

  -- Infrastructure
  ('security-infrastructure-1', 'Hosting', 'page_block',
   'Railway platform. US-based infrastructure. HTTPS everywhere. Session cookies secure and httpOnly. Database at rest encryption.',
   NULL,
   NULL, '{security,infrastructure}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('security-infrastructure-2', 'Authentication', 'page_block',
   'NextAuth v5 with bcrypt password hashing (cost=12). Session-based. Forced password change on first login. No passwords sent via email.',
   NULL,
   NULL, '{security,infrastructure}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('security-infrastructure-3', 'Audit', 'page_block',
   'Every action logged to our system_events stream: who did what, when, with what actor and correlation ID. Exportable by your admin for your own compliance records.',
   NULL,
   NULL, '{security,infrastructure}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  ('security-infrastructure-4', 'Migrations', 'page_block',
   'All database schema changes are additive-only, verified idempotent, and deployed via CI/CD. No destructive changes in production without explicit guard rails.',
   NULL,
   NULL, '{security,infrastructure}', true, 'published', now(), 4, '{}'::jsonb, NULL),

  -- CTA
  ('security-cta', 'Ask Eric directly', 'page_block',
   'If your situation has specific security requirements, reach out during the application process. We''ll tell you honestly whether we''re a fit today or what we''d need to build to become one.',
   'Questions about security?',
   NULL, '{security,cta}', true, 'published', now(), 1,
   '{"cta":{"label":"Start an Application","href":"/apply"}}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 6. INFOSEC PAGE  (/infosec)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  -- Hero
  ('infosec-hero', 'Your data. Your agents. Nobody else''s.', 'page_block',
   'Federal R&D proposals contain sensitive IP, pricing strategy, and team composition. We built the architecture assuming that — not as an afterthought.',
   'Security & Data Isolation',
   NULL, '{infosec,hero}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  -- Isolation
  ('infosec-isolation-1', 'Row-Level Security, tenant-scoped.', 'page_block',
   'Unique storage prefix per account. Database queries are RLS-scoped to your tenant ID. Your AI context window never includes another customer''s data — enforced at the database and storage layers, not just application logic.',
   'Customer Isolation',
   NULL, '{infosec,isolation}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('infosec-isolation-2', 'Sandboxed per portal.', 'page_block',
   'Each proposal portal is its own workspace. Agents working on Proposal A cannot read Proposal B''s data unless you explicitly enable cross-proposal library access. Access control is set by your admin, not ours.',
   'Proposal Isolation',
   NULL, '{infosec,isolation}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('infosec-isolation-3', 'Pre-trained. Individually provisioned.', 'page_block',
   'Your company gets its own AI team at signup. These agents are pre-trained on federal R&D compliance patterns but provisioned with access ONLY to your data. They learn from your uploads, your corrections, and your verified decisions — nobody else''s.',
   'Agent Isolation',
   NULL, '{infosec,isolation}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  ('infosec-isolation-4', 'Section-level. Role-level. Revocable.', 'page_block',
   'Invite subcontractors and SMEs to specific sections of specific proposals at specific phases. View, comment, edit — each permission is granular. Revoke access instantly. Every action is audited with actor, timestamp, and change record.',
   'Collaborator Isolation',
   NULL, '{infosec,isolation}', true, 'published', now(), 4, '{}'::jsonb, NULL),

  -- Promise
  ('infosec-promise-1', 'No model training on your data. Ever.', 'page_block',
   'Built on Anthropic''s Claude API with strict enterprise no-training terms. Your proposals, your company data, your compliance decisions are sent as input for each request — but are never used to train or fine-tune the underlying model. Your IP stays yours.',
   'The Claude Promise',
   NULL, '{infosec,promise}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('infosec-promise-2', 'We remember for you. Not about you.', 'page_block',
   'Our proprietary structured memory system stores verified compliance decisions, expert curation history, and proposal templates in tenant-isolated database rows — not in model weights. Your memory is retrievable, auditable, and deletable. It belongs to you, not to a training pipeline.',
   'Structured Memory Architecture',
   NULL, '{infosec,promise}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  -- Collaboration
  ('infosec-collab-1', 'Internal Team', 'page_block',
   'Your admin invites team members by email. Each gets role-based access to the proposals they''re assigned to. All-proposals or per-proposal — your admin decides.',
   NULL,
   NULL, '{infosec,collab}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  ('infosec-collab-2', 'External Collaborators', 'page_block',
   'Subcontractors, university partners, and SMEs get stage-scoped access to specific sections. They upload their materials, review their sections, and see nothing else. Revoke when the phase closes.',
   NULL,
   NULL, '{infosec,collab}', true, 'published', now(), 2, '{}'::jsonb, NULL),

  ('infosec-collab-3', 'Full Audit Trail', 'page_block',
   'Every login, every edit, every comment, every access grant and revocation is logged with actor name, timestamp, and IP. Exportable for your own compliance records.',
   NULL,
   NULL, '{infosec,collab}', true, 'published', now(), 3, '{}'::jsonb, NULL),

  -- Certifications
  ('infosec-certifications', 'What we are. What we aren''t. Yet.', 'page_block',
   '<strong class="text-navy-900">We are:</strong> A SaaS platform with strong tenant isolation, audit logging, encryption at rest and in transit, and a binding commitment to never train on your data.

<strong class="text-navy-900">We are not (yet):</strong> SOC 2 Type II, FedRAMP, or ITAR certified. Most SBIR/STTR proposal development work doesn''t require those — but we''re honest about it.

<strong class="text-navy-900">Roadmap:</strong> SOC 2 targeted for Year 2.',
   NULL,
   NULL, '{infosec,certifications}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  -- CTA
  ('infosec-cta', 'Questions about security? Ask Eric directly.', 'page_block',
   'Raise them in your application. We''ll tell you honestly whether we''re a fit today.',
   NULL,
   NULL, '{infosec,cta}', true, 'published', now(), 1,
   '{"cta":{"label":"Start an Application","href":"/apply"}}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 7. APPLY PAGE  (/apply)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  ('apply-hero', 'Apply to join the founding cohort', 'page_block',
   'We''re accepting 20 small businesses into our initial cohort. The application itself is the qualifier — serious applicants pursuing SBIR, STTR, BAA, OTA, or similar federal R&D funding will be reviewed by Eric within 72 hours.',
   'Founding Cohort Application',
   NULL, '{apply,hero}', true, 'published', now(), 1,
   '{"before_you_apply":"Before you apply: This is a paid service ($299/month after acceptance). There is no free trial. If accepted, you will be invited to onboard, register your admin, upload foundational company documents, and activate your subscription via Stripe."}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 8. GET STARTED PAGE  (/get-started)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  -- Hero
  ('get-started-hero', 'Choose your plan', 'page_block',
   'Start with a 14-day free trial on either plan. No credit card required. Cancel anytime.',
   NULL,
   NULL, '{get-started,hero}', true, 'published', now(), 1, '{}'::jsonb, NULL),

  -- Bottom
  ('get-started-bottom', 'Need something different?', 'page_block',
   'Proposal portals are $999 per Phase I and $2,500 per Phase II, purchased one at a time from inside the Finder. Pipeline subscribers get workspace access included — Finder-only subscribers pay per proposal.',
   NULL,
   NULL, '{get-started,bottom}', true, 'published', now(), 1,
   '{"note":"Questions about plans or volume pricing? Get in touch."}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 9. TEAM MEMBER — Eric Wagner  (for /team page)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, status, published_at, display_order, metadata, featured_image)
VALUES
  ('team-eric-wagner', 'Eric Wagner', 'team_member',
   'Built RFP Pipeline to replicate the playbook that generated hundreds of millions in federal R&D funding across 25+ years — with AI doing the mechanical work and the expert handling the judgment. Former President of D&S Consultants ($270M revenue, 750 employees). Associate Director at Ohio State''s CDME. CEO of Ubihere. B.S. Computer Science and Executive MBA from The Ohio State University. Phase I through Phase III, across DoD, NSF, DOE, DARPA.',
   'Founder & Chief Expert',
   NULL, '{team,founder}', true, 'published', now(), 1,
   '{"linkedin_url":"","email":"eric@rfppipeline.com"}'::jsonb, NULL)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 10. FIX ORPHANED RESOURCES
-- Change content_type from page_block to resource for /resources page
-- ═══════════════════════════════════════════════════════════════════════

UPDATE cms_content SET content_type = 'resource'
WHERE slug IN (
  'resources-sbir',
  'resources-sam',
  'resources-grants',
  'resources-dsip',
  'resources-nsf',
  'resources-darpa',
  'resources-doe'
)
AND content_type = 'page_block';
