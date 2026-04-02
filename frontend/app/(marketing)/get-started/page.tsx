import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { GetStartedPageContent } from '@/types'
import { InteractivePricingSection } from './checkout-modal'

const STATIC_CONTENT: GetStartedPageContent = {
  hero: {
    eyebrow: 'Launching Soon \u00B7 Join the Waitlist',
    title: 'Your 24/7 SBIR/STTR lookout, plus expert proposal builds on demand',
    description: 'One simple plan for opportunity intelligence. Pay per proposal when you are ready to pursue. No long-term contracts, no hidden fees.',
  },
  tiers: [
    {
      name: 'Finder + Minder',
      price: '$199',
      period: 'month',
      description: 'Your always-on SBIR/STTR opportunity scanning and pipeline management platform.',
      features: [
        'Unlimited SBIR/STTR opportunity scanning',
        'AI-powered technology match scoring',
        'Deadline alerts and reminders',
        'Pipeline tracking and management',
        'Up to 3 SpotLight search profiles',
        'Team collaboration workspace',
        'Notification center',
        'Document storage',
      ],
      cta: 'Join Waitlist',
      popular: false,
    },
    {
      name: 'Phase I Proposal Build',
      price: '$499',
      period: 'proposal',
      description: 'Expert-reviewed template and AI-assisted workspace for your SBIR/STTR Phase I submission.',
      features: [
        'Expert-reviewed proposal template (delivered within 1 week)',
        'AI-assisted content assembly',
        'Section-by-section writing workspace',
        'Reusable content library (grows with each proposal)',
        'Partner collaboration portal',
        '72-hour cancellation window',
      ],
      cta: 'Join Waitlist',
      popular: true,
    },
    {
      name: 'Phase II Proposal Build',
      price: '$999',
      period: 'proposal',
      description: 'Full-scope proposal support for larger Phase II submissions with commercialization planning.',
      features: [
        'Everything in Phase I Build',
        'Extended template for larger proposals',
        'Phase I results integration',
        'Transition and commercialization plan framework',
        'Detailed budget template',
        'Priority template delivery',
      ],
      cta: 'Join Waitlist',
      popular: false,
    },
  ],
  comparison: [
    ['What is the cost of a missed SBIR opportunity?', 'A single Phase I award is worth $50K\u2013$275K in non-dilutive funding', '', ''],
    ['How much do consultants charge?', 'SBIR consultants typically charge $3K\u2013$10K per proposal', '', ''],
    ['How fast can you submit?', 'Expert template delivered within 1 week of purchase', '', ''],
    ['Does it get easier over time?', 'Yes \u2014 your content library grows with every proposal you build', '', ''],
  ],
  faqs: [
    { q: 'What types of opportunities do you track?', a: 'SBIR Phase I and Phase II, STTR Phase I and Phase II, Other Transaction Authorities (OTAs), Broad Agency Announcements (BAAs), and Prize Challenges across all federal agencies including DoD, NIH, NSF, DOE, NASA, and DHS.' },
    { q: 'What is included in a proposal build?', a: 'Each proposal build includes expert review of the solicitation, a custom template matched to the specific agency and program requirements, and an AI-assisted section drafting workspace that draws from your reusable content library.' },
    { q: 'How does the content library work?', a: 'Every proposal you build adds to your reusable content library. Team bios, past performance narratives, technical capabilities, and facility descriptions are stored and indexed. The AI learns your language and writing style, making each subsequent proposal faster to assemble.' },
    { q: 'Can I add research partners?', a: 'Yes. STTR requires a research institution partnership, and many SBIR proposals benefit from subcontractors. You can securely add partners with controlled access to specific proposals only — they see what you share, nothing more.' },
    { q: 'What if I want to cancel a proposal build?', a: 'You have a 72-hour cancellation window from the time of purchase. If your template has not been delivered yet, you receive a full refund. Once template delivery begins, the purchase is final.' },
    { q: 'How does pricing compare to hiring a consultant?', a: 'SBIR consultants typically charge $3,000 to $10,000 per proposal. Our Phase I builds are $499 and Phase II builds are $999. You get expert-reviewed templates plus an AI workspace that improves with every proposal you write.' },
  ],
  contactCta: {
    title: 'Need help choosing the right approach?',
    description: 'For accelerator programs, university tech transfer offices, or teams pursuing multiple SBIR/STTR topics — let\'s talk.',
    email: 'eric@rfppipeline.com',
  },
}

const STATIC_META = {
  title: 'Pricing | GovWin SBIR/STTR Intelligence',
  description: '$199/mo for SBIR/STTR opportunity scanning and matching. Add expert proposal builds for $499 (Phase I) or $999 (Phase II).',
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
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            {content.hero.title.includes('mission') ? (
              <>
                Choose the plan that fits your{' '}
                <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
                  mission
                </span>
              </>
            ) : (
              content.hero.title
            )}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* Interactive pricing section (client component: billing toggle + cards + checkout modal) */}
      <InteractivePricingSection plans={content.tiers} />

      {/* Feature comparison */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="The Math"
          title="Why this pays for itself"
        />
        <div className="mt-12 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-4 pr-4 text-sm font-bold text-gray-900 w-1/2">Question</th>
                <th className="px-4 py-4 text-sm font-bold text-gray-900" colSpan={3}>Answer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {content.comparison.map((row, i) => {
                const [question, answer] = row
                return (
                  <tr key={i} className="hover:bg-white transition-colors">
                    <td className="py-3.5 pr-4 text-sm font-medium text-gray-900">{question as string}</td>
                    <td className="px-4 py-3.5 text-sm text-gray-600" colSpan={3}>{answer as string}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* FAQ */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="FAQ"
          title="Common questions"
        />
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-gray-100">
          {content.faqs.map((faq, i) => (
            <div key={i} className="py-5">
              <h3 className="text-sm font-bold text-gray-900">{faq.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{faq.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Contact CTA */}
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
              Contact Sales
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

function renderCell(value: boolean | string | undefined) {
  if (value === true) {
    return (
      <svg className="mx-auto h-5 w-5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    )
  }
  if (value === false) {
    return <span className="text-gray-300">&mdash;</span>
  }
  return <span className="text-sm text-gray-700 font-medium">{value}</span>
}
