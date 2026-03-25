-- Migration 015: Re-seed home and get_started draft content to match new page component formats
-- Previous migration 014 seeded these with old-format data that doesn't match
-- the current STATIC_CONTENT structures in the page components.

-- Home page: add missing sections (howItWorks, partners, cta) and trustBadge in hero
UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "RFP Pipeline",
      "title": "Find and win federal contracts before your competitors",
      "description": "RFP Pipeline uses AI-powered scoring to surface the government opportunities most relevant to your business. Stop searching. Start winning.",
      "trustBadge": "Trusted by 50+ startups \u00b7 $100M+ secured"
    },
    "features": [
      {"icon": "Search", "title": "Smart Opportunity Discovery", "description": "Automated scanning of SAM.gov and federal procurement sources. Never miss a relevant RFP, RFI, or sources sought notice."},
      {"icon": "Chart", "title": "AI-Powered Scoring", "description": "Each opportunity is scored against your company profile, NAICS codes, keywords, set-aside eligibility, and past performance."},
      {"icon": "Bell", "title": "Deadline Alerts", "description": "Automated notifications for approaching deadlines, new high-scoring matches, and status changes on opportunities you are tracking."},
      {"icon": "Shield", "title": "Set-Aside Matching", "description": "Instant identification of small business, SDVOSB, WOSB, HUBZone, and 8(a) set-asides that match your certifications."},
      {"icon": "Document", "title": "Document Management", "description": "Centralized storage for capability statements, past performance records, and proposal templates."},
      {"icon": "Team", "title": "Multi-Tenant Workspaces", "description": "Each client gets their own secure workspace with customized scoring profiles, opportunity pipelines, and team access."}
    ],
    "stats": [
      {"value": "$100M+", "label": "Non-Dilutive Capital", "description": "Secured for clients"},
      {"value": "100%", "label": "Recent Win Rate", "description": "13/13 SBIR/STTR awards"},
      {"value": "50+", "label": "Startups Supported", "description": "Early-stage technology companies"},
      {"value": "20+", "label": "Years Experience", "description": "Federal contracting expertise"}
    ],
    "howItWorks": [
      {"step": "01", "title": "Profile Your Business", "description": "Enter your NAICS codes, keywords, set-aside certifications, and target agencies. Our scoring engine learns what matters to you."},
      {"step": "02", "title": "Review Scored Opportunities", "description": "Every day, new federal opportunities are automatically scored and ranked. Focus on the highest-value matches first."},
      {"step": "03", "title": "Pursue & Win", "description": "Track your pipeline, collaborate with your team, and leverage AI insights to craft winning proposals."}
    ],
    "partners": ["Air Force APEX", "Parallax Advanced Research", "Ohio State CDME", "Converge Ventures", "AFRL"],
    "testimonial": {
      "quote": "RFP Pipeline surfaced an Air Force opportunity we would have completely missed. The scoring told us it was a 94% match — and they were right. We won our first SBIR Phase I within 60 days.",
      "company": "Defense Technology Startup",
      "result": "$150K SBIR Phase I Award"
    },
    "pricingTeaser": {
      "eyebrow": "Simple Pricing",
      "title": "Plans that grow with your pipeline",
      "description": "Start with a free trial. Upgrade when you are ready. No surprises.",
      "ctaText": "View Plans & Pricing",
      "ctaLink": "/get-started"
    },
    "cta": {
      "title": "Ready to find your next contract?",
      "description": "Join the companies already using RFP Pipeline to discover and win government opportunities faster.",
      "primaryLabel": "Start Free Trial",
      "primaryHref": "/get-started",
      "secondaryLabel": "See customer wins",
      "secondaryHref": "/customers"
    }
  }'::jsonb,
  draft_metadata = '{"title": "RFP Pipeline | AI-Powered Government Contract Intelligence", "description": "Find, score, and win federal contracts with AI-powered opportunity matching. Built for small businesses and SBIR/STTR applicants."}'::jsonb,
  draft_updated_at = NOW(),
  updated_at = NOW()
WHERE page_key = 'home';

-- Get Started page: fix tier format (price/period/cta/popular fields), faq keys (q/a), add comparison and contactCta
UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "14-day free trial \u00b7 No credit card required",
      "title": "Choose the plan that fits your mission",
      "description": "Start with a free trial on any plan. Scale as your pipeline grows."
    },
    "tiers": [
      {"name": "Starter", "price": "$49", "period": "month", "description": "Perfect for small businesses exploring federal contracting.", "features": ["Up to 50 scored opportunities/month", "1 user workspace", "3 NAICS code profiles", "Weekly email digest", "SAM.gov opportunity scanning", "Basic deadline alerts"], "cta": "Start Free Trial", "popular": false},
      {"name": "Professional", "price": "$149", "period": "month", "description": "For active bidders who need a competitive edge.", "features": ["Unlimited scored opportunities", "Up to 5 user workspaces", "Unlimited NAICS code profiles", "Daily email digest + real-time alerts", "AI-powered scoring & ranking", "Set-aside matching", "Document management", "Priority support"], "cta": "Start Free Trial", "popular": true},
      {"name": "Enterprise", "price": "$399", "period": "month", "description": "For teams and accelerators managing multiple pipelines.", "features": ["Everything in Professional", "Unlimited user workspaces", "Multi-tenant management", "Batch onboarding (accelerator cohorts)", "Custom scoring profiles", "API access", "Dedicated account manager", "SSO & advanced security"], "cta": "Contact Sales", "popular": false}
    ],
    "comparison": [
      ["Scored Opportunities", "50/mo", "Unlimited", "Unlimited"],
      ["User Workspaces", "1", "5", "Unlimited"],
      ["NAICS Profiles", "3", "Unlimited", "Unlimited"],
      ["SAM.gov Scanning", true, true, true],
      ["AI Scoring & Ranking", false, true, true],
      ["Set-Aside Matching", false, true, true],
      ["Deadline Alerts", "Basic", "Real-time", "Real-time"],
      ["Document Management", false, true, true],
      ["Multi-Tenant", false, false, true],
      ["API Access", false, false, true],
      ["Support", "Email", "Priority", "Dedicated"]
    ],
    "faqs": [
      {"q": "How does the free trial work?", "a": "You get 14 days of full access to your selected plan. No credit card required to start. You can upgrade, downgrade, or cancel at any time."},
      {"q": "Can I change plans later?", "a": "Absolutely. Upgrade or downgrade at any time. Changes take effect at your next billing cycle. No penalties or hidden fees."},
      {"q": "Do you offer annual billing?", "a": "Yes — annual plans save you 20%. Contact us for a custom annual agreement with additional perks."},
      {"q": "What payment methods do you accept?", "a": "We accept all major credit cards (Visa, Mastercard, Amex) and ACH bank transfers for annual plans. Processed securely via Stripe."},
      {"q": "Is there a setup fee?", "a": "No setup fees, ever. Your workspace is provisioned instantly when you subscribe. We help you configure your scoring profile during onboarding."},
      {"q": "Do you offer discounts for startups or nonprofits?", "a": "Yes. SBIR/STTR applicants and registered nonprofits qualify for 25% off any plan. Contact our team to apply."}
    ],
    "contactCta": {
      "title": "Need a custom solution?",
      "description": "For accelerator programs, government agencies, or large teams — let us talk about a tailored plan.",
      "email": "eric@rfppipeline.com"
    }
  }'::jsonb,
  draft_metadata = '{"title": "Get Started | RFP Pipeline", "description": "Choose your plan and start finding federal contract opportunities today."}'::jsonb,
  draft_updated_at = NOW(),
  updated_at = NOW()
WHERE page_key = 'get_started';

-- Also clear any published content that was in the old format, so pages
-- fall back to static defaults until admin re-publishes with correct format
UPDATE site_content SET
  previous_content = published_content,
  previous_metadata = published_metadata,
  previous_published_at = published_at,
  published_content = NULL,
  published_metadata = NULL,
  published_at = NULL
WHERE page_key IN ('home', 'get_started') AND published_content IS NOT NULL;
