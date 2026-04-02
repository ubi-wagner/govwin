import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { GetStartedPageContent } from '@/types'
import { InteractivePricingSection } from './checkout-modal'

const STATIC_CONTENT: GetStartedPageContent = {
  hero: {
    eyebrow: 'Launching Soon — Join the Waitlist',
    title: '$199/mo to never miss a $150K–$1.5M opportunity',
    description: 'Your 24/7 SBIR/STTR lookout. Find every opportunity, score it against your tech, and build winning proposals — for less than a single hour of consultant time.',
  },
  tiers: [
    {
      name: 'Pipeline',
      price: '$199',
      period: 'month',
      description: 'Find, score, and track every SBIR/STTR opportunity across all 11 federal agencies. Your always-on competitive intelligence engine.',
      features: [
        'Unlimited SBIR/STTR opportunity scanning across SAM.gov, SBIR.gov, and Grants.gov',
        'AI-powered technology match scoring for every topic',
        'Deadline alerts — never miss a closing date again',
        'Pipeline tracking dashboard with stage management',
        'Up to 3 SpotLight search profiles',
        'Team collaboration workspace',
        'Document storage and organization',
        'Email and in-app notification center',
      ],
      cta: 'Join Waitlist',
      popular: false,
    },
    {
      name: 'Phase I Build',
      price: '$499',
      period: 'proposal',
      description: 'Expert template + AI workspace for Phase I submissions. Consultants charge $5K–$15K for this. You pay $499.',
      features: [
        'Expert-reviewed proposal template matched to the solicitation',
        'Template delivered within 1 week of purchase',
        'AI-assisted section-by-section writing workspace',
        'Reusable content library — grows with every proposal',
        'Partner collaboration portal for STTR teams',
        'Budget template aligned to agency requirements',
        '72-hour cancellation window with full refund',
      ],
      cta: 'Join Waitlist',
      popular: true,
    },
    {
      name: 'Phase II Build',
      price: '$999',
      period: 'proposal',
      description: 'Full proposal support for Phase II continuations. Larger scope, commercialization planning, and priority delivery.',
      features: [
        'Everything in Phase I Build',
        'Extended template for 40–100 page proposals',
        'Phase I results integration and continuation narrative',
        'Transition and commercialization plan framework',
        'Detailed budget and subcontractor template',
        'Priority template delivery (3–5 business days)',
        'Multi-volume document assembly',
      ],
      cta: 'Join Waitlist',
      popular: false,
    },
  ],
  comparison: [
    ['Hiring an SBIR consultant', '$5,000–$15,000 per proposal', 'Phase I Build with RFP Pipeline', '$499 per proposal'],
    ['Full-time BD hire', '$80,000–$120,000/year + benefits', 'Pipeline subscription', '$199/mo ($2,388/year)'],
    ['Missing one Phase I award', '$50K–$275K in lost non-dilutive funding', 'Cost of Pipeline for a full year', '$2,388'],
    ['Missing one Phase II award', '$750K–$1.5M in lost funding', 'Cost of Phase II Build', '$999'],
  ],
  faqs: [
    {
      q: 'What agencies and opportunity types do you cover?',
      a: 'We scan all 11 SBIR/STTR participating agencies: DoD (Army, Navy, Air Force, DARPA, MDA, SOCOM, DHA, CBD, DTRA, and more), NIH, NSF, DOE, NASA, DHS, USDA, DOC/NIST, DOT, EPA, ED, and SBA. We also track OTAs, BAAs, and Prize Challenges. Our data comes from three primary sources: SAM.gov, SBIR.gov, and Grants.gov.',
    },
    {
      q: 'How is a "proposal build" different from a consultant?',
      a: 'A consultant writes your proposal for you — and charges $5K–$15K to do it. A proposal build gives you the expert-reviewed template (matched to the specific solicitation and agency) plus an AI-powered workspace that helps you assemble your own proposal section by section. You retain full ownership and build institutional knowledge. Every proposal you write adds to your reusable content library, so your 5th proposal takes a fraction of the effort of your 1st.',
    },
    {
      q: 'What is included in the $199/mo Pipeline subscription?',
      a: 'Pipeline gives you unlimited opportunity scanning across all federal SBIR/STTR sources, AI-powered technology match scoring, deadline alerts, pipeline tracking, up to 3 SpotLight search profiles, team collaboration, document storage, and a notification center. It is everything you need to find and evaluate opportunities before deciding which ones to pursue.',
    },
    {
      q: 'How does the content library work?',
      a: 'Every proposal you build adds to your reusable content library. Team bios, past performance narratives, technical capabilities, and facility descriptions are stored and indexed. The AI learns your language and writing style, making each subsequent proposal faster to assemble. Your 5th proposal should take a fraction of the time your 1st one did.',
    },
    {
      q: 'Can I add research partners and subcontractors?',
      a: 'Yes. STTR requires a research institution partnership, and many SBIR proposals benefit from subcontractors. You can securely invite partners with controlled access — they see only what you share. This is especially useful for universities and labs contributing technical sections.',
    },
    {
      q: 'What if I want to cancel?',
      a: 'The Pipeline subscription can be canceled anytime — no long-term contracts, no cancellation fees. For proposal builds, you have a 72-hour cancellation window from the time of purchase. If your template has not been delivered yet, you receive a full refund.',
    },
    {
      q: 'Is there a free trial?',
      a: 'Yes. We offer a 14-day free trial of the Pipeline subscription. No credit card required to start. You get full access to opportunity scanning, match scoring, and pipeline tracking so you can see the value before committing.',
    },
    {
      q: 'Do you offer discounts for accelerators or multi-team programs?',
      a: 'Yes. We offer volume pricing for accelerator programs, university tech transfer offices, and organizations supporting multiple SBIR/STTR teams. Contact us at eric@rfppipeline.com to discuss.',
    },
  ],
  contactCta: {
    title: 'Questions? Let\'s talk.',
    description: 'For accelerator programs, university tech transfer offices, or teams pursuing multiple SBIR/STTR topics — we offer custom plans.',
    email: 'eric@rfppipeline.com',
  },
}

const STATIC_META = {
  title: 'Pricing | RFP Pipeline — SBIR/STTR Intelligence',
  description: '$199/mo for SBIR/STTR opportunity scanning and matching. Add expert proposal builds for $499 (Phase I) or $999 (Phase II). Cancel anytime. 14-day free trial.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('get_started')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function GetStartedPage() {
  const published = await getPageContent('get_started')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* Hero — Lead with value proposition */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">$199/mo</span>{' '}
            to never miss a{' '}
            <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">$150K&ndash;$1.5M</span>{' '}
            opportunity
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>

          {/* Trust badges */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              14-day free trial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              No credit card required
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Cancel anytime
            </span>
          </div>
        </div>
      </section>

      {/* Interactive pricing section (client component: billing toggle + cards + checkout modal) */}
      <InteractivePricingSection plans={content.tiers} />

      {/* ROI Comparison — "The Math" */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="The Math"
          title="Why this pays for itself on day one"
          description="Compare RFP Pipeline to the alternatives. The numbers speak for themselves."
        />

        <div className="mx-auto mt-12 max-w-4xl">
          <div className="grid gap-4 sm:grid-cols-2">
            {content.comparison.map((row, i) => {
              const [altLabel, altCost, pipelineLabel, pipelineCost] = row
              return (
                <div key={i} className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
                  {/* The expensive alternative */}
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
                      <svg className="h-3.5 w-3.5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{altLabel as string}</p>
                      <p className="text-sm text-red-600 font-semibold">{altCost as string}</p>
                    </div>
                  </div>

                  {/* The RFP Pipeline alternative */}
                  <div className="mt-4 flex items-start gap-3 rounded-xl bg-emerald-50/60 p-3 -mx-1">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                      <svg className="h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{pipelineLabel as string}</p>
                      <p className="text-sm text-emerald-700 font-semibold">{pipelineCost as string}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* What you get — detailed breakdown */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="What You Get"
          title="Everything you need to find, evaluate, and win"
        />
        <div className="mx-auto mt-14 max-w-5xl grid gap-8 lg:grid-cols-3">
          {/* Pipeline column */}
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card">
            <div className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-600">
              Pipeline — $199/mo
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">Find the right opportunities</h3>
            <p className="mt-2 text-sm text-gray-500">Stop manually searching across agency portals. We scan everything, score it, and alert you.</p>
            <ul className="mt-6 space-y-3">
              {[
                'Scans SAM.gov, SBIR.gov, and Grants.gov daily',
                'AI scores every topic against your technology',
                'Tracks all 11 SBIR/STTR agencies',
                'Deadline alerts via email and in-app',
                'Kanban pipeline for tracking pursuits',
                'SpotLight profiles for different tech areas',
                'Shared workspace for your team',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Phase I column */}
          <div className="rounded-2xl border border-brand-200 bg-white p-6 shadow-card ring-1 ring-brand-500/10">
            <div className="inline-flex items-center rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white">
              Phase I Build — $499
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">Write winning Phase I proposals</h3>
            <p className="mt-2 text-sm text-gray-500">An expert reviews the solicitation and builds you a custom template. AI helps you assemble the rest.</p>
            <ul className="mt-6 space-y-3">
              {[
                'Expert-reviewed template for the specific solicitation',
                'Template delivered within 1 week',
                'AI writing workspace for every section',
                'Content library grows with each proposal',
                'Partner portal for STTR collaborators',
                'Budget template matched to agency format',
                '72-hour cancellation with full refund',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Phase II column */}
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card">
            <div className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
              Phase II Build — $999
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">Scale to Phase II funding</h3>
            <p className="mt-2 text-sm text-gray-500">Larger proposals, commercialization plans, and priority delivery for Phase II continuations.</p>
            <ul className="mt-6 space-y-3">
              {[
                'Everything in Phase I Build',
                'Extended template for 40–100 page proposals',
                'Phase I results integration',
                'Commercialization and transition plan framework',
                'Detailed budget and subcontractor templates',
                'Priority delivery (3–5 business days)',
                'Multi-volume document assembly',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Social proof / credibility strip */}
      <section className="bg-surface-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <div className="text-center">
              <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">13/13</p>
              <p className="mt-1 text-sm font-bold text-gray-900">Win Rate</p>
              <p className="mt-0.5 text-xs text-gray-500">Recent SBIR/STTR awards</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">$100M+</p>
              <p className="mt-1 text-sm font-bold text-gray-900">Capital Secured</p>
              <p className="mt-0.5 text-xs text-gray-500">Non-dilutive funding</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">11</p>
              <p className="mt-1 text-sm font-bold text-gray-900">Federal Agencies</p>
              <p className="mt-0.5 text-xs text-gray-500">Full SBIR/STTR coverage</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">3</p>
              <p className="mt-1 text-sm font-bold text-gray-900">Data Sources</p>
              <p className="mt-0.5 text-xs text-gray-500">SAM, SBIR, Grants.gov</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="FAQ"
          title="Questions small businesses actually ask"
          description="If you don't see your question here, email us at eric@rfppipeline.com. We respond within one business day."
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
      <section className="relative overflow-hidden bg-cta-gradient px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="absolute -left-20 -top-20 h-60 w-60 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 h-60 w-60 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {content.contactCta.title}
          </h2>
          <p className="mt-4 text-lg text-gray-300">
            {content.contactCta.description}
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href={`mailto:${content.contactCta.email}`}
              className="btn-cta bg-white text-brand-700 hover:bg-gray-100 shadow-xl"
            >
              Contact Us
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </a>
            <Link href="/about" className="group text-sm font-semibold text-gray-300 hover:text-white transition-colors">
              Learn more about us
              <span className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
