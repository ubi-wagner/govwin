import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { GetStartedPageContent } from '@/types'
// Keep import to avoid breaking the existing checkout modal code
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { InteractivePricingSection } from './checkout-modal'

const STATIC_CONTENT: GetStartedPageContent = {
  hero: {
    eyebrow: 'Pricing & Packages',
    title: 'Simple Pricing. Massive Upside.',
    description: 'One platform. Clear pricing. No surprises.',
  },
  tiers: [
    {
      name: 'Pipeline Engine',
      price: '$199',
      period: 'month',
      description: 'Includes 14-day trial',
      features: [
        'Unlimited opportunity scanning',
        'AI fit scoring',
        'Deadline alerts',
        'Pipeline tracking',
        'Up to 3 SpotLight profiles',
        'Team workspace',
        'Document storage',
        'Notifications',
      ],
      cta: 'Start 14-Day Trial',
      popular: false,
    },
    {
      name: 'Phase I Build',
      price: '$999',
      period: 'proposal',
      description: 'Per proposal',
      features: [
        'Expert-reviewed framework',
        'Agency-aligned template',
        'Section-by-section structure',
        'AI-assisted drafting',
        'Content library seeding',
      ],
      cta: 'Get Started',
      popular: true,
    },
    {
      name: 'Phase II Build',
      price: '$2,500',
      period: 'proposal',
      description: 'Per proposal',
      features: [
        'Everything in Phase I Build',
        'Extended technical volume',
        'Commercialization plan',
        'Budget justification',
        'Past performance narrative',
      ],
      cta: 'Get Started',
      popular: false,
    },
  ],
  comparison: [
    ['$999', 'Phase I Build', '$150K+', 'Potential Phase I award'],
    ['$2,500', 'Phase II Build', '$1M+', 'Potential Phase II award'],
  ],
  faqs: [
    {
      q: 'What\'s included in the 14-day trial?',
      a: 'Full access to the Pipeline Engine. No credit card required.',
    },
    {
      q: 'How is a build different from a consultant?',
      a: 'Consultants charge $5K-$15K per proposal. A build gives you expert-reviewed, AI-assembled frameworks for a fraction of the cost.',
    },
    {
      q: 'What agencies do you cover?',
      a: 'All 11 SBIR/STTR participating agencies including DoD, NIH, NSF, DOE, NASA, DHS, USDA, DOT, EPA, DoC, and ED.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Yes. No contracts. No lock-in.',
    },
    {
      q: 'Do you offer volume discounts?',
      a: 'Yes. Contact us for multi-proposal pricing.',
    },
    {
      q: 'Is there an annual plan?',
      a: 'Coming soon. Early adopters lock in the best rate.',
    },
    {
      q: 'What\'s a SpotLight profile?',
      a: 'A saved search that continuously matches new opportunities to your technology focus areas.',
    },
    {
      q: 'How fast is a proposal build?',
      a: 'Most Phase I builds are delivered within 5-7 business days.',
    },
  ],
  contactCta: {
    title: 'Start Your SBIR Pipeline Today',
    description: 'Find opportunities, build proposals, and win awards with the platform built for SBIR/STTR teams.',
    email: 'eric@rfppipeline.com',
  },
}

const STATIC_META = {
  title: 'Pricing | RFP Pipeline',
  description: 'Simple pricing for SBIR/STTR opportunity scanning, AI fit scoring, and expert proposal builds. Pipeline Engine at $199/mo. Phase I builds from $999. Phase II builds from $2,500.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('get_started')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

/** Checkmark icon used across pricing cards */
function Check() {
  return (
    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

export default async function GetStartedPage() {
  const published = await getPageContent('get_started')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            {content.hero.title}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <Section className="bg-surface-50">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 lg:grid-cols-3">
            {content.tiers.map((tier) => {
              const isPopular = tier.popular
              return (
                <div
                  key={tier.name}
                  className={`relative flex flex-col rounded-2xl border bg-white p-8 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5 ${
                    isPopular
                      ? 'border-brand-500 ring-2 ring-brand-500/20'
                      : 'border-gray-200/80'
                  }`}
                >
                  {/* Popular badge */}
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <span className="inline-flex items-center rounded-full bg-brand-600 px-4 py-1 text-xs font-bold text-white shadow-sm">
                        Popular
                      </span>
                    </div>
                  )}

                  {/* Tier header */}
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{tier.name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold tracking-tight text-gray-900">
                        {tier.price}
                      </span>
                      <span className="text-sm font-medium text-gray-500">
                        /{tier.period}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">{tier.description}</p>
                  </div>

                  {/* Features */}
                  <ul className="mt-8 flex-1 space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-600">
                        <Check />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <div className="mt-8">
                    <Link
                      href="/get-started"
                      className={`block w-full rounded-lg px-4 py-3 text-center text-sm font-bold transition-colors ${
                        isPopular
                          ? 'bg-brand-600 text-white hover:bg-brand-700 shadow-md'
                          : 'bg-gray-900 text-white hover:bg-gray-800'
                      }`}
                    >
                      {tier.cta}
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ROI Section */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="The ROI"
          title="Small investment. Outsized returns."
          description="See what your proposal investment can unlock in non-dilutive funding."
        />
        <div className="mx-auto mt-12 max-w-3xl grid gap-8 sm:grid-cols-2">
          {/* Phase I ROI card */}
          <div className="rounded-2xl border border-gray-200/80 bg-gradient-to-br from-brand-50 to-white p-8 shadow-card">
            <div className="text-center">
              <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Phase I Build</p>
              <div className="mt-4 flex items-center justify-center gap-4">
                <div>
                  <p className="text-3xl font-extrabold text-gray-900">$999</p>
                  <p className="mt-1 text-xs text-gray-500">Your investment</p>
                </div>
                <svg className="h-6 w-6 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
                <div>
                  <p className="text-3xl font-extrabold bg-gradient-to-r from-emerald-600 to-emerald-500 bg-clip-text text-transparent">$150K+</p>
                  <p className="mt-1 text-xs text-gray-500">Potential award</p>
                </div>
              </div>
              <div className="mt-6 rounded-lg bg-emerald-50 px-4 py-2">
                <p className="text-sm font-bold text-emerald-700">150x potential return</p>
              </div>
            </div>
          </div>

          {/* Phase II ROI card */}
          <div className="rounded-2xl border border-gray-200/80 bg-gradient-to-br from-cyan-50 to-white p-8 shadow-card">
            <div className="text-center">
              <p className="text-sm font-bold uppercase tracking-wider text-cyan-600">Phase II Build</p>
              <div className="mt-4 flex items-center justify-center gap-4">
                <div>
                  <p className="text-3xl font-extrabold text-gray-900">$2,500</p>
                  <p className="mt-1 text-xs text-gray-500">Your investment</p>
                </div>
                <svg className="h-6 w-6 text-cyan-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
                <div>
                  <p className="text-3xl font-extrabold bg-gradient-to-r from-emerald-600 to-emerald-500 bg-clip-text text-transparent">$1M+</p>
                  <p className="mt-1 text-xs text-gray-500">Potential award</p>
                </div>
              </div>
              <div className="mt-6 rounded-lg bg-emerald-50 px-4 py-2">
                <p className="text-sm font-bold text-emerald-700">400x potential return</p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* FAQ */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="FAQ"
          title="Common questions"
        />
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-gray-100">
          {content.faqs.map((faq, i) => (
            <div key={i} className="py-6">
              <h3 className="text-sm font-bold text-gray-900">{faq.q}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-gray-500">{faq.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Bottom CTA */}
      <CtaSection
        title="Start Your SBIR Pipeline Today"
        description="Find opportunities, build proposals, and win awards with the platform built for SBIR/STTR teams."
        primaryLabel="Start 14-Day Trial"
        primaryHref="/get-started"
        secondaryLabel="Talk to Us"
        secondaryHref="/about"
      />
    </>
  )
}
