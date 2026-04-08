import Link from 'next/link';

export const metadata = {
  title: 'Get Started — RFP Pipeline',
  description:
    'Choose your plan and start winning federal contracts. Finder at $199/month, Pipeline at $499/month. 14-day free trial, no credit card required.',
};

const PLANS = [
  {
    slug: 'finder',
    name: 'Finder',
    price: 199,
    tagline: 'For firms evaluating their opportunity pipeline',
    cta: 'Start 14-day trial',
    highlighted: false,
    features: [
      'Daily ingestion from SAM.gov, SBIR.gov, Grants.gov',
      'AI-scored opportunity fit against your profile',
      'Full compliance pre-extraction on every solicitation',
      'Spotlights, pins, and pursuit tracking',
      'Unlimited seats for your tenant',
      'Email digest of high-fit matches',
    ],
  },
  {
    slug: 'pipeline',
    name: 'Pipeline',
    price: 499,
    tagline: 'For firms actively writing proposals',
    cta: 'Start 14-day trial',
    highlighted: true,
    features: [
      'Everything in Finder, plus:',
      'Proposal workspace with AI copilot drafting',
      'TipTap editor with version history',
      'Compliance matrix auto-populated from curation',
      'Partner/collaborator stage-scoped access',
      'Review cycles, color team scoring, and packaging',
      'Namespace memory across SBIR cycles',
    ],
  },
] as const;

export default function Page() {
  return (
    <div className="bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-navy-800">
            Choose your plan
          </h1>
          <p className="mt-4 text-lg text-gray-600">
            Start with a 14-day free trial on either plan. No credit card
            required. Cancel anytime.
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {PLANS.map((plan) => (
            <PlanCard key={plan.slug} plan={plan} />
          ))}
        </div>

        <div className="mt-16 max-w-2xl mx-auto text-center">
          <h2 className="font-display text-2xl font-semibold text-navy-800">
            Need something different?
          </h2>
          <p className="mt-3 text-gray-600">
            Proposal portals are $999 per Phase I and $2,500 per Phase II,
            purchased one at a time from inside the Finder. Pipeline
            subscribers get workspace access included — Finder-only
            subscribers pay per proposal.
          </p>
          <p className="mt-6 text-sm text-gray-500">
            Questions about plans or volume pricing?{' '}
            <Link
              href="/about"
              className="text-brand-700 hover:underline font-medium"
            >
              Get in touch
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

type Plan = (typeof PLANS)[number];

function PlanCard({ plan }: { plan: Plan }) {
  const cardClass = plan.highlighted
    ? 'bg-white border-2 border-brand-600 shadow-lg'
    : 'bg-white border border-gray-200';
  const buttonClass = plan.highlighted
    ? 'bg-brand-600 hover:bg-brand-700 text-white'
    : 'bg-white border border-brand-600 hover:bg-brand-50 text-brand-700';

  return (
    <div className={`relative p-8 rounded-lg ${cardClass}`}>
      {plan.highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-brand-600 text-white text-xs font-semibold rounded-full">
          MOST POPULAR
        </span>
      )}
      <h3 className="font-display text-2xl font-bold text-navy-800">
        {plan.name}
      </h3>
      <p className="mt-1 text-sm text-gray-500">{plan.tagline}</p>
      <div className="mt-6 flex items-baseline">
        <span className="text-4xl font-bold text-navy-800">${plan.price}</span>
        <span className="ml-2 text-gray-500">/month</span>
      </div>
      <ul className="mt-8 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex text-sm text-gray-700">
            <Check />
            <span className="ml-3">{feature}</span>
          </li>
        ))}
      </ul>
      <form action={`/api/stripe/checkout`} method="POST" className="mt-8">
        <input type="hidden" name="plan" value={plan.slug} />
        <button
          type="submit"
          className={`w-full py-3 px-6 rounded-lg font-semibold transition-colors ${buttonClass}`}
        >
          {plan.cta}
        </button>
      </form>
      <p className="mt-3 text-xs text-center text-gray-500">
        No credit card required • Cancel anytime
      </p>
    </div>
  );
}

function Check() {
  return (
    <svg
      className="w-5 h-5 flex-shrink-0 text-brand-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
