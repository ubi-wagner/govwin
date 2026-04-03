import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { SbirEnginePageContent } from '@/types'

const STATIC_CONTENT: SbirEnginePageContent = {
  hero: {
    title: 'The SBIR Engine',
    description: 'A complete system to find, evaluate, and build winning federal R&D proposals.',
  },
  sections: [
    {
      id: 'discovery',
      eyebrow: 'Discovery',
      title: 'Never Miss the Right Opportunity',
      description: 'The engine scans every federal source daily — SBIR.gov, SAM.gov, Grants.gov — across all 11 participating agencies. Topics are indexed, classified, and matched to your technology profile before you even log in.',
      features: ['Aggregates SBIR/STTR, OTA, BAA', 'Filters by your technology', 'Real-time alerts'],
    },
    {
      id: 'decision',
      eyebrow: 'Decision Engine',
      title: 'Know What to Pursue',
      description: 'Most companies waste weeks chasing topics that were never a good fit. The decision engine scores every opportunity against your capabilities, flags risks, and tells you where your time is best spent.',
      features: ['Fit scoring', 'Risk flags', 'Strategic alignment'],
    },
    {
      id: 'build',
      eyebrow: 'Proposal Builder',
      title: 'Start With Structure — Not a Blank Page',
      description: 'When you commit to a topic, the system generates an agency-matched proposal template with section-by-section guidance. AI-assisted drafting pulls from your content library so you never rewrite what you have already written.',
      features: ['Expert-derived templates', 'Section-by-section workflow', 'AI-assisted drafting'],
    },
    {
      id: 'learn',
      eyebrow: 'Learning System',
      title: 'Every Proposal Makes the Next One Faster',
      description: 'Team bios, past performance, technical narratives, facility descriptions — everything is stored, indexed, and reusable. The system compounds your effort. Your 5th proposal takes a fraction of the work of your 1st.',
      features: ['Reusable content library', 'Institutional memory', 'Compounding efficiency'],
    },
  ],
  cta: {
    title: 'See It in Action',
    description: 'Start your free trial and see how the SBIR Engine transforms your federal R&D pipeline.',
    primaryLabel: 'Start Trial',
    primaryHref: '/get-started',
  },
}

const STATIC_META = {
  title: 'The SBIR Engine | RFP Pipeline',
  description: 'A complete system to find, evaluate, and build winning SBIR/STTR proposals. Discovery, decision scoring, proposal building, and a learning system that compounds your effort.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('engine')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

const STEPS = ['Discovery', 'Decision', 'Build', 'Learn'] as const

export default async function SbirEnginePage() {
  const published = await getPageContent('engine')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            The Operating System for Non-Dilutive Funding
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            The{' '}
            <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
              SBIR Engine
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* ───── System Overview Flow ───── */}
      <section className="border-y border-gray-200/60 bg-surface-50 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {/* Desktop: horizontal */}
          <div className="hidden sm:flex items-center justify-center gap-0">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center">
                <div className="flex flex-col items-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="mt-2 text-sm font-bold text-gray-900">{step}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="mx-4 h-px w-16 bg-brand-300" />
                )}
              </div>
            ))}
          </div>
          {/* Mobile: vertical */}
          <div className="flex sm:hidden flex-col items-center gap-0">
            {STEPS.map((step, i) => (
              <div key={step} className="flex flex-col items-center">
                {i > 0 && <div className="h-6 w-px bg-brand-300" />}
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <span className="mt-1 text-sm font-bold text-gray-900">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Feature Sections ───── */}
      {content.sections.map((section, i) => {
        const isDecisionEngine = section.id === 'decision'
        const bgClass = i % 2 === 0 ? 'bg-white' : 'bg-surface-50'

        return (
          <Section key={section.id} className={bgClass}>
            <SectionHeader
              eyebrow={section.eyebrow}
              title={section.title}
              description={section.description}
            />
            <div className="mx-auto mt-10 max-w-3xl">
              <div className={`rounded-2xl border p-6 sm:p-8 ${
                isDecisionEngine
                  ? 'border-brand-200 bg-brand-50/40 ring-1 ring-brand-500/10'
                  : 'border-gray-200/80 bg-white shadow-card'
              }`}>
                {isDecisionEngine && (
                  <p className="mb-4 text-xs font-bold uppercase tracking-wider text-brand-600">
                    Key Differentiator
                  </p>
                )}
                <ul className="space-y-3">
                  {section.features.map(feature => (
                    <li key={feature} className="flex items-center gap-3">
                      <svg className={`h-5 w-5 flex-shrink-0 ${isDecisionEngine ? 'text-brand-600' : 'text-emerald-500'}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span className="text-sm font-semibold text-gray-800">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        )
      })}

      {/* ───── CTA ───── */}
      <CtaSection
        title={content.cta.title}
        description={content.cta.description}
        primaryLabel={content.cta.primaryLabel}
        primaryHref={content.cta.primaryHref}
        secondaryLabel="See Pricing"
        secondaryHref="/pricing"
      />
    </>
  )
}
