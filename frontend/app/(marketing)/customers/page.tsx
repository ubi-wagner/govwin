import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, StatHighlight, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { CustomersPageContent } from '@/types'

const STATIC_CONTENT: CustomersPageContent = {
  hero: {
    eyebrow: 'Proven Results',
    title: '13 for 13. $100M+ secured.',
    description: 'Our clients win SBIR and STTR awards across DoD, NIH, NSF, DOE, and NASA. Not because they are lucky — because they are prepared.',
  },
  stats: [
    { value: '13/13', label: 'Recent Win Rate', description: '100% SBIR/STTR success' },
    { value: '$100M+', label: 'Capital Secured', description: 'Non-dilutive funding' },
    { value: '50+', label: 'Startups Supported', description: 'Deep tech and defense' },
    { value: '20+', label: 'Years Experience', description: 'Federal R&D programs' },
  ],
  stories: [
    {
      company: 'Defense Technology Startup', industry: 'Aerospace & Defense',
      result: 'Won SBIR Phase I within 60 days, followed by Phase II award',
      quote: 'RFP Pipeline surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match for our sensor technology — and they were right. We won Phase I and are now in Phase II.',
      metrics: ['$150K Phase I Award', '$1M Phase II Award', 'Air Force / AFRL'],
    },
    {
      company: 'University Spinoff — Advanced Materials', industry: 'Materials Science',
      result: 'Secured 3 SBIR Phase I awards across DOE and NSF in first year',
      quote: 'As a university spinoff, we had strong research but zero proposal experience. The proposal build templates gave us a framework, and the content library meant our third proposal took half the time of our first.',
      metrics: ['3 Phase I Awards', 'DOE + NSF', '40+ reusable content sections'],
    },
    {
      company: 'Biotech Startup', industry: 'Biotech / MedTech',
      result: 'Won NIH STTR Phase I with research institution partner',
      quote: 'The partner collaboration feature made STTR manageable. Our university PI could contribute to the proposal without seeing our full pipeline. Clean separation, real collaboration.',
      metrics: ['$275K STTR Phase I', 'NIH / NIDDK', 'University partnership'],
    },
    {
      company: 'Defense Tech Company', industry: 'Cybersecurity & AI',
      result: 'Built a pipeline of 12 SBIR/STTR topics across DoD agencies',
      quote: 'We used to manually scan SBIR.gov and agency portals every week. RFP Pipeline cut our search time by 90% and surfaced topics from agencies we had never considered. Our pipeline has never been stronger.',
      metrics: ['12 active pursuits', '90% time savings', '4 agencies targeted'],
    },
  ],
  clientTypes: [
    { label: 'Deep Tech Startups', desc: 'AI, autonomy, sensors, advanced computing — find SBIR/STTR topics matched to your core technology and TRL level.', icon: '01' },
    { label: 'University Spinoffs', desc: 'Translate lab research into funded STTR proposals. Add your university PI as a partner with controlled access.', icon: '02' },
    { label: 'Defense Tech Companies', desc: 'Monitor DoD SBIR/STTR topics across AFRL, DARPA, Army, Navy, and Space Force with agency-specific scoring.', icon: '03' },
    { label: 'Biotech & MedTech Firms', desc: 'Track NIH, NSF, and HHS SBIR/STTR opportunities for therapeutics, diagnostics, and medical devices.', icon: '04' },
    { label: 'Clean Energy & Climate', desc: 'Find DOE, ARPA-E, and EPA SBIR/STTR topics for energy storage, grid tech, carbon capture, and sustainability.', icon: '05' },
    { label: 'Accelerator Programs', desc: 'Batch onboard your cohort. Give every startup a scored SBIR/STTR pipeline from day one.', icon: '06' },
  ],
}

const STATIC_META = {
  title: 'Customer Wins | RFP Pipeline — 13/13 SBIR/STTR Success Rate',
  description: '13/13 recent SBIR/STTR win rate. $100M+ in non-dilutive capital secured. See how small tech businesses are winning federal research funding with RFP Pipeline.',
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
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-600/10">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            {content.hero.title.includes('13') ? (
              <>
                <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-emerald-500 bg-clip-text text-transparent">13 for 13.</span>{' '}
                $100M+ secured.
              </>
            ) : content.hero.title}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* ───── Stats bar ───── */}
      <section className="border-y border-gray-100 bg-gray-950 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          {content.stats.map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{s.value}</p>
              <p className="mt-1 text-sm font-semibold text-gray-300">{s.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Success stories ───── */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Success Stories"
          title="Real companies. Real awards. Real results."
          description="Every story started the same way: a small team with breakthrough technology, looking for the right opportunity."
        />
        <div className="mt-14 space-y-6">
          {content.stories.map((story, i) => (
            <div key={i} className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white transition-all duration-300 hover:shadow-card-hover hover:border-gray-300/80">
              <div className="flex flex-col lg:flex-row">
                {/* Left: Quote and details */}
                <div className="flex-1 p-6 md:p-8 lg:p-10">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
                      {story.industry}
                    </span>
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-gray-900">{story.company}</h3>
                  <p className="mt-1 text-sm font-semibold text-emerald-600">{story.result}</p>

                  <div className="mt-6 relative">
                    <svg className="absolute -left-1 -top-2 h-8 w-8 text-brand-100" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H14.017zM0 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H0z" />
                    </svg>
                    <blockquote className="pl-8 text-base leading-relaxed text-gray-600 italic">
                      &ldquo;{story.quote}&rdquo;
                    </blockquote>
                  </div>
                </div>

                {/* Right: Metrics */}
                <div className="flex items-center border-t border-gray-100 bg-surface-50 p-6 md:p-8 lg:w-72 lg:flex-col lg:justify-center lg:border-l lg:border-t-0">
                  <div className="flex flex-wrap gap-2 lg:flex-col lg:gap-3 w-full">
                    {story.metrics.map((m, j) => (
                      <div key={j} className="flex items-center gap-2.5 rounded-xl bg-white px-4 py-3 shadow-sm border border-gray-100">
                        <svg className="h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        <span className="text-sm font-semibold text-gray-800">{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───── Who we serve ───── */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Who We Serve"
          title="Built for the companies changing the world"
          description="From defense AI to clean energy to biotech therapeutics — if you are innovating on technology with government applications, we built this for you."
        />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.clientTypes.map(ct => (
            <div key={ct.label} className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5 hover:border-brand-200">
              <span className="absolute right-4 top-3 text-4xl font-black text-gray-50 group-hover:text-brand-50 transition-colors duration-300">{ct.icon}</span>
              <div className="relative">
                <h3 className="text-base font-bold text-gray-900">{ct.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{ct.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───── CTA ───── */}
      <CtaSection
        title="Your technology deserves funding"
        description="Join the companies using RFP Pipeline to find and win SBIR/STTR awards. 13 for 13 — and counting."
        primaryLabel="Get Started"
        primaryHref="/get-started"
        secondaryLabel="Meet the founder"
        secondaryHref="/team"
      />
    </>
  )
}
