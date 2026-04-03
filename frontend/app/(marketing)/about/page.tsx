import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { AboutPageContent } from '@/types'

const STATIC_CONTENT: AboutPageContent = {
  hero: {
    eyebrow: 'Our Story',
    title: 'We Built the System We Needed — Now You Can Use It',
    description: 'After decades of winning and supporting SBIR/STTR funding, we built the platform we wish existed.',
  },
  mission: {
    eyebrow: 'Why RFP Pipeline Exists',
    title: 'The funding exists. The talent exists. The system was broken.',
    paragraphs: [
      'We have spent years inside the SBIR/STTR process — writing proposals, advising startups, supporting accelerators, and helping companies secure non-dilutive funding.',
      'The problem was always the same: Opportunities were scattered. Decisions were unclear. Proposals took too long. Knowledge did not carry forward.',
      'So we built the system ourselves. Now you can use it.',
    ],
  },
  features: [
    { icon: '$100M+', title: 'Capital Supported', description: 'Non-dilutive funding supported through SBIR, STTR, OTAs, BAAs, and related federal R&D programs' },
    { icon: 'Dozens', title: 'Awards Won', description: 'Phase I, II & III SBIR/STTR awards across companies led and supported' },
    { icon: '100+', title: 'Additional Wins', description: 'Awards supported through advisory roles, accelerators, and federal programs' },
    { icon: '20+', title: 'Years Experience', description: 'Technology commercialization, SBIR/STTR proposal development, and federal R&D strategy' },
  ],
  howItWorks: [],
}

const STATIC_META = {
  title: 'About | RFP Pipeline',
  description: 'We built the SBIR/STTR system we needed. $100M+ in non-dilutive capital supported. Decades of federal R&D expertise. Now you can use it.',
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
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            We Built the System We Needed —{' '}
            <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
              Now You Can Use It
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* Credibility stats */}
      <section className="bg-slate-900 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {content.features.map(item => (
              <div key={item.icon} className="text-center">
                <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-400 to-cyan-400 bg-clip-text text-transparent sm:text-4xl">{item.icon}</p>
                <p className="mt-2 text-sm font-bold text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why RFP Pipeline Exists */}
      <Section className="bg-white">
        <div className="mx-auto max-w-3xl">
          <SectionHeader
            eyebrow={content.mission.eyebrow}
            title={content.mission.title}
            center={false}
          />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-gray-600">
            {content.mission.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </Section>

      {/* Philosophy */}
      <section className="bg-surface-50 px-4 py-20 sm:px-6 sm:py-24 lg:px-8 border-y border-gray-200/60">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            SBIR Should Not Be an Insider&apos;s Game
          </h2>
          <div className="mt-6 space-y-4 text-base leading-relaxed text-gray-600">
            <p>The funding exists. The talent exists.</p>
            <p>But the system has been too fragmented and too complex for most companies to access efficiently.</p>
            <p className="font-semibold text-gray-900">RFP Pipeline changes that.</p>
          </div>
        </div>
      </section>

      {/* Founder */}
      <Section className="bg-white">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-card sm:p-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              {/* Avatar placeholder */}
              <div className="hidden h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-50 text-brand-600 sm:flex">
                <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Eric Wagner</h3>
                <p className="text-sm font-semibold text-brand-600">Founder & CEO</p>
                <ul className="mt-4 space-y-1.5 text-sm text-gray-600">
                  <li>20+ years in technology commercialization</li>
                  <li>Dozens of Phase I, II, and III SBIR/STTR awards across companies led and supported</li>
                  <li>Supported the capture of 100+ additional awards through advisory roles, accelerators, and federal programs</li>
                  <li>$100M+ in non-dilutive capital supported</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <CtaSection
        title="Join early users. Start your trial."
        description="See how the SBIR Engine finds, evaluates, and helps you build winning proposals. 14-day free trial. No credit card required."
        primaryLabel="Start 14-Day Trial"
        primaryHref="/get-started"
        secondaryLabel="See Pricing"
        secondaryHref="/pricing"
      />
    </>
  )
}
