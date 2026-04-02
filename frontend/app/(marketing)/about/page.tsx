import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { AboutPageContent } from '@/types'

const STATIC_CONTENT: AboutPageContent = {
  hero: {
    eyebrow: 'Our Mission',
    title: 'Leveling the playing field for small business innovators',
    description: 'The federal government spends $4B+ annually on small business R&D through SBIR and STTR programs. But the companies with the best technology often lose — not because their ideas are weak, but because they cannot navigate the process. We are here to change that.',
  },
  mission: {
    eyebrow: 'Why We Built This',
    title: 'Brilliant companies were losing. We had to fix it.',
    paragraphs: [
      'After helping 50+ small businesses win over $100M in non-dilutive SBIR/STTR funding, a pattern became painfully clear: the companies with the most innovative technology were often the ones struggling the most. They were finding opportunities too late, spending weeks formatting proposals instead of describing their science, and paying consultants $10K per submission because no affordable alternative existed.',
      'Meanwhile, the companies that won consistently were not always the most innovative — they were the most organized. They had systems, templates, and institutional knowledge. RFP Pipeline exists to give every small business that same advantage.',
      'We built the platform we wished existed: an AI-powered system that scans every SBIR/STTR solicitation across all federal agencies, scores each topic against your technology, delivers expert-reviewed proposal templates, and builds a reusable content library that makes every proposal faster than the last. Your 5th proposal should take a fraction of the effort of your 1st.',
    ],
  },
  features: [
    { icon: '13/13', title: 'Win Rate', description: '100% recent SBIR/STTR success rate across Phase I and Phase II awards — spanning DoD, NIH, NSF, DOE, and NASA' },
    { icon: '$100M+', title: 'Capital Secured', description: 'Non-dilutive funding secured for clients through SBIR, STTR, OTAs, BAAs, and related federal R&D programs' },
    { icon: '50+', title: 'Companies Served', description: 'Deep tech, defense, biotech, AI/ML, advanced manufacturing, and university spinoff companies supported' },
    { icon: '20+', title: 'Years Experience', description: 'Federal R&D funding strategy, SBIR/STTR proposal development, and technology commercialization' },
  ],
  howItWorks: [
    { step: '01', title: 'Scattered Sources', description: 'SBIR/STTR opportunities are spread across SAM.gov, SBIR.gov, Grants.gov, and dozens of agency-specific portals. There is no single source of truth. By the time you find a great-fit topic, the deadline may have already passed.' },
    { step: '02', title: 'Impossible Formats', description: 'Every agency has different requirements — page limits, font sizes, section orders, budget formats. A DoD Phase I looks nothing like an NIH R43. Small businesses spend days just decoding the solicitation before they can start writing.' },
    { step: '03', title: 'Expensive Consultants', description: 'SBIR/STTR consultants charge $5,000–$15,000 per proposal. For a small business exploring federal R&D for the first time, that math simply does not work — especially when success is never guaranteed.' },
    { step: '04', title: 'Starting From Scratch', description: 'Every proposal feels like the first. Team bios, past performance narratives, technical capabilities, facility descriptions — rewritten from zero each time. There is no system to capture what worked and apply it to the next one.' },
    { step: '05', title: 'Missed Deadlines', description: 'SBIR/STTR topics are released on unpredictable schedules. Open topics can have 30-day windows. Without a scanning system, great-fit opportunities close before you even know they exist.' },
    { step: '06', title: 'No Competitive Intel', description: 'You have no way to know if a topic is a strong fit for your technology before you invest weeks of effort. No match scoring, no competitive landscape analysis, no way to prioritize across dozens of open topics.' },
  ],
}

const STATIC_META = {
  title: 'About RFP Pipeline | SBIR/STTR Expertise for Small Business',
  description: '20+ years of SBIR/STTR expertise. 13/13 recent win rate. $100M+ in non-dilutive capital secured. Learn how RFP Pipeline helps small tech businesses win federal research funding.',
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
      {/* Hero — Mission-led */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Leveling the playing field for{' '}
            <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
              small business innovators
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* Credibility stats */}
      <section className="bg-surface-50 px-4 py-16 sm:px-6 lg:px-8 border-y border-gray-200/60">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {content.features.map(item => (
              <div key={item.icon} className="text-center">
                <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent sm:text-4xl">{item.icon}</p>
                <p className="mt-2 text-sm font-bold text-gray-900">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Problem */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="The Problem"
          title="The SBIR/STTR process is stacked against small businesses"
          description="Six barriers stand between innovative companies and the non-dilutive funding they deserve."
        />
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200/60 sm:grid-cols-2 lg:grid-cols-3">
          {content.howItWorks.map(item => (
            <div key={item.step} className="relative bg-white p-6 group hover:bg-red-50/30 transition-colors">
              <span className="absolute right-4 top-4 text-3xl font-black text-gray-100 group-hover:text-red-100 transition-colors">{item.step}</span>
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
                <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-gray-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{item.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Our Solution */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Our Solution"
          title="AI + expert hybrid — not just another SaaS tool"
          description="RFP Pipeline combines automated intelligence with human expertise. The AI finds and scores opportunities. The experts build your templates. The platform makes every proposal faster than the last."
        />
        <div className="mx-auto mt-14 max-w-5xl grid gap-6 lg:grid-cols-3">
          {/* Find */}
          <div className="rounded-2xl border border-gray-200/80 bg-white p-7 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900">Find</h3>
            <p className="mt-1 text-sm font-semibold text-brand-600">AI-powered scanning</p>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">
              We scan SAM.gov, SBIR.gov, and Grants.gov daily. Every SBIR/STTR topic across all 11 participating agencies is captured, indexed, and scored against your technology profile. You see the opportunities that matter — before the deadline passes.
            </p>
          </div>

          {/* Build */}
          <div className="rounded-2xl border border-brand-200 bg-white p-7 shadow-card ring-1 ring-brand-500/10 transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900">Build</h3>
            <p className="mt-1 text-sm font-semibold text-brand-600">Expert templates + AI workspace</p>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">
              When you are ready to pursue a topic, our experts review the solicitation and deliver a custom proposal template matched to the agency and program. An AI workspace helps you assemble each section, drawing from your growing content library.
            </p>
          </div>

          {/* Compound */}
          <div className="rounded-2xl border border-gray-200/80 bg-white p-7 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900">Compound</h3>
            <p className="mt-1 text-sm font-semibold text-brand-600">Every proposal makes the next one faster</p>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">
              Team bios, past performance, technical capabilities, facility descriptions — everything is stored and indexed in your content library. The AI learns your voice and writing style. Your 5th proposal takes a fraction of the effort of your 1st.
            </p>
          </div>
        </div>
      </Section>

      {/* Founder credibility */}
      <Section className="bg-white">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            eyebrow="The Founder"
            title="Built by someone who has done this 100+ times"
          />
          <div className="mt-10 rounded-2xl border border-gray-200/80 bg-white p-8 shadow-card sm:p-10">
            <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
              {/* Avatar placeholder */}
              <div className="hidden h-24 w-24 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-50 text-brand-600 sm:flex">
                <svg className="h-11 w-11" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Eric</h3>
                <p className="text-sm font-semibold text-brand-600">Founder, RFP Pipeline</p>

                <div className="mt-6 space-y-4 text-sm leading-relaxed text-gray-600">
                  <p>
                    With 20+ years in federal R&D funding, Eric has personally guided 50+ companies to over $100M in non-dilutive SBIR/STTR capital — maintaining a 13/13 recent win rate across DoD, NIH, NSF, DOE, and NASA awards.
                  </p>
                  <p>
                    As an Air Force APEX accelerator advisor, he has seen firsthand how the most innovative small businesses often struggle the most with the proposal process. The companies that won consistently were not always the most technically brilliant — they were the most organized. They had systems, templates, and institutional knowledge that gave them an unfair advantage.
                  </p>
                  <p>
                    RFP Pipeline exists to give every small business that same advantage — without the $10K-per-proposal consultant price tag.
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {[
                    'Air Force APEX Advisor',
                    '13/13 SBIR Win Rate',
                    '$100M+ Secured',
                    '50+ Companies',
                    '20+ Years',
                  ].map(badge => (
                    <span key={badge} className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-600/10">
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Coverage — 11 agencies, 3 data sources */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Coverage"
          title="Every SBIR/STTR opportunity. Every agency. One platform."
          description="We scan three federal data sources daily to deliver complete coverage of all SBIR/STTR participating agencies."
        />

        <div className="mx-auto mt-12 max-w-5xl">
          {/* Data sources */}
          <div className="grid gap-4 sm:grid-cols-3 mb-10">
            {[
              { name: 'SAM.gov', description: 'Federal contract opportunities, BAAs, and OTAs', icon: 'S' },
              { name: 'SBIR.gov', description: 'All SBIR/STTR solicitations and pre-release topics', icon: 'B' },
              { name: 'Grants.gov', description: 'Federal grant opportunities including STTR and research grants', icon: 'G' },
            ].map(source => (
              <div key={source.name} className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 font-bold text-lg">
                  {source.icon}
                </div>
                <h4 className="text-sm font-bold text-gray-900">{source.name}</h4>
                <p className="mt-1 text-xs text-gray-500">{source.description}</p>
              </div>
            ))}
          </div>

          {/* Agency grid */}
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card sm:p-8">
            <h3 className="text-center text-sm font-bold uppercase tracking-wider text-gray-400 mb-6">11 SBIR/STTR Participating Agencies</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {[
                { abbr: 'DoD', name: 'Department of Defense' },
                { abbr: 'NIH', name: 'National Institutes of Health' },
                { abbr: 'NSF', name: 'National Science Foundation' },
                { abbr: 'DOE', name: 'Department of Energy' },
                { abbr: 'NASA', name: 'Nat\'l Aeronautics & Space Admin' },
                { abbr: 'DHS', name: 'Dept of Homeland Security' },
                { abbr: 'USDA', name: 'Dept of Agriculture' },
                { abbr: 'DOC', name: 'Dept of Commerce / NIST' },
                { abbr: 'DOT', name: 'Dept of Transportation' },
                { abbr: 'EPA', name: 'Environmental Protection Agency' },
                { abbr: 'ED', name: 'Dept of Education' },
              ].map(agency => (
                <div key={agency.abbr} className="rounded-xl bg-surface-50 px-4 py-3 text-center transition-colors hover:bg-brand-50">
                  <p className="text-sm font-bold text-gray-900">{agency.abbr}</p>
                  <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{agency.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <CtaSection
        title="Ready to win your next SBIR?"
        description="Join the companies using RFP Pipeline to find, evaluate, and win SBIR/STTR awards. Start with a 14-day free trial — no credit card required."
        primaryLabel="See Pricing"
        primaryHref="/get-started"
        secondaryLabel="Contact the founder"
        secondaryHref="mailto:eric@rfppipeline.com"
      />
    </>
  )
}
