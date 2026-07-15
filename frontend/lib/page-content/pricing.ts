import type { SeedPage } from './types';

/**
 * /pricing — hero + Spotlight subscription tier + two proposal-portal tiers +
 * two expert-access tiers + FAQ + closing CTA.
 *
 * Block fields mirror exactly what app/(marketing)/pricing/page.tsx reads, and
 * every value here is the verbatim in-code default the page falls back to, so
 * seeding this page leaves the public render unchanged. The hero headline keeps
 * its in-page ReactNode default (a plain `text-brand-700` span + `<br/>`s, which
 * is not a RichText accent), so the editable title is stored here as plain text.
 *
 * Pricing tiers are one block per tier (same `section`): `name` = title,
 * `description` = body, and price/period/label/highlighted/features[]/cta live
 * in metadata exactly as <PricingTier> reads them. SectionHeader blocks carry
 * eyebrow (= excerpt), title, and subtitle (= metadata.subtitle).
 */
export const pricing: SeedPage = {
  pageKey: 'pricing',
  title: 'Pricing',
  blocks: [
    // Hero. headline accepts ReactNode; \n = line break, *accent* = plain brand-700.
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Simple, Transparent Pricing',
      title: 'One subscription.\n*Per-proposal portals.*\nNo surprises.',
      body: 'We priced for small businesses, not enterprise. Every line item is a real cost tied to real expert time and real AI compute dedicated to you.',
      metadata: {
        primary_cta: { label: 'Apply Now', href: '/apply' },
        secondary_cta: { label: 'See How It Works', href: '/how-it-works' },
        note: '$499/month, 3-month minimum, then month-to-month. No free trial — serious applicants only, no tire-kickers.',
      },
    },

    // Required Subscription section heading.
    {
      section: 'subscription-header',
      displayOrder: 1,
      excerpt: 'Start with Spotlight',
      title: 'Spotlight: the foundation of everything',
      metadata: { subtitle: 'Spotlight is your daily federal R&D intelligence feed. Proposal Portals build on it — so they\'re available to active Spotlight subscribers.' },
    },

    // Spotlight subscription tier.
    {
      section: 'subscription',
      displayOrder: 2,
      title: 'Spotlight',
      body: 'Your ongoing federal R&D opportunity intelligence. Required for access to Proposal Portal purchases.',
      metadata: {
        label: 'Monthly Subscription',
        price: '$499',
        period: '/ month',
        highlighted: true,
        features: [
          'Daily ingestion from SAM.gov, SBIR.gov, Grants.gov, and agency portals',
          'AI-powered ranking against your company profile and tech areas',
          'Expert-curated compliance matrix for every ingested opportunity',
          'Notifications for new matches and upcoming deadlines',
          '15 minutes of Ask-the-Expert time each month (rolls over unused)',
          'Unlimited access to your company\'s isolated AI team',
          '3-month minimum, then cancel anytime. No annual commitment.',
        ],
        cta: { label: 'Apply for Access', href: '/apply' },
      },
    },

    // Per-Proposal Purchases section heading.
    {
      section: 'proposals-header',
      displayOrder: 3,
      excerpt: 'Per-Proposal Purchases',
      title: 'Pay per proposal. Purchase only what you pursue.',
      metadata: { subtitle: 'Proposal Portal fees are one-time per proposal. Buy a portal when you find an opportunity worth pursuing.' },
    },

    // Proposal-portal tiers (2).
    {
      section: 'proposals',
      displayOrder: 4,
      title: 'Proposal Portal — Phase I',
      body: 'Phase I-equivalent effort. Includes SBIR/STTR Phase I, smaller BAA topics, OTA/CSO short-form proposals.',
      metadata: {
        price: '$1,999',
        period: 'per proposal',
        highlighted: false,
        features: [
          'Expert-reviewed compliance matrix within 72 hours',
          'Stage-gated proposal workspace (draft, review, revise, accept)',
          'Custom AI agents trained on YOUR company library',
          'Auto-drafting: technical volume, cost volume, abstract',
          'Collaborator access controls by section, role, and phase',
          'Review-revise-accept workflow with full version history',
          'Export-ready submission package (PDFs, SF-424, attachments)',
          'Post-submission debrief added to your library',
        ],
        cta: { label: 'Requires Spotlight subscription', href: '/apply' },
      },
    },
    {
      section: 'proposals',
      displayOrder: 5,
      title: 'Proposal Portal — Phase II',
      body: 'An exponentially bigger proposal — SBIR/STTR Phase II, larger BAA topics, OTA prototypes, complex Grants.gov NOFOs. $4,999, or $3,999 when you already have a linked Phase I in your library.',
      metadata: {
        price: '$4,999',
        period: 'per proposal',
        highlighted: false,
        features: [
          'Everything in Phase I tier',
          'Extended compliance matrix for longer-form proposals',
          'Larger page-limit technical volumes (20-50+ pages)',
          'Commercialization plan auto-drafting with market analysis',
          'Subcontractor coordination across multiple collaborators',
          'Progress milestone planning with cost-basis breakdown',
          'Multi-round review with pink/red/gold team stages',
          'Extended post-submission analytics',
        ],
        cta: { label: 'Requires Spotlight subscription', href: '/apply' },
      },
    },

    // Expert Access section heading.
    {
      section: 'expert-header',
      displayOrder: 6,
      excerpt: 'Expert Access',
      title: 'Eric is available when you need him',
      metadata: { subtitle: 'The expert who commands $500/hour reviews your pipeline as part of your $499/mo. Monthly minutes included; additional time on demand.' },
    },

    // Expert-access tiers (2): Ask the Expert + Expert Consulting.
    {
      section: 'expert',
      displayOrder: 7,
      title: 'Ask the Expert',
      body: 'Direct access to Eric for strategic questions. Monthly minutes included with Spotlight and accumulate if unused.',
      metadata: {
        label: 'Expert Access',
        price: 'Included',
        period: '15 min / month',
        highlighted: false,
        features: [
          '15 minutes every month included with Spotlight',
          'Unused minutes roll over (no expiration within subscription)',
          'Pre-submission strategy calls',
          'Pursuit / no-pursuit recommendations with rationale',
          'Agency-specific guidance (DoD, NSF, DOE, DARPA, DOT)',
          'Additional time available at $500/hour based on availability',
          'Scheduled via your dashboard after acceptance',
        ],
        cta: { label: 'Included with Spotlight', href: '/apply' },
      },
    },
    {
      section: 'expert',
      displayOrder: 8,
      title: 'Expert Consulting',
      body: 'Deep-dive strategy sessions with Eric. Pre-paid in 1-hour increments, up to 10 hours per purchase. For teams that need more than the included monthly minutes.',
      metadata: {
        label: 'Pre-Paid Consulting',
        price: '$500',
        period: '/ hour',
        highlighted: false,
        features: [
          'Pursuit / no-pursuit deep analysis',
          'Competitive positioning strategy',
          'Agency-specific capture planning',
          'Pre-submission red team review',
          'Proposal architecture and outlining',
          'Post-debrief win/loss analysis',
          'Purchase 1–10 hours per transaction',
        ],
        cta: { label: 'Purchase Hours', href: '/apply' },
      },
    },

    // FAQ section heading (title only, centered).
    {
      section: 'faq-header',
      displayOrder: 9,
      title: 'Frequently Asked Questions',
    },

    // FAQ items. title = question (q), body = answer (a).
    {
      section: 'faqs',
      displayOrder: 10,
      title: 'Why no free trial?',
      body: 'Because Eric reviews every application and onboards every customer personally. Free trials attract tire-kickers who waste expert time that serious applicants need. The application itself is the qualifier — if you\'re serious about federal R&D funding, the process is short and the value is immediate upon acceptance.',
    },
    {
      section: 'faqs',
      displayOrder: 11,
      title: 'Do I need Spotlight to buy a Proposal Portal?',
      body: 'Yes. Proposal Portals build on your company\'s uploaded library and your subscription-based AI team. A portal without an active Spotlight subscription wouldn\'t have the context needed to draft sections accurately.',
    },
    {
      section: 'faqs',
      displayOrder: 12,
      title: 'What counts as "Phase I-equivalent" vs "Phase II-equivalent"?',
      body: 'Phase I is for shorter-form proposals (typically 10-20 pages technical volume, <$250K funding). Phase II is for longer-form proposals (20-50+ pages, $1M+ funding, commercialization plans). If you\'re unsure which tier fits your opportunity, use your monthly Ask-the-Expert time to check.',
    },
    {
      section: 'faqs',
      displayOrder: 13,
      title: 'Why is Phase II $4,999 (or $3,999 with a linked Phase I)?',
      body: 'A Phase II proposal is an exponentially bigger effort than Phase I — 20–50+ page technical volumes, a full commercialization plan, subcontractor coordination, and multi-round (pink/red/gold team) reviews, often for $1M+ in funding. We price the portal to the work we do, not to your award size. Phase I and Phase II are each purchased per proposal — and when you already have a linked Phase I with us, your Phase II is $3,999 instead of $4,999 because we reuse that prior work. Never a success fee taking a cut of your win.',
    },
    {
      section: 'faqs',
      displayOrder: 14,
      title: 'What happens to my data if I cancel?',
      body: 'You retain read access for 30 days so you can export everything. After 30 days your data is archived, isolated, and not accessible — but also not deleted, so you can resume anytime by reactivating your subscription.',
    },
    {
      section: 'faqs',
      displayOrder: 15,
      title: 'Does Eric actually review every opportunity, or is that an AI claim?',
      body: 'Eric reviews every curation decision personally. The AI does the pre-shredding and extraction work; Eric verifies and releases opportunities into your Spotlight feed. As the service scales and additional experts join, customers will know which expert reviewed their pipeline — but every review is done by a real human with real federal R&D expertise.',
    },

    // Closing CTA.
    {
      section: 'cta',
      displayOrder: 16,
      excerpt: 'Ready to start?',
      title: 'Apply now, launch your pipeline this month',
      body: 'Applications reviewed weekly by Eric. Accepted applicants onboard within days.',
      metadata: {
        cta: { label: 'Apply for Founding Cohort', href: '/apply' },
        note: 'Limited to 20 founding members for the initial cohort.',
      },
    },
  ],
};
