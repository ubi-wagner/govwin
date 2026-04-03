import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { CustomersPageContent } from '@/types'

const STATIC_CONTENT: CustomersPageContent = {
  hero: {
    eyebrow: 'Customer Stories',
    title: 'Built for Teams That Want to Win',
    description: 'See how small businesses are using RFP Pipeline to find and win federal R&D funding.',
  },
  stories: [
    {
      company: 'Defense Cybersecurity Startup',
      description: 'Small team, big mission — protecting DoD networks.',
      quote: 'RFP Pipeline cut our proposal time in half and helped us focus on the right opportunities.',
      result: 'Phase I Award, Phase II in progress',
    },
    {
      company: 'Biotech Diagnostics Company',
      description: 'Developing next-gen diagnostic tools for NIH.',
      quote: 'We found three NIH topics in our first week that we never would have seen manually.',
      result: '2 Phase I Awards',
    },
    {
      company: 'Advanced Manufacturing Firm',
      description: 'Bringing additive manufacturing to defense supply chains.',
      quote: 'The fit scoring saved us from wasting time on bad-fit topics. We only pursued 90%+ matches.',
      result: 'DoD Phase I + Phase II',
    },
    {
      company: 'University Spinoff AI Lab',
      description: 'Translating NSF research into commercial applications.',
      quote: 'As a STTR team, the collaboration tools were exactly what we needed.',
      result: 'NSF STTR Phase I',
    },
  ],
  caseStudy: {
    before: 'Spending 40+ hours/month searching for opportunities',
    after: 'Dashboard delivers scored matches daily',
    result: '3 awards in first year, $400K+ in non-dilutive funding',
  },
}

const STATIC_META = {
  title: 'Customer Stories | RFP Pipeline',
  description: 'See how small businesses are using RFP Pipeline to find and win federal SBIR/STTR funding. Real teams, real results.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('customers')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function CustomersPage() {
  const published = await getPageContent('customers')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden bg-white px-4 pt-20 pb-12 sm:px-6 sm:pt-28 sm:pb-16 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-brand-500/5 blur-3xl" />

        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Built for Teams That{' '}
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-emerald-500 bg-clip-text text-transparent">
              Want to Win
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* ───── Stories ───── */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Their Stories"
          title="Real teams. Real awards. Real results."
          description="These are representative stories from the types of companies using RFP Pipeline to win federal R&D funding."
        />
        <div className="mt-14 space-y-6">
          {content.stories.map((story, i) => (
            <div
              key={i}
              className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-6 transition-all duration-300 hover:shadow-card-hover hover:border-gray-300/80 md:p-8 lg:p-10"
            >
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
                {/* Left: Company info and quote */}
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900">{story.company}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-500">{story.description}</p>

                  <div className="mt-6 relative">
                    <svg className="absolute -left-1 -top-2 h-8 w-8 text-brand-100" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H14.017zM0 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H0z" />
                    </svg>
                    <blockquote className="pl-8 text-base leading-relaxed text-gray-600 italic">
                      &ldquo;{story.quote}&rdquo;
                    </blockquote>
                  </div>
                </div>

                {/* Right: Result badge */}
                <div className="flex items-center lg:w-64 lg:flex-shrink-0 lg:justify-end">
                  <div className="inline-flex items-center gap-2.5 rounded-xl bg-emerald-50 px-5 py-3 ring-1 ring-emerald-600/10">
                    <svg className="h-5 w-5 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span className="text-sm font-semibold text-emerald-800">{story.result}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───── Featured Case Study ───── */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Case Study"
          title="From searching to winning"
          description="A representative journey from one of our early adopters."
        />
        <div className="mx-auto mt-14 max-w-3xl">
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200/60 sm:grid-cols-3">
            {/* Before */}
            <div className="bg-white p-6 text-center">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Before</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{content.caseStudy.before}</p>
            </div>

            {/* After */}
            <div className="bg-white p-6 text-center">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-50">
                <svg className="h-5 w-5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                </svg>
              </div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">After</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{content.caseStudy.after}</p>
            </div>

            {/* Result */}
            <div className="bg-white p-6 text-center">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 0 1-3.77 1.522m0 0a6.003 6.003 0 0 1-3.77-1.522" />
                </svg>
              </div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Result</p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-emerald-700">{content.caseStudy.result}</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ───── CTA ───── */}
      <CtaSection
        title="Join them."
        description="Start finding and winning federal R&D funding with the platform built for small teams."
        primaryLabel="Start 14-Day Trial"
        primaryHref="/get-started"
        secondaryLabel="See Pricing"
        secondaryHref="/pricing"
      />
    </>
  )
}
