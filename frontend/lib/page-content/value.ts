import type { SeedPage } from './types';

/** /value — hero + three numbered value sections + the flywheel. Accent: hero "better" = brand-500, flywheel-header "more" = citrus. */
export const value: SeedPage = {
  pageKey: 'value',
  title: 'Value',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'The Value Loop',
      title: 'The more you use it, the *better* it gets.',
      body: 'Every verified compliance value, every submitted proposal, every expert decision makes the next cycle cheaper, faster, and more accurate for your company.',
      metadata: { accent: 'brand-500' },
    },
    {
      section: 'spotlight',
      displayOrder: 1,
      title: 'Spotlight',
      body: 'Never miss a relevant opportunity again. We ingest SAM.gov, SBIR.gov, Grants.gov, and agency-specific portals daily. Expert-curated compliance matrices are built for every ingested solicitation. Opportunities ranked to your tech areas surface at the top. Deadline reminders keep you on track. 15 minutes of Ask-the-Expert every month.',
      excerpt: 'Low-cost entry. High-value signal. The foundation that makes everything else work.',
      metadata: { price_label: '$299/mo · Cancel Anytime' },
    },
    {
      section: 'portals',
      displayOrder: 2,
      title: 'Proposal Portals',
      body: 'When you see something worth pursuing, buy a portal. Eric builds the compliance matrix within 72 hours. Your custom AI team drafts the technical volume, cost volume, and abstract against your uploaded library. Stage-gated workflow: draft, review, revise, accept. Collaborators assigned by section, document, and phase.',
      excerpt: 'Pay per pursuit. Only when you\'re serious. No annual commitment beyond Spotlight.',
      metadata: { price_label: '$999 Phase I · $1,999 Phase II' },
    },
    {
      section: 'curation',
      displayOrder: 3,
      title: 'Expert Curation',
      body: 'Every solicitation released into your Spotlight has been reviewed by a human with real federal R&D experience. Every compliance matrix is verified against the source document. Every portal is built by an expert who knows the difference between a winning Phase I and a waste of your team\'s month.',
      excerpt: 'The AI drafts. The expert verifies. No unvetted AI output reaches your submission.',
      metadata: { sla_label: '72-hour SLA' },
    },
    {
      section: 'flywheel-header',
      displayOrder: 4,
      excerpt: 'The Flywheel',
      title: 'Use it. Win. Use it *more*.',
      metadata: { accent: 'citrus', cta: { href: '/apply', label: 'Start the Flywheel' } },
    },
    {
      section: 'flywheel',
      displayOrder: 5,
      title: 'Your library grows.',
      body: 'Every upload, every proposal section, every past-performance narrative becomes reusable material for future proposals. Your AI team gets smarter with every document.',
      metadata: {},
    },
    {
      section: 'flywheel',
      displayOrder: 6,
      title: 'Compliance pre-fills.',
      body: 'Verified values from your last DoD SBIR cycle auto-suggest for the next one. Page limits, font rules, submission format — the system remembers what the expert already verified.',
      metadata: {},
    },
    {
      section: 'flywheel',
      displayOrder: 7,
      title: 'Your win rate compounds.',
      body: 'More proposals submitted. Higher quality per submission. Less time per cycle. Your cost-per-proposal drops. Your BD pipeline scales without hiring a BD department.',
      metadata: {},
    },
  ],
};
