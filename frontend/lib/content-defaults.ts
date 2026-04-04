/**
 * Default content for each CMS page.
 * Used to auto-seed draft_content when a page has never been edited.
 * These match the STATIC_CONTENT objects in the marketing page components.
 */

export const PAGE_DEFAULTS: Record<string, { content: Record<string, unknown>; metadata: { title: string; description: string } }> = {
  about: {
    content: {
      hero: {
        eyebrow: 'About RFP Pipeline',
        title: 'Level the Playing Field for Small Business Innovation',
        description: 'The SBIR and STTR programs exist to fund the best ideas from small businesses. We built the platform that makes those programs accessible to CEOs and lean teams who don\'t have six-figure BD budgets.',
      },
      mission: {
        eyebrow: 'Our Mission',
        title: 'Make $4B+ in annual SBIR/STTR funding accessible to every innovative small business',
        paragraphs: [
          'The SBIR/STTR programs award billions in federal research funding each year, but finding the right topics, tracking deadlines across dozens of agencies, and writing competitive proposals is overwhelming for small businesses.',
          'RFP Pipeline changes that. Our AI-powered platform continuously scans SAM.gov and agency portals, scores every SBIR, STTR, OTA, and BAA opportunity against your technology focus, and delivers a prioritized pipeline so you can focus on what matters: writing winning proposals.',
        ],
      },
      features: [
        { icon: 'AI', title: 'Scoring Engine', description: 'Multi-factor relevance scoring using technology keywords, agency history, and topic alignment' },
        { icon: '24/7', title: 'Monitoring', description: 'Continuous scanning of SAM.gov, SBIR.gov, and agency-specific portals' },
        { icon: 'SaaS', title: 'Multi-Tenant', description: 'Secure, isolated workspaces for every client organization' },
        { icon: 'Fast', title: 'Setup', description: 'Enter your technology profile, get scored opportunities in minutes — not weeks' },
      ],
      howItWorks: [
        { step: '01', title: 'Information Overload', description: 'Hundreds of SBIR/STTR topics posted across dozens of agencies — most irrelevant to your technology.' },
        { step: '02', title: 'Missed Deadlines', description: 'Critical submission windows close before you even discover the topic.' },
        { step: '03', title: 'Manual Searching', description: 'Hours spent on SBIR.gov and SAM.gov with clunky filters that return noisy results.' },
        { step: '04', title: 'No Prioritization', description: 'Every topic looks the same — no way to focus on what you can actually win.' },
        { step: '05', title: 'Fragmented Tools', description: 'Spreadsheets, email chains, and browser bookmarks instead of a real pipeline.' },
        { step: '06', title: 'Wasted Proposals', description: 'Time spent pursuing topics that were never a good fit to begin with.' },
      ],
    },
    metadata: {
      title: 'About RFP Pipeline | SBIR/STTR Opportunity Intelligence',
      description: 'Learn how RFP Pipeline helps small businesses discover, score, and win SBIR/STTR awards and federal research funding using AI-powered opportunity matching.',
    },
  },

  team: {
    content: {
      hero: {
        eyebrow: 'Meet the Founder',
        title: 'Built by someone who has done it',
        description: 'RFP Pipeline is built on decades of hands-on experience securing SBIR/STTR awards, launching startups, and commercializing federally funded research.',
      },
      members: [
        {
          name: 'Eric Wagner',
          title: 'Founder & CEO',
          linkedIn: 'https://www.linkedin.com/in/eric-wagner-7480385/',
          bio: [
            'Eric Wagner is a C-Suite executive, inventor, entrepreneur, and investor with more than 20 years of technology commercialization experience.',
            'He co-founded Converge Technologies and Lighthouse Avionics, and founded Ohio Gateway Tech Fund — a $10M pre-seed fund and support studio where he served as GP and LP.',
            'Eric served as President of D&S Consultants, an aerospace and defense company with annual revenues exceeding $300 million and more than 800 employees, with a core mission of innovation development and successful transition of that innovation into high-tech fieldable hardware and software solutions for the DoD.',
            'He is considered an expert in non-dilutive capital — over the last decade he won dozens of Phase I, II, and III awards for his own startups and mentored hundreds of additional wins across hundreds of millions in non-dilutive funding.',
          ],
          credentials: [
            'BS in Computer Science (cum laude) — The Ohio State University',
            'Executive MBA (magna cum laude, Salutatorian) — The Ohio State University',
            'Ohio TechAngels member and active angel investor',
            'I-Corps@Ohio founding instructor',
          ],
        },
      ],
      stats: [
        { value: 'Dozens', label: 'Phase I, II & III Awards', description: 'Over the last decade' },
        { value: '$300M+', label: 'Revenue Led', description: 'As President of D&S Consultants' },
        { value: '40+', label: 'Startups Advised', description: 'Through Air Force APEX program' },
        { value: '50+', label: 'Companies Supported', description: 'Early-stage technology ventures' },
        { value: '20+', label: 'Startups Launched', description: 'From Ohio State University' },
        { value: '800+', label: 'Employees Managed', description: 'Aerospace & defense operations' },
        { value: '$10M', label: 'Pre-Seed Fund', description: 'Ohio Gateway Tech Fund (GP & LP)' },
      ],
    },
    metadata: {
      title: 'Meet the Founder | RFP Pipeline',
      description: 'Meet the founder behind RFP Pipeline — decades of experience winning SBIR/STTR awards, technology commercialization, and startup support.',
    },
  },

  tips: {
    content: {
      hero: {
        eyebrow: 'Tips & Tools',
        title: 'Expert resources for SBIR/STTR success',
        description: 'Practical guidance from a founder with dozens of SBIR/STTR awards and hundreds of millions in non-dilutive federal funding secured. Updated regularly with new strategies and tools.',
      },
      tips: [
        { date: 'March 2026', category: 'SBIR/STTR', title: 'How to Write a Winning SBIR Phase I Proposal', excerpt: 'A step-by-step guide to structuring your SBIR Phase I proposal for maximum impact.' },
        { date: 'March 2026', category: 'Getting Started', title: 'SAM.gov Registration: The Complete Checklist', excerpt: 'Before you can pursue any federal research funding, you need to be registered in SAM.gov.' },
        { date: 'March 2026', category: 'Strategy', title: 'Choosing the Right SBIR/STTR Topics for Your Technology', excerpt: 'How to evaluate agency topics against your technical capabilities and commercialization roadmap.' },
        { date: 'February 2026', category: 'Tools', title: 'Building Your Capability Statement: A Template and Guide', excerpt: 'Your capability statement is your first impression with federal program managers.' },
        { date: 'February 2026', category: 'SBIR/STTR', title: 'Non-Dilutive Capital: Why SBIR/STTR Is the Best Funding for Deep Tech', excerpt: 'For technology startups, SBIR/STTR grants offer funding without equity dilution.' },
        { date: 'February 2026', category: 'Strategy', title: 'Phase I to Phase II: Building a Commercialization Plan That Wins', excerpt: 'Learn what reviewers look for in your Phase II commercialization strategy.' },
        { date: 'January 2026', category: 'Tools', title: 'NAICS Code Selection: Getting It Right the First Time', excerpt: 'Choosing the wrong NAICS codes means missing SBIR/STTR opportunities.' },
        { date: 'January 2026', category: 'Strategy', title: 'OTA and BAA Opportunities: Beyond Traditional SBIR/STTR', excerpt: 'Other Transaction Authorities and Broad Agency Announcements offer additional paths to federal research funding.' },
      ],
      tools: [
        { name: 'SBIR/STTR Eligibility Checker', description: 'Quick assessment of whether your company qualifies for SBIR/STTR programs.', status: 'Available' },
        { name: 'Capability Statement Template', description: 'Professional template following federal formatting standards.', status: 'Available' },
        { name: 'NAICS Code Lookup', description: 'Search and identify relevant NAICS codes for SBIR/STTR topic matching.', status: 'Available' },
        { name: 'Phase I Budget Calculator', description: 'Tool for building compliant SBIR/STTR Phase I cost volumes.', status: 'Coming Soon' },
        { name: 'Commercialization Plan Template', description: 'Template for structuring your Phase II commercialization strategy.', status: 'Coming Soon' },
      ],
    },
    metadata: {
      title: 'Tips & Tools | RFP Pipeline',
      description: 'Expert guidance on SBIR/STTR proposals, federal research funding, and winning non-dilutive capital for your technology startup.',
    },
  },

  customers: {
    content: {
      hero: {
        eyebrow: 'Customer Wins',
        title: 'Real results from real companies',
        description: 'Our clients are winning SBIR/STTR awards, securing federal research funding, and building sustainable non-dilutive revenue streams.',
      },
      stats: [
        { value: 'Dozens', label: 'SBIR/STTR Awards', description: 'Phase I, II & III over the last decade' },
        { value: '85%', label: 'Time Saved', description: 'vs. manual search' },
        { value: '60 Days', label: 'Avg. First Win', description: 'From onboarding' },
        { value: '$100Ms', label: 'Capital Secured', description: 'Across advised and mentored startups' },
      ],
      stories: [
        { company: 'Defense Technology Startup', industry: 'Aerospace & Defense', result: 'Won first SBIR Phase I award within 60 days', quote: 'RFP Pipeline surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match — and they were right.', metrics: ['$150K SBIR Phase I', 'First federal award', '94 relevance score'] },
        { company: 'Advanced Materials Company', industry: 'Manufacturing', result: 'Secured $1.2M in SBIR/STTR awards within first year', quote: 'We used to spend 10 hours a week searching SBIR.gov and SAM.gov. Now we spend 20 minutes reviewing scored opportunities.', metrics: ['$1.2M total awards', '85% time saved', '6 SBIR/STTR awards'] },
        { company: 'Cybersecurity Firm', industry: 'Information Technology', result: 'Identified a BAA opportunity through early discovery and won the award', quote: 'The deadline alert saved us. We had 5 days to respond to a perfectly matched BAA.', metrics: ['$340K BAA award', '5-day response window', 'Follow-on Phase II funded'] },
        { company: 'Environmental Services Startup', industry: 'Environmental & Energy', result: 'Built an SBIR pipeline from zero to 15 active pursuits', quote: 'As a small WOSB, finding SBIR/STTR topics aligned to our technology was like finding a needle in a haystack before RFP Pipeline.', metrics: ['15 active pursuits', 'WOSB set-aside focus', '3 SBIR wins in 6 months'] },
      ],
      clientTypes: [
        { label: 'SBIR/STTR Applicants', desc: 'Find topics, track deadlines, and improve win rates with AI-powered scoring.', icon: '01' },
        { label: 'Deep Tech Startups', desc: 'Identify non-dilutive federal research funding for your technology.', icon: '02' },
        { label: 'Defense Innovators', desc: 'Monitor DoD SBIR/STTR topics, OTAs, and BAAs aligned to your capabilities.', icon: '03' },
        { label: 'Small Businesses', desc: 'Leverage set-aside matching and SBIR/STTR expertise to win awards.', icon: '04' },
        { label: 'Accelerator Cohorts', desc: 'Batch onboarding and pipeline tracking for SBIR/STTR programs.', icon: '05' },
        { label: 'University Spinouts', desc: 'Navigate STTR funding for research commercialization.', icon: '06' },
      ],
    },
    metadata: {
      title: 'Customer Wins | RFP Pipeline',
      description: 'See how companies are using RFP Pipeline to discover and win SBIR/STTR awards and federal research funding.',
    },
  },

  announcements: {
    content: {
      hero: {
        eyebrow: 'News & Announcements',
        title: "What's New at RFP Pipeline",
        description: 'Product updates, company news, and important announcements for our customers and community.',
      },
      items: [
        { date: 'March 2026', category: 'Product', title: 'RFP Pipeline SBIR/STTR Intelligence Platform — Launching May 15, 2026', excerpt: 'We have built the definitive platform for small businesses pursuing SBIR, STTR, OTA, and BAA opportunities. Join the waitlist for early access.' },
        { date: 'March 2026', category: 'Feature', title: 'AI-Powered Opportunity Scoring Now Live', excerpt: 'Our scoring engine now evaluates every SBIR, STTR, OTA, and BAA opportunity against your technology focus.' },
        { date: 'March 2026', category: 'Feature', title: 'Automated Deadline Alerts and Reminders', excerpt: 'Never miss a submission deadline again with configurable notifications across all agency portals.' },
        { date: 'February 2026', category: 'Company', title: 'Eric Wagner Founds RFP Pipeline', excerpt: 'After two decades of helping startups win SBIR/STTR awards — with dozens of Phase I, II, and III awards and hundreds of additional wins mentored across hundreds of millions in non-dilutive capital — Eric Wagner has founded RFP Pipeline.' },
        { date: 'February 2026', category: 'Partnership', title: 'Accelerator Program Integration', excerpt: 'RFP Pipeline is now available as a batch onboarding solution for SBIR/STTR accelerator programs.' },
        { date: 'January 2026', category: 'Product', title: 'Beta Testing Complete: Results Exceed Expectations', excerpt: 'Beta participants reported an average 85% reduction in SBIR/STTR opportunity search time.' },
      ],
    },
    metadata: {
      title: 'News & Announcements | RFP Pipeline',
      description: 'Latest news, product updates, and announcements from RFP Pipeline.',
    },
  },

  get_started: {
    content: {
      hero: {
        eyebrow: 'Simple, Transparent Pricing',
        title: '10 Phase I Proposals for Less Than a Consultant.',
        description: 'Look only, never pay until you build. Pipeline Engine is your monthly SBIR/STTR command center. Builds are one-time, per-proposal fees covering any agency.',
      },
      tiers: [
        {
          name: 'Pipeline Engine',
          price: '$199',
          period: 'month',
          description: 'Launching May 15, 2026',
          features: [
            'Unlimited scored SBIR/STTR/OTA/BAA opportunities',
            'AI-powered relevance scoring against your technology focus',
            'Multi-agency scanning (SAM.gov, SBIR.gov, agency portals)',
            'Real-time deadline alerts and notifications',
            'Set-aside and eligibility matching',
            'Document management and templates',
            'Up to 5 user workspaces',
            'Priority support'
          ],
          cta: 'Join the Waitlist',
          popular: true
        },
      ],
      addOns: [
        { name: 'Phase I Proposal Build', price: '$999', description: 'Expert-guided proposal development for SBIR/STTR Phase I submissions. Includes outline, technical writing review, budget preparation, and compliance check.' },
        { name: 'Phase II Proposal Build', price: '$2,500', description: 'Comprehensive proposal support for SBIR/STTR Phase II submissions. Includes commercialization plan, technical volume review, budget narrative, and full compliance review.' },
      ],
      faqs: [
        { q: 'What do early access members get?', a: 'Up to 20 small businesses who join the waitlist will be selected for early access and personal onboarding by our founder — plus 3 months of free Pipeline Engine subscription as long as they actively use and test the system. Launching May 15, 2026.' },
        { q: 'What are the per-proposal builds?', a: 'Our Phase I ($999) and Phase II ($2,500) proposal builds pair you with SBIR/STTR experts who review, refine, and help you submit a competitive proposal. These are one-time fees per proposal.' },
        { q: 'Do you offer annual billing?', a: 'Yes — annual plans save you 20%. Contact us for a custom annual agreement.' },
        { q: 'What payment methods do you accept?', a: 'We accept all major credit cards and ACH bank transfers for annual plans. Processed securely via Stripe.' },
        { q: 'Is there a setup fee?', a: 'No setup fees, ever. Your workspace is provisioned instantly when you subscribe.' },
        { q: 'What is your track record?', a: 'Over the last decade, our founder has won dozens of Phase I, II, and III awards for his own startups and mentored hundreds of additional wins across hundreds of millions in non-dilutive funding.' },
      ],
      contactCta: {
        title: 'Need a custom solution?',
        description: 'For accelerator programs, university tech transfer offices, or large teams — let\'s talk about a tailored plan.',
        email: 'eric@rfppipeline.com',
      },
    },
    metadata: {
      title: 'Get Started | RFP Pipeline',
      description: 'Simple pricing for SBIR/STTR opportunity scanning, AI fit scoring, and expert proposal builds. Pipeline Engine at $199/mo. Phase I builds from $999. Phase II builds from $2,500.',
    },
  },

  home: {
    content: {
      hero: {
        eyebrow: 'Built for High-Tech Small Businesses & Startups',
        title: 'The First Platform Built to Win Non-Dilutive Federal Research Funding',
        description: 'RFP Pipeline is purpose-built for CEOs and lean-launch teams pursuing SBIR, STTR, Challenge, OTA, and other non-dilutive funding programs with billions in annual awards specifically for small businesses.',
        trustBadge: '$4B+ Annual SBIR/STTR Funding · 11 Federal Agencies · $199/mo Pipeline Engine',
      },
      features: [
        { icon: 'Search', title: 'Smart Opportunity Discovery', description: 'Automated scanning of SAM.gov, SBIR.gov, and agency-specific portals for SBIR/STTR topics.' },
        { icon: 'Chart', title: 'AI-Powered Scoring', description: 'Each opportunity scored against your technology focus, keywords, and agency alignment.' },
        { icon: 'Bell', title: 'Deadline Alerts', description: 'Automated notifications for approaching submission deadlines and new high-scoring matches.' },
        { icon: 'Shield', title: 'Eligibility Matching', description: 'Instant identification of SBIR/STTR topics and set-asides that match your qualifications.' },
        { icon: 'Document', title: 'Proposal Support', description: 'Expert-guided Phase I ($999) and Phase II ($2,500) proposal builds to maximize your win rate.' },
        { icon: 'Team', title: 'Multi-Tenant Workspaces', description: 'Each client gets their own secure workspace with customized technology profiles.' },
      ],
      stats: [
        { value: '$100Ms', label: 'Non-Dilutive Capital', description: 'Secured into startups advised and mentored' },
        { value: 'Dozens', label: 'Phase I, II & III Awards', description: 'Over the last decade' },
        { value: '50+', label: 'Startups Supported', description: 'Early-stage technology companies' },
        { value: '20+', label: 'Years Experience', description: 'SBIR/STTR and federal research funding' },
      ],
      howItWorks: [
        { step: '01', title: 'Define Your Technology Focus', description: 'Enter your technology keywords, target agencies, and SBIR/STTR preferences.' },
        { step: '02', title: 'Review Scored Opportunities', description: 'Every day, new SBIR, STTR, OTA, and BAA opportunities are automatically scored and ranked.' },
        { step: '03', title: 'Propose & Win', description: 'Pursue top matches with optional expert proposal support. Track your pipeline to award.' },
      ],
      partners: ['Air Force APEX', 'Parallax Advanced Research', 'Ohio State CDME', 'Converge Ventures', 'AFRL'],
      testimonial: {
        quote: 'RFP Pipeline surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match — and they were right. We won our first Phase I within 60 days.',
        company: 'Defense Technology Startup',
        result: '$150K SBIR Phase I Award',
      },
      pricingTeaser: {
        eyebrow: 'Look Only. Never Pay Until You Build.',
        title: '10 Phase I proposals for less than the price of a consultant.',
        description: 'Pipeline Engine runs 24/7 for $199/month. Phase I Build ($999) and Phase II Build ($2,500) are one-time per-proposal fees covering any SBIR or STTR agency. Launching May 15, 2026.',
        ctaText: 'View Plans & Pricing',
        ctaLink: '/get-started',
      },
      cta: {
        title: 'Stop hiring. Start winning.',
        description: 'Up to 20 small businesses who join the waitlist will be selected for early access and personal onboarding by our founder — plus 3 months of free Pipeline Engine subscription.',
        primaryLabel: 'Join the Waitlist',
        primaryHref: '/get-started',
        secondaryLabel: 'See the SBIR Engine',
        secondaryHref: '/engine',
      },
    },
    metadata: {
      title: 'RFP Pipeline | The First Platform Built to Win SBIR/STTR Awards',
      description: 'Purpose-built for high-tech small businesses and startups pursuing SBIR, STTR, OTA, and Challenge funding. $199/mo Pipeline Engine + per-proposal builds. Launching May 15, 2026.',
    },
  },
}
