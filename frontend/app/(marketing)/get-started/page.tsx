import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { GetStartedPageContent } from '@/types'
import { InteractivePricingSection } from './checkout-modal'

const STATIC_CONTENT: GetStartedPageContent = {
  hero: {
    eyebrow: 'Launching Soon · Join the Waitlist',
    title: 'Choose the plan that fits your mission',
    description: 'Preview our plans and join the waitlist to get early access when we launch.',
  },
  tiers: [
    {
      name: 'Starter',
      price: '$49',
      period: 'month',
      description: 'Perfect for small businesses exploring federal contracting.',
      features: [
        'Up to 50 scored opportunities/month',
        '1 user workspace',
        '3 NAICS code profiles',
        'Weekly email digest',
        'SAM.gov opportunity scanning',
        'Basic deadline alerts',
      ],
      cta: 'Join Waitlist',
      popular: false,
    },
    {
      name: 'Professional',
      price: '$149',
      period: 'month',
      description: 'For active bidders who need a competitive edge.',
      features: [
        'Unlimited scored opportunities',
        'Up to 5 user workspaces',
        'Unlimited NAICS code profiles',
        'Daily email digest + real-time alerts',
        'AI-powered scoring & ranking',
        'Set-aside matching',
        'Document management',
        'Priority support',
      ],
      cta: 'Join Waitlist',
      popular: true,
    },
    {
      name: 'Enterprise',
      price: '$399',
      period: 'month',
      description: 'For teams and accelerators managing multiple pipelines.',
      features: [
        'Everything in Professional',
        'Unlimited user workspaces',
        'Multi-tenant management',
        'Batch onboarding (accelerator cohorts)',
        'Custom scoring profiles',
        'API access',
        'Dedicated account manager',
        'SSO & advanced security',
      ],
      cta: 'Join Waitlist',
      popular: false,
    },
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
    { q: 'When will GovWin launch?', a: 'We are in the final stages of development and will be launching soon. Join the waitlist to be notified the moment we go live and secure early access pricing.' },
    { q: 'What do I get by joining the waitlist?', a: 'Waitlist members receive priority onboarding, special launch pricing, and early access before the platform opens to the public.' },
    { q: 'Can I change plans later?', a: 'Absolutely. Once we launch, you can upgrade or downgrade at any time. Changes take effect at your next billing cycle. No penalties or hidden fees.' },
    { q: 'Do you offer annual billing?', a: 'Yes — annual plans will save you 20%. Contact us for a custom annual agreement with additional perks.' },
    { q: 'Is there a setup fee?', a: 'No setup fees, ever. Your workspace will be provisioned instantly when you subscribe. We help you configure your scoring profile during onboarding.' },
    { q: 'Do you offer discounts for startups or nonprofits?', a: 'Yes. SBIR/STTR applicants and registered nonprofits qualify for 25% off any plan. Contact our team to apply.' },
  ],
  contactCta: {
    title: 'Need a custom solution?',
    description: 'For accelerator programs, government agencies, or large teams — let\'s talk about a tailored plan.',
    email: 'eric@rfppipeline.com',
  },
}

const STATIC_META = {
  title: 'Get Started | RFP Pipeline',
  description: 'Choose your plan and start finding federal contract opportunities today.',
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
          eyebrow="Compare Plans"
          title="Everything included at a glance"
        />
        <div className="mt-12 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-4 pr-4 text-sm font-bold text-gray-900 w-1/3">Feature</th>
                <th className="px-4 py-4 text-center text-sm font-bold text-gray-900">Starter</th>
                <th className="px-4 py-4 text-center text-sm font-bold text-brand-600">Professional</th>
                <th className="pl-4 py-4 text-center text-sm font-bold text-gray-900">Enterprise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {content.comparison.map((row, i) => {
                const [feature, starter, pro, enterprise] = row
                return (
                  <tr key={i} className="hover:bg-white transition-colors">
                    <td className="py-3.5 pr-4 text-sm text-gray-700">{feature as string}</td>
                    <td className="px-4 py-3.5 text-center">{renderCell(starter)}</td>
                    <td className="px-4 py-3.5 text-center bg-brand-50/30">{renderCell(pro)}</td>
                    <td className="pl-4 py-3.5 text-center">{renderCell(enterprise)}</td>
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
