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
        title: 'Built by people who know federal contracting',
        description: 'RFP Pipeline was created by a team with over two decades of experience in government contracting, SBIR/STTR programs, and technology commercialization. We built the tool we wished we had.',
      },
      mission: {
        eyebrow: 'Our Mission',
        title: 'Level the playing field for small businesses',
        paragraphs: [
          'Federal procurement is a $700B+ market, but navigating it is overwhelming. Small businesses spend countless hours searching SAM.gov, filtering through irrelevant postings, and missing deadlines on opportunities they should have won.',
          'RFP Pipeline changes that. Our AI-powered platform continuously scans federal procurement sources, scores every opportunity against your unique business profile, and delivers a prioritized pipeline so you can focus on what matters: writing winning proposals.',
        ],
      },
      features: [
        { icon: 'AI', title: 'Scoring Engine', description: 'Multi-factor relevance scoring using NAICS, keywords, set-asides, and agency history' },
        { icon: '24/7', title: 'Monitoring', description: 'Continuous scanning of SAM.gov and federal procurement sources' },
        { icon: 'SaaS', title: 'Multi-Tenant', description: 'Secure, isolated workspaces for every client organization' },
        { icon: 'Fast', title: 'Setup', description: 'Enter your profile, get scored opportunities in minutes — not weeks' },
      ],
      howItWorks: [
        { step: '01', title: 'Information Overload', description: 'Thousands of new opportunities posted daily — most irrelevant to your business.' },
        { step: '02', title: 'Missed Deadlines', description: 'Critical response windows close before you even discover the opportunity.' },
        { step: '03', title: 'Manual Searching', description: 'Hours spent on SAM.gov with clunky filters that return noisy results.' },
        { step: '04', title: 'No Prioritization', description: 'Every opportunity looks the same — no way to focus on what you can actually win.' },
        { step: '05', title: 'Fragmented Tools', description: 'Spreadsheets, email chains, and browser bookmarks instead of a real pipeline.' },
        { step: '06', title: 'Wasted Proposals', description: 'Time spent pursuing opportunities that were never a good fit to begin with.' },
      ],
    },
    metadata: {
      title: 'About RFP Pipeline | Government Opportunity Intelligence',
      description: 'Learn how RFP Pipeline helps companies discover, score, and win federal government contracts using AI-powered opportunity matching.',
    },
  },

  team: {
    content: {
      hero: {
        eyebrow: 'Our Team',
        title: 'Led by a proven federal contracting expert',
        description: 'RFP Pipeline is built on decades of hands-on experience securing federal funding, launching startups, and navigating government procurement.',
      },
      members: [
        {
          name: 'Eric Wagner',
          title: 'Founder & CEO',
          linkedIn: 'https://www.linkedin.com/in/eric-wagner-7480385/',
          bio: [
            'Eric Wagner is a C-Suite executive, inventor, entrepreneur, and investor with more than 20 years of technology commercialization experience.',
            'He is the co-founder, CSO and EVP of Business Development at Converge Technologies, and co-founder and CEO of Converge Ventures, an $11 million startup studio.',
            'Eric served as President of D&S Consultants, an aerospace and defense company with annual revenues exceeding $270 million and more than 800 employees.',
            'He is considered an expert in non-dilutive capital — his most recent cohort submitted 13 proposals and received 13 awards, a 100% success rate.',
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
        { value: '$100M+', label: 'Non-Dilutive Capital', description: 'Acquired for clients and portfolio companies' },
        { value: '13/13', label: 'SBIR/STTR Awards', description: '100% success rate in most recent cohort' },
        { value: '40+', label: 'Startups Advised', description: 'On Air Force APEX program' },
        { value: '50+', label: 'Companies Supported', description: 'Early-stage technology ventures' },
        { value: '20+', label: 'Startups Launched', description: 'From Ohio State University' },
        { value: '$270M+', label: 'Annual Revenue', description: 'Led as President of D&S Consultants' },
        { value: '800+', label: 'Employees Managed', description: 'Aerospace & defense operations' },
        { value: '$11M', label: 'Startup Studio', description: 'Converge Ventures fund' },
      ],
    },
    metadata: {
      title: 'Our Team | RFP Pipeline',
      description: 'Meet the team behind RFP Pipeline — decades of experience in federal contracting, technology commercialization, and startup support.',
    },
  },

  tips: {
    content: {
      hero: {
        eyebrow: 'Tips & Tools',
        title: 'Expert resources for federal contracting',
        description: 'Practical guidance from a team that has helped secure over $100M in non-dilutive federal funding. Updated regularly with new strategies and tools.',
      },
      tips: [
        { date: 'March 2026', category: 'SBIR/STTR', title: 'How to Write a Winning SBIR Phase I Proposal', excerpt: 'A step-by-step guide to structuring your SBIR Phase I proposal for maximum impact.' },
        { date: 'March 2026', category: 'Getting Started', title: 'SAM.gov Registration: The Complete Checklist', excerpt: 'Before you can bid on any federal contract, you need to be registered in SAM.gov.' },
        { date: 'March 2026', category: 'Strategy', title: 'Understanding Set-Aside Categories and How to Leverage Them', excerpt: 'Small business, SDVOSB, WOSB, HUBZone, and 8(a) set-asides can dramatically improve your win probability.' },
        { date: 'February 2026', category: 'Tools', title: 'Building Your Capability Statement: A Template and Guide', excerpt: 'Your capability statement is your first impression with federal buyers.' },
        { date: 'February 2026', category: 'SBIR/STTR', title: 'Non-Dilutive Capital: Why SBIR/STTR Is the Best Funding for Deep Tech', excerpt: 'For technology startups, SBIR/STTR grants offer funding without equity dilution.' },
        { date: 'February 2026', category: 'Strategy', title: 'How to Read a Federal Solicitation in 15 Minutes', excerpt: 'Learn the key sections to focus on and how to identify evaluation criteria.' },
        { date: 'January 2026', category: 'Tools', title: 'NAICS Code Selection: Getting It Right the First Time', excerpt: 'Choosing the wrong NAICS codes means missing opportunities.' },
        { date: 'January 2026', category: 'Strategy', title: 'The Art of the Sources Sought Response', excerpt: 'Sources sought notices are your chance to shape a future solicitation.' },
      ],
      tools: [
        { name: 'SBIR/STTR Eligibility Checker', description: 'Quick assessment of whether your company qualifies for SBIR/STTR programs.', status: 'Available' },
        { name: 'Capability Statement Template', description: 'Professional template following federal formatting standards.', status: 'Available' },
        { name: 'NAICS Code Lookup', description: 'Search and identify relevant NAICS codes for federal procurement matching.', status: 'Available' },
        { name: 'Proposal Cost Volume Calculator', description: 'Spreadsheet tool for building compliant cost volumes.', status: 'Coming Soon' },
        { name: 'Past Performance Tracker', description: 'Template for organizing past performance references.', status: 'Coming Soon' },
      ],
    },
    metadata: {
      title: 'Tips & Tools | RFP Pipeline',
      description: 'Expert guidance on federal contracting, SBIR/STTR programs, proposal writing, and winning government contracts.',
    },
  },

  customers: {
    content: {
      hero: {
        eyebrow: 'Customer Wins',
        title: 'Real results from real companies',
        description: 'Our clients are winning federal contracts, securing SBIR/STTR awards, and building sustainable government revenue streams.',
      },
      stats: [
        { value: '100%', label: 'Recent Win Rate', description: 'SBIR/STTR cohort' },
        { value: '85%', label: 'Time Saved', description: 'vs. manual search' },
        { value: '60 Days', label: 'Avg. First Win', description: 'From onboarding' },
        { value: '$100M+', label: 'Capital Secured', description: 'Across all clients' },
      ],
      stories: [
        { company: 'Defense Technology Startup', industry: 'Aerospace & Defense', result: 'Won first SBIR Phase I award within 60 days', quote: 'RFP Pipeline surfaced an Air Force opportunity we would have completely missed.', metrics: ['$150K SBIR Phase I', 'First federal contract', '94 relevance score'] },
        { company: 'Advanced Materials Company', industry: 'Manufacturing', result: 'Secured $1.2M in federal contracts within first year', quote: 'We used to spend 10 hours a week searching SAM.gov. Now we spend 20 minutes.', metrics: ['$1.2M total awards', '85% time saved', '6 contracts won'] },
        { company: 'Cybersecurity Firm', industry: 'Information Technology', result: 'Identified and won a sole-source opportunity through early discovery', quote: 'The deadline alert saved us. We had 5 days to respond.', metrics: ['$340K sole-source', '5-day response window', 'Ongoing IDIQ vehicle'] },
        { company: 'Environmental Services Startup', industry: 'Environmental & Energy', result: 'Built a federal pipeline from zero to 15 active pursuits', quote: 'As a small WOSB, set-aside matching is critical.', metrics: ['15 active pursuits', 'WOSB set-aside focus', '3 wins in 6 months'] },
      ],
      clientTypes: [
        { label: 'Small Businesses', desc: 'Leverage set-aside matching and SBIR/STTR expertise.', icon: '01' },
        { label: 'SBIR/STTR Applicants', desc: 'Find topics, track deadlines, and improve win rates.', icon: '02' },
        { label: 'Defense Contractors', desc: 'Monitor DoD opportunities and track contract vehicles.', icon: '03' },
        { label: 'Technology Startups', desc: 'Identify non-dilutive federal funding opportunities.', icon: '04' },
        { label: 'Accelerator Cohorts', desc: 'Batch onboarding and pipeline tracking for programs.', icon: '05' },
        { label: 'University Spinouts', desc: 'Navigate federal funding for research commercialization.', icon: '06' },
      ],
    },
    metadata: {
      title: 'Customer Wins | RFP Pipeline',
      description: 'See how companies are using RFP Pipeline to discover and win government contracts.',
    },
  },

  announcements: {
    content: {
      hero: {
        eyebrow: 'News & Announcements',
        title: "What's new at RFP Pipeline",
        description: 'Product updates, company news, and important announcements for our customers and community.',
      },
      items: [
        { date: 'March 2026', category: 'Product', title: 'RFP Pipeline Platform Launch', excerpt: 'We are excited to announce the official launch of the RFP Pipeline platform.' },
        { date: 'March 2026', category: 'Feature', title: 'AI-Powered Opportunity Scoring Now Live', excerpt: 'Our scoring engine now evaluates every opportunity against your business profile.' },
        { date: 'March 2026', category: 'Feature', title: 'Automated Deadline Alerts and Reminders', excerpt: 'Never miss a response deadline again with configurable notifications.' },
        { date: 'February 2026', category: 'Company', title: 'Eric Wagner Launches RFP Pipeline', excerpt: 'After two decades of supporting startups and federal contracting, Eric Wagner has founded RFP Pipeline.' },
        { date: 'February 2026', category: 'Partnership', title: 'Accelerator Program Integration', excerpt: 'RFP Pipeline is now available as a batch onboarding solution for accelerator programs.' },
        { date: 'January 2026', category: 'Product', title: 'Beta Testing Complete: Results Exceed Expectations', excerpt: 'Beta participants reported an average 85% reduction in opportunity search time.' },
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
        eyebrow: '14-day free trial · No credit card required',
        title: 'Choose the plan that fits your mission',
        description: 'Start with a free trial on any plan. Scale as your pipeline grows.',
      },
      tiers: [
        { name: 'Starter', price: '$49', period: 'month', description: 'Perfect for small businesses exploring federal contracting.', features: ['Up to 50 scored opportunities/month', '1 user workspace', '3 NAICS code profiles', 'Weekly email digest', 'SAM.gov opportunity scanning', 'Basic deadline alerts'], cta: 'Start Free Trial', popular: false },
        { name: 'Professional', price: '$149', period: 'month', description: 'For active bidders who need a competitive edge.', features: ['Unlimited scored opportunities', 'Up to 5 user workspaces', 'Unlimited NAICS code profiles', 'Daily email digest + real-time alerts', 'AI-powered scoring & ranking', 'Set-aside matching', 'Document management', 'Priority support'], cta: 'Start Free Trial', popular: true },
        { name: 'Enterprise', price: '$399', period: 'month', description: 'For teams and accelerators managing multiple pipelines.', features: ['Everything in Professional', 'Unlimited user workspaces', 'Multi-tenant management', 'Batch onboarding (accelerator cohorts)', 'Custom scoring profiles', 'API access', 'Dedicated account manager', 'SSO & advanced security'], cta: 'Contact Sales', popular: false },
      ],
      comparison: [
        ['Scored Opportunities', '50/mo', 'Unlimited', 'Unlimited'],
        ['User Workspaces', '1', '5', 'Unlimited'],
        ['NAICS Profiles', '3', 'Unlimited', 'Unlimited'],
        ['SAM.gov Scanning', true, true, true],
        ['AI Scoring & Ranking', false, true, true],
        ['Set-Aside Matching', false, true, true],
        ['Deadline Alerts', 'Basic', 'Real-time', 'Real-time'],
        ['Document Management', false, true, true],
        ['Multi-Tenant', false, false, true],
        ['API Access', false, false, true],
        ['Support', 'Email', 'Priority', 'Dedicated'],
      ],
      faqs: [
        { q: 'How does the free trial work?', a: 'You get 14 days of full access to your selected plan. No credit card required to start.' },
        { q: 'Can I change plans later?', a: 'Absolutely. Upgrade or downgrade at any time. Changes take effect at your next billing cycle.' },
        { q: 'Do you offer annual billing?', a: 'Yes — annual plans save you 20%. Contact us for a custom annual agreement.' },
        { q: 'What payment methods do you accept?', a: 'We accept all major credit cards and ACH bank transfers for annual plans. Processed securely via Stripe.' },
        { q: 'Is there a setup fee?', a: 'No setup fees, ever. Your workspace is provisioned instantly when you subscribe.' },
        { q: 'Do you offer discounts for startups or nonprofits?', a: 'Yes. SBIR/STTR applicants and registered nonprofits qualify for 25% off any plan.' },
      ],
      contactCta: {
        title: 'Need a custom solution?',
        description: 'For accelerator programs, government agencies, or large teams — let\'s talk about a tailored plan.',
        email: 'eric@rfppipeline.com',
      },
    },
    metadata: {
      title: 'Get Started | RFP Pipeline',
      description: 'Choose your plan and start finding federal contract opportunities today.',
    },
  },

  home: {
    content: {
      hero: {
        eyebrow: 'RFP Pipeline',
        title: 'Find and win federal contracts before your competitors',
        description: 'RFP Pipeline uses AI-powered scoring to surface the government opportunities most relevant to your business. Stop searching. Start winning.',
        trustBadge: 'Trusted by 50+ startups · $100M+ secured',
      },
      features: [
        { icon: 'Search', title: 'Smart Opportunity Discovery', description: 'Automated scanning of SAM.gov and federal procurement sources.' },
        { icon: 'Chart', title: 'AI-Powered Scoring', description: 'Each opportunity scored against your company profile, NAICS codes, and set-aside eligibility.' },
        { icon: 'Bell', title: 'Deadline Alerts', description: 'Automated notifications for approaching deadlines and new high-scoring matches.' },
        { icon: 'Shield', title: 'Set-Aside Matching', description: 'Instant identification of set-asides that match your certifications.' },
        { icon: 'Document', title: 'Document Management', description: 'Centralized storage for capability statements, past performance records, and templates.' },
        { icon: 'Team', title: 'Multi-Tenant Workspaces', description: 'Each client gets their own secure workspace with customized scoring profiles.' },
      ],
      stats: [
        { value: '$100M+', label: 'Non-Dilutive Capital', description: 'Secured for clients' },
        { value: '100%', label: 'Recent Win Rate', description: '13/13 SBIR/STTR awards' },
        { value: '50+', label: 'Startups Supported', description: 'Early-stage technology companies' },
        { value: '20+', label: 'Years Experience', description: 'Federal contracting expertise' },
      ],
      howItWorks: [
        { step: '01', title: 'Profile Your Business', description: 'Enter your NAICS codes, keywords, set-aside certifications, and target agencies.' },
        { step: '02', title: 'Review Scored Opportunities', description: 'Every day, new federal opportunities are automatically scored and ranked.' },
        { step: '03', title: 'Pursue & Win', description: 'Track your pipeline, collaborate with your team, and leverage AI insights.' },
      ],
      partners: ['Air Force APEX', 'Parallax Advanced Research', 'Ohio State CDME', 'Converge Ventures', 'AFRL'],
      testimonial: {
        quote: 'RFP Pipeline surfaced an Air Force opportunity we would have completely missed. The scoring told us it was a 94% match — and they were right. We won our first SBIR Phase I within 60 days.',
        company: 'Defense Technology Startup',
        result: '$150K SBIR Phase I Award',
      },
      pricingTeaser: {
        eyebrow: 'Simple Pricing',
        title: 'Plans that grow with your pipeline',
        description: 'Start with a free trial. Upgrade when you\'re ready. No surprises.',
        ctaText: 'View Plans & Pricing',
        ctaLink: '/get-started',
      },
      cta: {
        title: 'Ready to find your next contract?',
        description: 'Join the companies already using RFP Pipeline to discover and win government opportunities faster.',
        primaryLabel: 'Start Free Trial',
        primaryHref: '/get-started',
        secondaryLabel: 'See customer wins',
        secondaryHref: '/customers',
      },
    },
    metadata: {
      title: 'RFP Pipeline | AI-Powered Government Contract Intelligence',
      description: 'Find, score, and win federal contracts with AI-powered opportunity matching. Built for small businesses and SBIR/STTR applicants.',
    },
  },
}
