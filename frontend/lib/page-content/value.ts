import type { SeedPage } from './types';

/** /value — the flagship "Why RFP Pipeline" arc: Pain -> Gain (cost comparison) ->
 *  Why it wins (the model) -> Flywheel -> How (condensed) -> Proof -> CTA. Mirrors
 *  the in-code defaults in app/(marketing)/value/page.tsx. The cost-comparison rows
 *  live in components/marketing/value-comparison.tsx (approved figures); the
 *  'comparison' block here only drives that section's heading. */
export const value: SeedPage = {
  pageKey: 'value',
  title: 'Why RFP Pipeline',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Why RFP Pipeline',
      title: 'The fastest, cheapest way to win *non-dilutive* federal R&D funding.',
      body: "Whether you've never heard of SBIR or you've already won three, the bottleneck is the same: finding the right opportunities and building compliant proposals without burning a month of payroll. We remove it.",
      metadata: { accent: 'award' },
    },

    { section: 'pains', displayOrder: 1, excerpt: 'New to federal R&D', title: "There's money you don't know exists.", body: 'Federal agencies award billions a year in grant-like R&D funding. It is non-dilutive — you keep your equity and your IP. Most qualifying companies never apply, because the process looks impenetrable. It is not, with the right system behind you.', metadata: {} },
    { section: 'pains', displayOrder: 2, excerpt: 'Already in the game', title: "You're bleeding time and margin.", body: 'You know the drill: a monitoring service you overpay for, a consultant who takes a cut of your award, deadlines that slip, and your best engineer pulled off the product to write proposals. There is a better stack — and it costs a fraction of what you pay now.', metadata: {} },

    {
      section: 'comparison',
      displayOrder: 3,
      excerpt: 'The cost of the old way',
      title: 'What you pay today vs. what you pay us.',
      body: 'Small businesses chase federal R&D the expensive way: a monitoring service, a consultant who takes a cut, a BD hire, or the founder’s own nights. Here’s the same job, re-priced.',
      metadata: {},
    },

    // Cost-comparison rows — the single editable source for the money moment
    // (also rendered on /pricing). title = what it replaces, excerpt = status-quo
    // cost, body = payoff; metadata = { statusQuoNote, ours }.
    { section: 'comparison-row', displayOrder: 0, title: 'Active opportunity monitoring', excerpt: '$5,000 / mo', body: 'Expert-curated monitoring for about 6% of the price — a human reads every solicitation, not just a keyword feed.', metadata: { statusQuoNote: 'what our founder paid for a monitoring service', ours: '$299 / mo' } },
    { section: 'comparison-row', displayOrder: 1, title: 'A proposal consultant', excerpt: '10% of award', body: 'Keep the $100K. Pay for the build, never a cut of your win.', metadata: { statusQuoNote: 'a $1M Phase II is $100,000 — or a heavy monthly retainer', ours: '$999 / $1,999 flat' } },
    { section: 'comparison-row', displayOrder: 2, title: 'An in-house BD hire', excerpt: '$90–150K / yr', body: 'Your business-development department, without the headcount.', metadata: { statusQuoNote: 'loaded salary, plus the months to find and ramp them', ours: '$299/mo + per-proposal' } },
    { section: 'comparison-row', displayOrder: 3, title: "Your founder's nights & weekends", excerpt: 'Your scarcest hours', body: 'Stop trading product velocity for proposal paperwork.', metadata: { statusQuoNote: 'your best engineer pulled off the product to chase RFPs', ours: 'Hours back' } },

    {
      section: 'why-header',
      displayOrder: 4,
      excerpt: 'Why it wins',
      title: 'Expert + AI + Process.',
      body: 'Not just software. Not just a consultant. A structured system where a human expert, your own isolated AI, and a stage-gated process do what neither people nor tools do alone.',
      metadata: { accent: 'brand-500' },
    },
    { section: 'drivers', displayOrder: 5, title: 'Your data. Your AI.', body: 'Every company gets isolated AI agents that see only their data. No shared context, no cross-contamination, no leakage between tenants.', metadata: { icon: 'isolation' } },
    { section: 'drivers', displayOrder: 6, title: 'The AI drafts. The expert verifies.', body: 'Every opportunity is curated by a human with 25 years of federal R&D experience. Every AI draft is marked and reviewed. Nothing unvetted reaches your submission.', metadata: { icon: 'expert' } },
    { section: 'drivers', displayOrder: 7, title: 'Stage-gated quality.', body: 'Proposals move through defined stages with compliance checks at every gate. No shortcutting the review. No submitting without verification.', metadata: { icon: 'automation' } },

    {
      section: 'flywheel-header',
      displayOrder: 8,
      excerpt: 'The compounding advantage',
      title: 'Every cycle gets *cheaper*, faster, and better.',
      metadata: { accent: 'brand-500' },
    },
    { section: 'flywheel', displayOrder: 9, title: 'Your library grows.', body: 'Every upload, every proposal section, every past-performance narrative becomes reusable material. Your AI team gets smarter with every document.', metadata: { icon: 'growth' } },
    { section: 'flywheel', displayOrder: 10, title: 'Compliance pre-fills.', body: 'Verified values from your last cycle auto-suggest for the next. Page limits, font rules, submission format — the system remembers what the expert already verified.', metadata: { icon: 'compliance' } },
    { section: 'flywheel', displayOrder: 11, title: 'Your win rate compounds.', body: 'More proposals submitted. Higher quality each time. Less time per cycle. Your cost-per-proposal drops while your pipeline scales — no BD department required.', metadata: { icon: 'trophy' } },

    { section: 'how-header', displayOrder: 12, excerpt: 'How it works', title: 'Find. Build. Submit. Improve.', metadata: {} },
    { section: 'how', displayOrder: 13, title: 'Find', body: 'Daily ingestion across SAM.gov, SBIR.gov, Grants.gov, and agency portals — expert-curated and ranked to your tech areas.', metadata: { icon: 'source-scout' } },
    { section: 'how', displayOrder: 14, title: 'Build', body: 'Buy a portal when you find a fit. Your isolated AI drafts against your library; you and your team revise in a stage-gated workspace.', metadata: { icon: 'workspace' } },
    { section: 'how', displayOrder: 15, title: 'Submit & improve', body: 'Export a compliant, submission-ready package. Every cycle feeds the next — the system gets more accurate and less expensive over time.', metadata: { icon: 'export' } },

    {
      section: 'proof',
      displayOrder: 16,
      excerpt: 'The proof',
      title: "Curated by an expert who's done it for 25 years.",
      body: 'Eric Wagner has personally secured hundreds of millions in SBIR, STTR, BAA, and OTA funding. He reviews every application and curates every opportunity in your pipeline — you always know who curated it, and why.',
      metadata: {},
    },

    {
      section: 'cta',
      displayOrder: 17,
      excerpt: 'Applications open · Founding cohort',
      title: 'Make federal R&D your next non-dilutive raise.',
      body: 'Apply to the founding cohort. Eric reviews every application within 72 hours.',
      metadata: {
        cta: { label: 'Apply to the Founding Cohort', href: '/apply' },
        secondary: { label: 'See how it works', href: '/how-it-works' },
      },
    },
  ],
};
