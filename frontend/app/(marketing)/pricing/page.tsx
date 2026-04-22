import {
  Hero,
  Section,
  SectionHeader,
  PricingTier,
  CtaSection,
} from '@/components/marketing/section-layout';

export const metadata = {
  title: 'Pricing — RFP Pipeline',
  description:
    'Simple, transparent pricing. $299/month Spotlight subscription. $999 Phase I / $1,999 Phase II per-proposal portals. Cancel anytime. No free trial — serious applicants only.',
};

const subscriptionTier = {
  label: 'Monthly Subscription',
  name: 'Spotlight',
  price: '$299',
  period: '/ month',
  description: 'Your ongoing federal R&D opportunity intelligence. Required for access to Proposal Portal purchases.',
  features: [
    'Daily ingestion from SAM.gov, SBIR.gov, Grants.gov, and agency portals',
    'AI-powered ranking against your company profile and tech areas',
    'Expert-curated compliance matrix for every ingested opportunity',
    'Notifications for new matches and upcoming deadlines',
    '15 minutes of Ask-the-Expert time each month (rolls over unused)',
    'Unlimited access to your company\'s isolated AI team',
    'Cancel anytime. No annual commitment.',
  ],
  cta: { label: 'Apply for Access', href: '/apply' },
  highlighted: true,
};

const proposalTiers = [
  {
    name: 'Proposal Portal — Phase I',
    price: '$999',
    period: 'per proposal',
    description: 'Phase I-equivalent effort. Includes SBIR/STTR Phase I, smaller BAA topics, OTA/CSO short-form proposals.',
    features: [
      'Expert-reviewed compliance matrix within 72 hours',
      'Stage-gated proposal workspace (draft → review → revise → accept)',
      'Custom AI agents trained on YOUR company library',
      'Auto-drafting: technical volume, cost volume, abstract',
      'Collaborator access controls by section, role, and phase',
      'Review-revise-accept workflow with full version history',
      'Export-ready submission package (PDFs, SF-424, attachments)',
      'Post-submission debrief added to your library',
    ],
    cta: { label: 'Requires Spotlight subscription', href: '/apply' },
    highlighted: false,
  },
  {
    name: 'Proposal Portal — Phase II',
    price: '$1,999',
    period: 'per proposal',
    description: 'Phase II-equivalent effort. SBIR/STTR Phase II, larger BAA topics, OTA prototypes, complex Grants.gov NOFOs.',
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
    highlighted: false,
  },
];

const expertTier = {
  label: 'Expert Access',
  name: 'Ask the Expert',
  price: 'Included',
  period: '15 min / month',
  description: 'Direct access to Eric for strategic questions. Monthly minutes included with Spotlight and accumulate if unused.',
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
  highlighted: false,
};

export default function Page() {
  return (
    <>
      <Hero
        variant="light"
        eyebrow="Simple, Transparent Pricing"
        headline={<>One subscription. <br /><span className="text-brand-700">Per-proposal portals.</span> <br />No surprises.</>}
        subheadline="We priced for small businesses, not enterprise. Every line item is a real cost tied to real expert time and real AI compute dedicated to you."
        primaryCta={{ label: 'Apply Now', href: '/apply' }}
        secondaryCta={{ label: 'See How It Works', href: '/how-it-works' }}
        note="$299/month after acceptance. No free trial — serious applicants only. Cancel anytime."
      />

      <Section variant="white">
        <SectionHeader
          eyebrow="Required Subscription"
          title="Spotlight: the foundation of everything"
          subtitle="Every customer subscribes. Proposal Portals are only available to active Spotlight subscribers."
        />
        <div className="mt-12 max-w-md mx-auto">
          <PricingTier {...subscriptionTier} />
        </div>
      </Section>

      <Section variant="gray">
        <SectionHeader
          eyebrow="Per-Proposal Purchases"
          title="Pay per proposal. Purchase only what you pursue."
          subtitle="Proposal Portal fees are one-time per proposal. Buy a portal when you find an opportunity worth pursuing."
        />
        <div className="mt-12 grid md:grid-cols-2 gap-8">
          {proposalTiers.map((tier) => (
            <PricingTier key={tier.name} {...tier} />
          ))}
        </div>
      </Section>

      <Section variant="white">
        <SectionHeader
          eyebrow="Expert Access"
          title="Eric is available when you need him"
          subtitle="Monthly minutes included. Additional time on demand."
        />
        <div className="mt-12 max-w-md mx-auto">
          <PricingTier {...expertTier} />
        </div>
      </Section>

      <Section variant="gray">
        <SectionHeader
          title="Frequently Asked Questions"
          align="center"
        />
        <div className="mt-12 max-w-3xl mx-auto space-y-6">
          {faqs.map((faq, i) => (
            <div key={i} className="p-6 bg-white rounded-lg border border-gray-200">
              <h3 className="font-display font-semibold text-navy-800">{faq.q}</h3>
              <p className="mt-3 text-gray-600 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaSection
        eyebrow="Ready to start?"
        headline="Apply now, launch your pipeline this month"
        subheadline="Applications reviewed weekly by Eric. Accepted applicants onboard within days."
        cta={{ label: 'Apply for Founding Cohort', href: '/apply' }}
        note="Limited to 20 founding members for the initial cohort."
      />
    </>
  );
}

const faqs = [
  {
    q: 'Why no free trial?',
    a: 'Because Eric reviews every application and onboards every customer personally. Free trials attract tire-kickers who waste expert time that serious applicants need. The application itself is the qualifier — if you\'re serious about federal R&D funding, the process is short and the value is immediate upon acceptance.',
  },
  {
    q: 'Do I need Spotlight to buy a Proposal Portal?',
    a: 'Yes. Proposal Portals build on your company\'s uploaded library and your subscription-based AI team. A portal without an active Spotlight subscription wouldn\'t have the context needed to draft sections accurately.',
  },
  {
    q: 'What counts as "Phase I-equivalent" vs "Phase II-equivalent"?',
    a: 'Phase I is for shorter-form proposals (typically 10-20 pages technical volume, <$250K funding). Phase II is for longer-form proposals (20-50+ pages, $1M+ funding, commercialization plans). If you\'re unsure which tier fits your opportunity, use your monthly Ask-the-Expert time to check.',
  },
  {
    q: 'Can I upgrade a Phase I portal to Phase II?',
    a: 'Yes. If a purchased Phase I portal becomes a Phase II effort, the $1,000 difference is credited toward the upgrade. No work is lost.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'You retain read access for 30 days so you can export everything. After 30 days your data is archived, isolated, and not accessible — but also not deleted, so you can resume anytime by reactivating your subscription.',
  },
  {
    q: 'Does Eric actually review every opportunity, or is that an AI claim?',
    a: 'Eric reviews every curation decision personally. The AI does the pre-shredding and extraction work; Eric verifies and releases opportunities into your Spotlight feed. As the service scales and additional experts join, customers will know which expert reviewed their pipeline — but every review is done by a real human with real federal R&D expertise.',
  },
];
