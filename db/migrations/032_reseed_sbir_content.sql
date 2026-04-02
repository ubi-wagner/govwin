-- Migration 032: Reseed CMS draft content with SBIR/STTR focused messaging
-- This updates all site_content rows to reflect the pivot from general federal
-- contracting to focused SBIR/STTR opportunity intelligence.

-- HOME page
UPDATE site_content
SET draft_content = '{
  "hero": {
    "eyebrow": "SBIR/STTR Intelligence",
    "title": "Never miss an SBIR or STTR opportunity again",
    "description": "AI-powered scanning of SAM.gov and agency portals scores every SBIR, STTR, OTA, and BAA opportunity against your technology focus.",
    "trustBadge": "13/13 SBIR/STTR Win Rate · $100M+ Secured"
  },
  "features": [
    {"icon": "Search", "title": "Smart Opportunity Discovery", "description": "Automated scanning of SAM.gov, SBIR.gov, and agency-specific portals for SBIR/STTR topics."},
    {"icon": "Chart", "title": "AI-Powered Scoring", "description": "Each opportunity scored against your technology focus, keywords, and agency alignment."},
    {"icon": "Bell", "title": "Deadline Alerts", "description": "Automated notifications for approaching submission deadlines and new high-scoring matches."},
    {"icon": "Shield", "title": "Eligibility Matching", "description": "Instant identification of SBIR/STTR topics and set-asides that match your qualifications."},
    {"icon": "Document", "title": "Proposal Support", "description": "Expert-guided Phase I ($499) and Phase II ($999) proposal builds to maximize your win rate."},
    {"icon": "Team", "title": "Multi-Tenant Workspaces", "description": "Each client gets their own secure workspace with customized technology profiles."}
  ],
  "stats": [
    {"value": "$100M+", "label": "Non-Dilutive Capital", "description": "Secured through SBIR/STTR awards"},
    {"value": "13/13", "label": "SBIR/STTR Win Rate", "description": "100% success rate in most recent cohort"},
    {"value": "50+", "label": "Startups Supported", "description": "Early-stage technology companies"},
    {"value": "20+", "label": "Years Experience", "description": "SBIR/STTR and federal research funding"}
  ],
  "howItWorks": [
    {"step": "01", "title": "Define Your Technology Focus", "description": "Enter your technology keywords, target agencies, and SBIR/STTR preferences."},
    {"step": "02", "title": "Review Scored Opportunities", "description": "Every day, new SBIR, STTR, OTA, and BAA opportunities are automatically scored and ranked."},
    {"step": "03", "title": "Propose & Win", "description": "Pursue top matches with optional expert proposal support. Track your pipeline to award."}
  ],
  "partners": ["Air Force APEX", "Parallax Advanced Research", "Ohio State CDME", "Converge Ventures", "AFRL"],
  "testimonial": {
    "quote": "GovWin surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match — and they were right. We won our first Phase I within 60 days.",
    "company": "Defense Technology Startup",
    "result": "$150K SBIR Phase I Award"
  },
  "pricingTeaser": {
    "eyebrow": "Simple Pricing",
    "title": "$199/mo + per-proposal expert support",
    "description": "One plan with everything you need. Add Phase I ($499) or Phase II ($999) proposal builds when you are ready to submit.",
    "ctaText": "View Plans & Pricing",
    "ctaLink": "/get-started"
  },
  "cta": {
    "title": "Ready to win your next SBIR/STTR award?",
    "description": "Join 50+ startups already using GovWin to discover and win federal research funding faster.",
    "primaryLabel": "Start Free Trial",
    "primaryHref": "/get-started",
    "secondaryLabel": "See customer wins",
    "secondaryHref": "/customers"
  }
}'::jsonb,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE page_key = 'home';

-- ABOUT page
UPDATE site_content
SET draft_content = '{
  "hero": {
    "eyebrow": "About GovWin",
    "title": "Built by people who win SBIR/STTR awards",
    "description": "GovWin was created by a team with over two decades of experience securing SBIR/STTR awards, launching startups, and commercializing federally funded research. We built the tool we wished we had."
  },
  "mission": {
    "eyebrow": "Our Mission",
    "title": "Level the playing field for small businesses pursuing federal research funding",
    "paragraphs": [
      "The SBIR/STTR programs award billions in federal research funding each year, but finding the right topics, tracking deadlines across dozens of agencies, and writing competitive proposals is overwhelming for small businesses.",
      "GovWin changes that. Our AI-powered platform continuously scans SAM.gov and agency portals, scores every SBIR, STTR, OTA, and BAA opportunity against your technology focus, and delivers a prioritized pipeline so you can focus on what matters: writing winning proposals."
    ]
  },
  "features": [
    {"icon": "AI", "title": "Scoring Engine", "description": "Multi-factor relevance scoring using technology keywords, agency history, and topic alignment"},
    {"icon": "24/7", "title": "Monitoring", "description": "Continuous scanning of SAM.gov, SBIR.gov, and agency-specific portals"},
    {"icon": "SaaS", "title": "Multi-Tenant", "description": "Secure, isolated workspaces for every client organization"},
    {"icon": "Fast", "title": "Setup", "description": "Enter your technology profile, get scored opportunities in minutes — not weeks"}
  ],
  "howItWorks": [
    {"step": "01", "title": "Information Overload", "description": "Hundreds of SBIR/STTR topics posted across dozens of agencies — most irrelevant to your technology."},
    {"step": "02", "title": "Missed Deadlines", "description": "Critical submission windows close before you even discover the topic."},
    {"step": "03", "title": "Manual Searching", "description": "Hours spent on SBIR.gov and SAM.gov with clunky filters that return noisy results."},
    {"step": "04", "title": "No Prioritization", "description": "Every topic looks the same — no way to focus on what you can actually win."},
    {"step": "05", "title": "Fragmented Tools", "description": "Spreadsheets, email chains, and browser bookmarks instead of a real pipeline."},
    {"step": "06", "title": "Wasted Proposals", "description": "Time spent pursuing topics that were never a good fit to begin with."}
  ]
}'::jsonb,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE page_key = 'about';

-- TEAM page
UPDATE site_content
SET draft_content = '{
  "hero": {
    "eyebrow": "Our Team",
    "title": "Led by a proven SBIR/STTR expert",
    "description": "GovWin is built on decades of hands-on experience securing SBIR/STTR awards, launching startups, and commercializing federally funded research."
  },
  "members": [
    {
      "name": "Eric Wagner",
      "title": "Founder & CEO",
      "linkedIn": "https://www.linkedin.com/in/eric-wagner-7480385/",
      "bio": [
        "Eric Wagner is a C-Suite executive, inventor, entrepreneur, and investor with more than 20 years of technology commercialization experience.",
        "He is the co-founder, CSO and EVP of Business Development at Converge Technologies, and co-founder and CEO of Converge Ventures, an $11 million startup studio.",
        "Eric served as President of D&S Consultants, an aerospace and defense company with annual revenues exceeding $270 million and more than 800 employees.",
        "He is considered an expert in non-dilutive capital — his most recent cohort submitted 13 SBIR/STTR proposals and received 13 awards, a 100% success rate."
      ],
      "credentials": [
        "BS in Computer Science (cum laude) — The Ohio State University",
        "Executive MBA (magna cum laude, Salutatorian) — The Ohio State University",
        "Ohio TechAngels member and active angel investor",
        "I-Corps@Ohio founding instructor"
      ]
    }
  ],
  "stats": [
    {"value": "$100M+", "label": "Non-Dilutive Capital", "description": "Secured through SBIR/STTR and federal research funding"},
    {"value": "13/13", "label": "SBIR/STTR Awards", "description": "100% success rate in most recent cohort"},
    {"value": "40+", "label": "Startups Advised", "description": "On Air Force APEX program"},
    {"value": "50+", "label": "Companies Supported", "description": "Early-stage technology ventures"},
    {"value": "20+", "label": "Startups Launched", "description": "From Ohio State University"},
    {"value": "$270M+", "label": "Annual Revenue", "description": "Led as President of D&S Consultants"},
    {"value": "800+", "label": "Employees Managed", "description": "Aerospace & defense operations"},
    {"value": "$11M", "label": "Startup Studio", "description": "Converge Ventures fund"}
  ]
}'::jsonb,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE page_key = 'team';

-- TIPS page
UPDATE site_content
SET draft_content = '{
  "hero": {
    "eyebrow": "Tips & Tools",
    "title": "Expert resources for SBIR/STTR success",
    "description": "Practical guidance from a team with a 13/13 SBIR/STTR win rate and $100M+ in non-dilutive federal funding secured. Updated regularly with new strategies and tools."
  },
  "tips": [
    {"date": "March 2026", "category": "SBIR/STTR", "title": "How to Write a Winning SBIR Phase I Proposal", "excerpt": "A step-by-step guide to structuring your SBIR Phase I proposal for maximum impact."},
    {"date": "March 2026", "category": "Getting Started", "title": "SAM.gov Registration: The Complete Checklist", "excerpt": "Before you can pursue any federal research funding, you need to be registered in SAM.gov."},
    {"date": "March 2026", "category": "Strategy", "title": "Choosing the Right SBIR/STTR Topics for Your Technology", "excerpt": "How to evaluate agency topics against your technical capabilities and commercialization roadmap."},
    {"date": "February 2026", "category": "Tools", "title": "Building Your Capability Statement: A Template and Guide", "excerpt": "Your capability statement is your first impression with federal program managers."},
    {"date": "February 2026", "category": "SBIR/STTR", "title": "Non-Dilutive Capital: Why SBIR/STTR Is the Best Funding for Deep Tech", "excerpt": "For technology startups, SBIR/STTR grants offer funding without equity dilution."},
    {"date": "February 2026", "category": "Strategy", "title": "Phase I to Phase II: Building a Commercialization Plan That Wins", "excerpt": "Learn what reviewers look for in your Phase II commercialization strategy."},
    {"date": "January 2026", "category": "Tools", "title": "NAICS Code Selection: Getting It Right the First Time", "excerpt": "Choosing the wrong NAICS codes means missing SBIR/STTR opportunities."},
    {"date": "January 2026", "category": "Strategy", "title": "OTA and BAA Opportunities: Beyond Traditional SBIR/STTR", "excerpt": "Other Transaction Authorities and Broad Agency Announcements offer additional paths to federal research funding."}
  ],
  "tools": [
    {"name": "SBIR/STTR Eligibility Checker", "description": "Quick assessment of whether your company qualifies for SBIR/STTR programs.", "status": "Available"},
    {"name": "Capability Statement Template", "description": "Professional template following federal formatting standards.", "status": "Available"},
    {"name": "NAICS Code Lookup", "description": "Search and identify relevant NAICS codes for SBIR/STTR topic matching.", "status": "Available"},
    {"name": "Phase I Budget Calculator", "description": "Tool for building compliant SBIR/STTR Phase I cost volumes.", "status": "Coming Soon"},
    {"name": "Commercialization Plan Template", "description": "Template for structuring your Phase II commercialization strategy.", "status": "Coming Soon"}
  ]
}'::jsonb,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE page_key = 'tips';

-- CUSTOMERS page
UPDATE site_content
SET draft_content = '{
  "hero": {
    "eyebrow": "Customer Wins",
    "title": "Real results from real companies",
    "description": "Our clients are winning SBIR/STTR awards, securing federal research funding, and building sustainable non-dilutive revenue streams."
  },
  "stats": [
    {"value": "13/13", "label": "SBIR/STTR Win Rate", "description": "Most recent cohort"},
    {"value": "85%", "label": "Time Saved", "description": "vs. manual search"},
    {"value": "60 Days", "label": "Avg. First Win", "description": "From onboarding"},
    {"value": "$100M+", "label": "Capital Secured", "description": "Across all clients"}
  ],
  "stories": [
    {"company": "Defense Technology Startup", "industry": "Aerospace & Defense", "result": "Won first SBIR Phase I award within 60 days", "quote": "GovWin surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match — and they were right.", "metrics": ["$150K SBIR Phase I", "First federal award", "94 relevance score"]},
    {"company": "Advanced Materials Company", "industry": "Manufacturing", "result": "Secured $1.2M in SBIR/STTR awards within first year", "quote": "We used to spend 10 hours a week searching SBIR.gov and SAM.gov. Now we spend 20 minutes reviewing scored opportunities.", "metrics": ["$1.2M total awards", "85% time saved", "6 SBIR/STTR awards"]},
    {"company": "Cybersecurity Firm", "industry": "Information Technology", "result": "Identified a BAA opportunity through early discovery and won the award", "quote": "The deadline alert saved us. We had 5 days to respond to a perfectly matched BAA.", "metrics": ["$340K BAA award", "5-day response window", "Follow-on Phase II funded"]},
    {"company": "Environmental Services Startup", "industry": "Environmental & Energy", "result": "Built an SBIR pipeline from zero to 15 active pursuits", "quote": "As a small WOSB, finding SBIR/STTR topics aligned to our technology was like finding a needle in a haystack before GovWin.", "metrics": ["15 active pursuits", "WOSB set-aside focus", "3 SBIR wins in 6 months"]}
  ],
  "clientTypes": [
    {"label": "SBIR/STTR Applicants", "desc": "Find topics, track deadlines, and improve win rates with AI-powered scoring.", "icon": "01"},
    {"label": "Deep Tech Startups", "desc": "Identify non-dilutive federal research funding for your technology.", "icon": "02"},
    {"label": "Defense Innovators", "desc": "Monitor DoD SBIR/STTR topics, OTAs, and BAAs aligned to your capabilities.", "icon": "03"},
    {"label": "Small Businesses", "desc": "Leverage set-aside matching and SBIR/STTR expertise to win awards.", "icon": "04"},
    {"label": "Accelerator Cohorts", "desc": "Batch onboarding and pipeline tracking for SBIR/STTR programs.", "icon": "05"},
    {"label": "University Spinouts", "desc": "Navigate STTR funding for research commercialization.", "icon": "06"}
  ]
}'::jsonb,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE page_key = 'customers';

-- ANNOUNCEMENTS page
UPDATE site_content
SET draft_content = '{
  "hero": {
    "eyebrow": "News & Announcements",
    "title": "What''s new at GovWin",
    "description": "Product updates, company news, and important announcements for our customers and community."
  },
  "items": [
    {"date": "March 2026", "category": "Product", "title": "GovWin Platform Launch", "excerpt": "We are excited to announce the official launch of the GovWin SBIR/STTR intelligence platform."},
    {"date": "March 2026", "category": "Feature", "title": "AI-Powered Opportunity Scoring Now Live", "excerpt": "Our scoring engine now evaluates every SBIR, STTR, OTA, and BAA opportunity against your technology focus."},
    {"date": "March 2026", "category": "Feature", "title": "Automated Deadline Alerts and Reminders", "excerpt": "Never miss a submission deadline again with configurable notifications across all agency portals."},
    {"date": "February 2026", "category": "Company", "title": "Eric Wagner Launches GovWin", "excerpt": "After two decades of helping startups win SBIR/STTR awards and secure $100M+ in non-dilutive capital, Eric Wagner has founded GovWin."},
    {"date": "February 2026", "category": "Partnership", "title": "Accelerator Program Integration", "excerpt": "GovWin is now available as a batch onboarding solution for SBIR/STTR accelerator programs."},
    {"date": "January 2026", "category": "Product", "title": "Beta Testing Complete: Results Exceed Expectations", "excerpt": "Beta participants reported an average 85% reduction in SBIR/STTR opportunity search time."}
  ]
}'::jsonb,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE page_key = 'announcements';

-- GET_STARTED page
UPDATE site_content
SET draft_content = '{
  "hero": {
    "eyebrow": "Simple, transparent pricing",
    "title": "One plan. Everything you need to win SBIR/STTR awards.",
    "description": "AI-powered opportunity intelligence plus expert proposal support when you need it."
  },
  "tiers": [
    {
      "name": "GovWin Pro",
      "price": "$199",
      "period": "month",
      "description": "Everything you need to find and win SBIR/STTR opportunities.",
      "features": [
        "Unlimited scored SBIR/STTR/OTA/BAA opportunities",
        "AI-powered relevance scoring against your technology focus",
        "Multi-agency scanning (SAM.gov, SBIR.gov, agency portals)",
        "Real-time deadline alerts and notifications",
        "Set-aside and eligibility matching",
        "Document management and templates",
        "Up to 5 user workspaces",
        "Priority support"
      ],
      "cta": "Start Free Trial",
      "popular": true
    }
  ],
  "addOns": [
    {"name": "Phase I Proposal Build", "price": "$499", "description": "Expert-guided proposal development for SBIR/STTR Phase I submissions. Includes outline, technical writing review, budget preparation, and compliance check."},
    {"name": "Phase II Proposal Build", "price": "$999", "description": "Comprehensive proposal support for SBIR/STTR Phase II submissions. Includes commercialization plan, technical volume review, budget narrative, and full compliance review."}
  ],
  "faqs": [
    {"q": "How does the free trial work?", "a": "You get 14 days of full access to GovWin Pro. No credit card required to start."},
    {"q": "What are the per-proposal builds?", "a": "Our Phase I ($499) and Phase II ($999) proposal builds pair you with SBIR/STTR experts who review, refine, and help you submit a competitive proposal. These are one-time fees per proposal."},
    {"q": "Do you offer annual billing?", "a": "Yes — annual plans save you 20%. Contact us for a custom annual agreement."},
    {"q": "What payment methods do you accept?", "a": "We accept all major credit cards and ACH bank transfers for annual plans. Processed securely via Stripe."},
    {"q": "Is there a setup fee?", "a": "No setup fees, ever. Your workspace is provisioned instantly when you subscribe."},
    {"q": "What is your win rate?", "a": "Our most recent SBIR/STTR cohort achieved a 13/13 (100%) win rate. We have helped secure over $100M in non-dilutive capital across 50+ companies."}
  ],
  "contactCta": {
    "title": "Need a custom solution?",
    "description": "For accelerator programs, university tech transfer offices, or large teams — let''s talk about a tailored plan.",
    "email": "eric@govwin.com"
  }
}'::jsonb,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE page_key = 'get_started';
