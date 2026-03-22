import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { AboutPageContent } from '@/types'

const STATIC_CONTENT: AboutPageContent = {
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
export const metadata: Metadata = {
  title: 'About RFP Pipeline | Government Opportunity Intelligence',
  description: 'Learn how RFP Pipeline helps companies discover, score, and win federal government contracts using AI-powered opportunity matching.',
}

const STATIC_META = {
  title: 'About RFP Pipeline | Government Opportunity Intelligence',
  description: 'Learn how RFP Pipeline helps companies discover, score, and win federal government contracts using AI-powered opportunity matching.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('about')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function AboutPage() {
  const published = await getPageContent('about')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
            About RFP Pipeline
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            {content.hero.title.includes('federal contracting') ? (
              <>
                Built by people who know{' '}
                <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
                  federal contracting
                </span>
              </>
            ) : (
              content.hero.title
            )}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-gray-600">
            {content.hero.description}
            RFP Pipeline was created by a team with over two decades of experience in government contracting,
            SBIR/STTR programs, and technology commercialization. We built the tool we wished we had.
          </p>
        </div>
      </section>

      {/* Mission */}
      <Section className="bg-surface-50">
        <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeader
              eyebrow={content.mission.eyebrow}
              title={content.mission.title}
              center={false}
            />
            {content.mission.paragraphs.map((p, i) => (
              <p key={i} className={`${i === 0 ? 'mt-6' : 'mt-4'} text-sm leading-relaxed text-gray-600`}>
                {p}
              </p>
            ))}
            <p className="mt-6 text-sm leading-relaxed text-gray-600">
              Federal procurement is a $700B+ market, but navigating it is overwhelming. Small businesses
              spend countless hours searching SAM.gov, filtering through irrelevant postings, and missing
              deadlines on opportunities they should have won.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-gray-600">
              RFP Pipeline changes that. Our AI-powered platform continuously scans federal procurement sources,
              scores every opportunity against your unique business profile, and delivers a prioritized pipeline
              so you can focus on what matters: writing winning proposals.
            </p>
            <div className="mt-8">
              <Link href="/get-started" className="btn-primary">
                Start Free Trial
                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {content.features.map(item => (
              <div key={item.icon} className="group rounded-2xl bg-white p-5 shadow-card border border-gray-200/60 transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
                <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">{item.icon}</p>
                <p className="mt-2 text-sm font-bold text-gray-900">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* What we solve */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="The Problem We Solve"
          title="Federal contracting is broken for small businesses"
        />
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200/60 sm:grid-cols-2 lg:grid-cols-3">
          {content.howItWorks.map(item => (
            <div key={item.step} className="relative bg-white p-6 group hover:bg-brand-50/30 transition-colors">
              <span className="absolute right-4 top-4 text-3xl font-black text-gray-100 group-hover:text-brand-100 transition-colors">{item.step}</span>
              <h3 className="text-sm font-bold text-gray-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{item.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Contact / Get Started */}
      <Section className="bg-surface-50" id="contact">
        <SectionHeader
          eyebrow="Get Started"
          title="Ready to transform your federal pipeline?"
          description="Contact us for a demo or to learn more about how RFP Pipeline can help your business win government contracts."
        />
        <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-gray-200/80 bg-white p-8 shadow-card">
          <div className="space-y-5 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
              <svg className="h-7 w-7 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">
              Reach out to discuss your needs and get set up with a personalized workspace.
            </p>
            <a
              href="mailto:eric@rfppipeline.com"
              className="block rounded-xl bg-brand-50 px-4 py-3.5 text-sm font-bold text-brand-700 hover:bg-brand-100 transition-all ring-1 ring-brand-600/10"
            >
              eric@rfppipeline.com
            </a>
            <p className="text-xs text-gray-400">
              We typically respond within one business day.
            </p>
          </div>
        </div>
      </Section>

      <CtaSection
        title="Start winning government contracts today"
        description="Join companies already using RFP Pipeline to find their next federal opportunity."
        primaryLabel="View Pricing"
        primaryHref="/get-started"
        secondaryLabel="Meet the founder"
        secondaryHref="/team"
      />
    </>
  )
}
