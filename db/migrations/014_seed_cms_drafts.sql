-- Migration 014: Seed CMS draft content from static marketing page content
-- Populates draft_content and draft_metadata so the Content Manager shows
-- editable content instead of empty objects.

UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "About RFP Pipeline",
      "title": "Built by people who know federal contracting",
      "description": "RFP Pipeline was created by a team with over two decades of experience in government contracting, SBIR/STTR programs, and technology commercialization. We built the tool we wished we had."
    },
    "mission": {
      "eyebrow": "Our Mission",
      "title": "Level the playing field for small businesses",
      "paragraphs": [
        "Federal procurement is a $700B+ market, but navigating it is overwhelming. Small businesses spend countless hours searching SAM.gov, filtering through irrelevant postings, and missing deadlines on opportunities they should have won.",
        "RFP Pipeline changes that. Our AI-powered platform continuously scans federal procurement sources, scores every opportunity against your unique business profile, and delivers a prioritized pipeline so you can focus on what matters: writing winning proposals."
      ]
    },
    "features": [
      {"icon": "AI", "title": "Scoring Engine", "description": "Multi-factor relevance scoring using NAICS, keywords, set-asides, and agency history"},
      {"icon": "24/7", "title": "Monitoring", "description": "Continuous scanning of SAM.gov and federal procurement sources"},
      {"icon": "SaaS", "title": "Multi-Tenant", "description": "Secure, isolated workspaces for every client organization"},
      {"icon": "Fast", "title": "Setup", "description": "Enter your profile, get scored opportunities in minutes — not weeks"}
    ],
    "howItWorks": [
      {"step": "01", "title": "Information Overload", "description": "Thousands of new opportunities posted daily — most irrelevant to your business."},
      {"step": "02", "title": "Missed Deadlines", "description": "Critical response windows close before you even discover the opportunity."},
      {"step": "03", "title": "Manual Searching", "description": "Hours spent on SAM.gov with clunky filters that return noisy results."},
      {"step": "04", "title": "No Prioritization", "description": "Every opportunity looks the same — no way to focus on what you can actually win."},
      {"step": "05", "title": "Fragmented Tools", "description": "Spreadsheets, email chains, and browser bookmarks instead of a real pipeline."},
      {"step": "06", "title": "Wasted Proposals", "description": "Time spent pursuing opportunities that were never a good fit to begin with."}
    ]
  }'::jsonb,
  draft_metadata = '{"title": "About RFP Pipeline | Government Opportunity Intelligence", "description": "Learn how RFP Pipeline helps companies discover, score, and win federal government contracts using AI-powered opportunity matching."}'::jsonb,
  draft_updated_at = NOW()
WHERE page_key = 'about' AND draft_content IS NULL;

UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "Our Team",
      "title": "Led by a proven federal contracting expert",
      "description": "RFP Pipeline is built on decades of hands-on experience securing federal funding, launching startups, and navigating government procurement."
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
          "He is considered an expert in non-dilutive capital — his most recent cohort submitted 13 proposals and received 13 awards, a 100% success rate."
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
      {"value": "$100M+", "label": "Non-Dilutive Capital", "description": "Acquired for clients and portfolio companies"},
      {"value": "13/13", "label": "SBIR/STTR Awards", "description": "100% success rate in most recent cohort"},
      {"value": "40+", "label": "Startups Advised", "description": "On Air Force APEX program"},
      {"value": "50+", "label": "Companies Supported", "description": "Early-stage technology ventures"},
      {"value": "20+", "label": "Startups Launched", "description": "From Ohio State University"},
      {"value": "$270M+", "label": "Annual Revenue", "description": "Led as President of D&S Consultants"},
      {"value": "800+", "label": "Employees Managed", "description": "Aerospace & defense operations"},
      {"value": "$11M", "label": "Startup Studio", "description": "Converge Ventures fund"}
    ]
  }'::jsonb,
  draft_metadata = '{"title": "Our Team | RFP Pipeline", "description": "Meet the team behind RFP Pipeline — decades of experience in federal contracting, technology commercialization, and startup support."}'::jsonb,
  draft_updated_at = NOW()
WHERE page_key = 'team' AND draft_content IS NULL;

UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "Tips & Tools",
      "title": "Expert resources for federal contracting",
      "description": "Practical guidance from a team that has helped secure over $100M in non-dilutive federal funding. Updated regularly with new strategies and tools."
    },
    "tips": [
      {"date": "March 2026", "category": "SBIR/STTR", "title": "How to Write a Winning SBIR Phase I Proposal", "excerpt": "A step-by-step guide to structuring your SBIR Phase I proposal for maximum impact."},
      {"date": "March 2026", "category": "Getting Started", "title": "SAM.gov Registration: The Complete Checklist", "excerpt": "Before you can bid on any federal contract, you need to be registered in SAM.gov."},
      {"date": "March 2026", "category": "Strategy", "title": "Understanding Set-Aside Categories and How to Leverage Them", "excerpt": "Small business, SDVOSB, WOSB, HUBZone, and 8(a) set-asides can dramatically improve your win probability."},
      {"date": "February 2026", "category": "Tools", "title": "Building Your Capability Statement: A Template and Guide", "excerpt": "Your capability statement is your first impression with federal buyers."},
      {"date": "February 2026", "category": "SBIR/STTR", "title": "Non-Dilutive Capital: Why SBIR/STTR Is the Best Funding for Deep Tech", "excerpt": "For technology startups, SBIR/STTR grants offer funding without equity dilution."},
      {"date": "February 2026", "category": "Strategy", "title": "How to Read a Federal Solicitation in 15 Minutes", "excerpt": "Learn the key sections to focus on and how to identify evaluation criteria."},
      {"date": "January 2026", "category": "Tools", "title": "NAICS Code Selection: Getting It Right the First Time", "excerpt": "Choosing the wrong NAICS codes means missing opportunities."},
      {"date": "January 2026", "category": "Strategy", "title": "The Art of the Sources Sought Response", "excerpt": "Sources sought notices are your chance to shape a future solicitation."}
    ],
    "tools": [
      {"name": "SBIR/STTR Eligibility Checker", "description": "Quick assessment of whether your company qualifies for SBIR/STTR programs.", "status": "Available"},
      {"name": "Capability Statement Template", "description": "Professional template following federal formatting standards.", "status": "Available"},
      {"name": "NAICS Code Lookup", "description": "Search and identify relevant NAICS codes for federal procurement matching.", "status": "Available"},
      {"name": "Proposal Cost Volume Calculator", "description": "Spreadsheet tool for building compliant cost volumes.", "status": "Coming Soon"},
      {"name": "Past Performance Tracker", "description": "Template for organizing past performance references.", "status": "Coming Soon"}
    ]
  }'::jsonb,
  draft_metadata = '{"title": "Tips & Tools | RFP Pipeline", "description": "Expert guidance on federal contracting, SBIR/STTR programs, proposal writing, and winning government contracts."}'::jsonb,
  draft_updated_at = NOW()
WHERE page_key = 'tips' AND draft_content IS NULL;

UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "Customer Wins",
      "title": "Real results from real companies",
      "description": "Our clients are winning federal contracts, securing SBIR/STTR awards, and building sustainable government revenue streams."
    },
    "stats": [
      {"value": "100%", "label": "Recent Win Rate", "description": "SBIR/STTR cohort"},
      {"value": "85%", "label": "Time Saved", "description": "vs. manual search"},
      {"value": "60 Days", "label": "Avg. First Win", "description": "From onboarding"},
      {"value": "$100M+", "label": "Capital Secured", "description": "Across all clients"}
    ],
    "stories": [
      {"company": "Defense Technology Startup", "industry": "Aerospace & Defense", "result": "Won first SBIR Phase I award within 60 days", "quote": "RFP Pipeline surfaced an Air Force opportunity we would have completely missed.", "metrics": ["$150K SBIR Phase I", "First federal contract", "94 relevance score"]},
      {"company": "Advanced Materials Company", "industry": "Manufacturing", "result": "Secured $1.2M in federal contracts within first year", "quote": "We used to spend 10 hours a week searching SAM.gov. Now we spend 20 minutes.", "metrics": ["$1.2M total awards", "85% time saved", "6 contracts won"]},
      {"company": "Cybersecurity Firm", "industry": "Information Technology", "result": "Identified and won a sole-source opportunity through early discovery", "quote": "The deadline alert saved us. We had 5 days to respond.", "metrics": ["$340K sole-source", "5-day response window", "Ongoing IDIQ vehicle"]},
      {"company": "Environmental Services Startup", "industry": "Environmental & Energy", "result": "Built a federal pipeline from zero to 15 active pursuits", "quote": "As a small WOSB, set-aside matching is critical.", "metrics": ["15 active pursuits", "WOSB set-aside focus", "3 wins in 6 months"]}
    ],
    "clientTypes": [
      {"label": "Small Businesses", "desc": "Leverage set-aside matching and SBIR/STTR expertise.", "icon": "01"},
      {"label": "SBIR/STTR Applicants", "desc": "Find topics, track deadlines, and improve win rates.", "icon": "02"},
      {"label": "Defense Contractors", "desc": "Monitor DoD opportunities and track contract vehicles.", "icon": "03"},
      {"label": "Technology Startups", "desc": "Identify non-dilutive federal funding opportunities.", "icon": "04"},
      {"label": "Accelerator Cohorts", "desc": "Batch onboarding and pipeline tracking for programs.", "icon": "05"},
      {"label": "University Spinouts", "desc": "Navigate federal funding for research commercialization.", "icon": "06"}
    ]
  }'::jsonb,
  draft_metadata = '{"title": "Customer Wins | RFP Pipeline", "description": "See how companies are using RFP Pipeline to discover and win government contracts."}'::jsonb,
  draft_updated_at = NOW()
WHERE page_key = 'customers' AND draft_content IS NULL;

UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "News & Announcements",
      "title": "What''s new at RFP Pipeline",
      "description": "Product updates, company news, and important announcements for our customers and community."
    },
    "items": [
      {"date": "March 2026", "category": "Product", "title": "RFP Pipeline Platform Launch", "excerpt": "We are excited to announce the official launch of the RFP Pipeline platform."},
      {"date": "March 2026", "category": "Feature", "title": "AI-Powered Opportunity Scoring Now Live", "excerpt": "Our scoring engine now evaluates every opportunity against your business profile."},
      {"date": "March 2026", "category": "Feature", "title": "Automated Deadline Alerts and Reminders", "excerpt": "Never miss a response deadline again with configurable notifications."},
      {"date": "February 2026", "category": "Company", "title": "Eric Wagner Launches RFP Pipeline", "excerpt": "After two decades of supporting startups and federal contracting, Eric Wagner has founded RFP Pipeline."},
      {"date": "February 2026", "category": "Partnership", "title": "Accelerator Program Integration", "excerpt": "RFP Pipeline is now available as a batch onboarding solution for accelerator programs."},
      {"date": "January 2026", "category": "Product", "title": "Beta Testing Complete: Results Exceed Expectations", "excerpt": "Beta participants reported an average 85% reduction in opportunity search time."}
    ]
  }'::jsonb,
  draft_metadata = '{"title": "News & Announcements | RFP Pipeline", "description": "Latest news, product updates, and announcements from RFP Pipeline."}'::jsonb,
  draft_updated_at = NOW()
WHERE page_key = 'announcements' AND draft_content IS NULL;

UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "Get Started",
      "title": "Choose the plan that fits your mission",
      "description": "From individual contractors to enterprise teams, RFP Pipeline scales with your federal business development needs."
    },
    "tiers": [
      {"name": "Starter", "price": "$49/mo", "description": "For individual contractors getting started with federal procurement.", "features": ["Up to 50 scored opportunities/month", "SAM.gov monitoring", "Email deadline alerts", "Basic NAICS matching"]},
      {"name": "Professional", "price": "$149/mo", "description": "For growing businesses actively pursuing federal contracts.", "features": ["Unlimited scored opportunities", "Multi-factor scoring engine", "Priority deadline alerts", "Set-aside matching", "Pipeline management", "Email support"]},
      {"name": "Enterprise", "price": "Custom", "description": "For teams and accelerator programs with advanced needs.", "features": ["Everything in Professional", "Multi-user workspaces", "Custom scoring profiles", "API access", "Dedicated support", "Accelerator batch onboarding"]}
    ],
    "faqs": [
      {"question": "Can I try RFP Pipeline before committing?", "answer": "Yes — we offer a 14-day free trial on all plans. No credit card required."},
      {"question": "What data sources does RFP Pipeline monitor?", "answer": "We continuously scan SAM.gov and other federal procurement sources for new opportunities."},
      {"question": "How does the scoring engine work?", "answer": "Our AI evaluates each opportunity against your NAICS codes, keywords, set-aside eligibility, agency history, and contract type preferences."},
      {"question": "Can I use RFP Pipeline for my accelerator cohort?", "answer": "Absolutely. Our Enterprise plan includes batch onboarding for accelerator and incubator programs."}
    ]
  }'::jsonb,
  draft_metadata = '{"title": "Get Started | RFP Pipeline", "description": "Choose your plan and start finding federal contract opportunities today."}'::jsonb,
  draft_updated_at = NOW()
WHERE page_key = 'get_started' AND draft_content IS NULL;

UPDATE site_content SET
  draft_content = '{
    "hero": {
      "eyebrow": "RFP Pipeline",
      "title": "Win more federal contracts with AI-powered intelligence",
      "description": "Stop searching. Start winning. RFP Pipeline scans federal procurement sources, scores opportunities against your profile, and delivers a prioritized pipeline."
    },
    "features": [
      {"icon": "AI", "title": "Smart Scoring", "description": "Multi-factor relevance scoring using NAICS, keywords, set-asides, and agency history."},
      {"icon": "24/7", "title": "Always Monitoring", "description": "Continuous scanning of SAM.gov and federal procurement sources."},
      {"icon": "Alert", "title": "Deadline Alerts", "description": "Never miss a response window with automated notifications."},
      {"icon": "Shield", "title": "Secure & Isolated", "description": "Multi-tenant architecture with encrypted data and tenant isolation."}
    ],
    "stats": [
      {"value": "85%", "label": "Time Saved", "description": "vs. manual SAM.gov search"},
      {"value": "100%", "label": "Win Rate", "description": "Recent SBIR/STTR cohort"},
      {"value": "60 Days", "label": "Avg. First Win", "description": "From onboarding to award"}
    ],
    "testimonial": {
      "quote": "RFP Pipeline surfaced an Air Force opportunity we would have completely missed. The scoring told us it was a 94% match — and they were right.",
      "company": "Defense Technology Startup",
      "result": "Won first SBIR Phase I within 60 days"
    },
    "pricingTeaser": {
      "title": "Ready to build your federal pipeline?",
      "description": "Start your 14-day free trial. No credit card required.",
      "ctaText": "Get Started",
      "ctaLink": "/get-started"
    }
  }'::jsonb,
  draft_metadata = '{"title": "RFP Pipeline | AI-Powered Government Contract Intelligence", "description": "Find, score, and win federal contracts with AI-powered opportunity matching. Built for small businesses and SBIR/STTR applicants."}'::jsonb,
  draft_updated_at = NOW()
WHERE page_key = 'home' AND draft_content IS NULL;
