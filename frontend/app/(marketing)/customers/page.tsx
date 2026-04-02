import type { Metadata } from 'next'
import { Section, SectionHeader, StatHighlight, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { CustomersPageContent } from '@/types'

const STATIC_CONTENT: CustomersPageContent = {
  hero: {
    eyebrow: 'SBIR/STTR Wins',
    title: '13 for 13. $100M+ secured.',
    description: 'Our clients are winning SBIR and STTR awards across DoD, NIH, NSF, DOE, and NASA. Here is what that looks like in practice.',
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
      quote: 'GovWin surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match for our sensor technology — and they were right. We won Phase I and are now in Phase II.',
      metrics: ['$150K Phase I Award', '$1M Phase II Award', 'Air Force / AFRL'],
    },
    {
      company: 'University Spinoff — Advanced Materials', industry: 'Materials Science',
      result: 'Secured 3 SBIR Phase I awards across DOE and NSF in first year',
      quote: 'As a university spinoff, we had strong research but zero proposal experience. The proposal build templates gave us a framework, and the content library meant our third proposal took half the time of our first.',
      metrics: ['3 Phase I Awards', 'DOE + NSF', 'Content library: 40+ reusable sections'],
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
      quote: 'We used to manually scan SBIR.gov and agency portals. GovWin cut our search time by 90% and surfaced topics from agencies we had never considered. Our pipeline has never been stronger.',
      metrics: ['12 active SBIR/STTR pursuits', '90% search time reduction', '4 agencies targeted'],
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
  title: 'SBIR/STTR Wins | GovWin',
  description: '13/13 recent SBIR/STTR win rate. $100M+ in non-dilutive capital secured. See how small tech businesses are winning federal research funding with GovWin.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('customers')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}
const successStories = [
  {
    company: 'Defense Technology Startup',
    industry: 'Aerospace & Defense',
    result: 'Won SBIR Phase I within 60 days, followed by Phase II award',
    quote: 'GovWin surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match for our sensor technology — and they were right.',
    metrics: ['$150K Phase I Award', '$1M Phase II Award', 'Air Force / AFRL'],
  },
  {
    company: 'University Spinoff — Advanced Materials',
    industry: 'Materials Science',
    result: 'Secured 3 SBIR Phase I awards across DOE and NSF in first year',
    quote: 'As a university spinoff, we had strong research but zero proposal experience. The proposal build templates gave us a framework that worked.',
    metrics: ['3 Phase I Awards', 'DOE + NSF', 'Content library: 40+ reusable sections'],
  },
  {
    company: 'Biotech Startup',
    industry: 'Biotech / MedTech',
    result: 'Won NIH STTR Phase I with research institution partner',
    quote: 'The partner collaboration feature made STTR manageable. Our university PI could contribute to the proposal without seeing our full pipeline.',
    metrics: ['$275K STTR Phase I', 'NIH / NIDDK', 'University partnership'],
  },
  {
    company: 'Defense Tech Company',
    industry: 'Cybersecurity & AI',
    result: 'Built a pipeline of 12 SBIR/STTR topics across DoD agencies',
    quote: 'We used to manually scan SBIR.gov and agency portals. GovWin cut our search time by 90% and surfaced topics from agencies we had never considered.',
    metrics: ['12 active SBIR/STTR pursuits', '90% search time reduction', '4 agencies targeted'],
  },
]

export default async function CustomersPage() {
  const published = await getPageContent('customers')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <SectionHeader
          eyebrow={content.hero.eyebrow}
          title={content.hero.title}
          description={content.hero.description}
        />
      </section>

      {/* Stats */}
      <section className="border-y border-gray-100 bg-white px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          {content.stats.map((s, i) => (
            <StatHighlight key={i} value={s.value} label={s.label} description={s.description} />
          ))}
        </div>
      </section>

      {/* Success stories */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Success Stories"
          title="How our clients are winning"
        />
        <div className="mt-14 space-y-5">
          {content.stories.map((story, i) => (
            <div key={i} className="group rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover md:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
                <div className="flex-1">
                  <span className="badge-blue">{story.industry}</span>
                  <h3 className="mt-3 text-lg font-bold text-gray-900">{story.company}</h3>
                  <p className="mt-1 text-sm font-semibold text-brand-600">{story.result}</p>
                  <blockquote className="mt-4 border-l-2 border-brand-200 pl-4 text-sm italic leading-relaxed text-gray-500">
                    &ldquo;{story.quote}&rdquo;
                  </blockquote>
                </div>
                <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
                  {story.metrics.map((m, j) => (
                    <span key={j} className="rounded-xl bg-surface-50 px-3.5 py-2 text-xs font-bold text-gray-700 border border-gray-100">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Who we serve */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Who We Serve"
          title="Built for companies pursuing federal contracts"
        />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.clientTypes.map(ct => (
            <div key={ct.label} className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
              <span className="absolute right-4 top-3 text-3xl font-black text-gray-50 group-hover:text-brand-50 transition-colors">{ct.icon}</span>
              <h3 className="text-sm font-bold text-gray-900">{ct.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{ct.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaSection
        title="Ready to win your next SBIR?"
        description="Join the companies using GovWin to find and win SBIR/STTR awards faster."
        primaryLabel="Join the Waitlist"
        primaryHref="/get-started"
        secondaryLabel="Meet the founder"
        secondaryHref="/team"
      />
    </>
  )
}
