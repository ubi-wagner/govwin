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
    description: 'Launching May 15, 2026. Join the waitlist for early access and see how the SBIR Engine transforms your federal R&D pipeline.',
    primaryLabel: 'Join the Waitlist',
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

      {/* ───── Feature Sections with Mock Previews ───── */}
      {content.sections.map((section, i) => {
        const isDecisionEngine = section.id === 'decision'
        const bgClass = i % 2 === 0 ? 'bg-white' : 'bg-surface-50'

        return (
          <Section key={section.id} className={bgClass}>
            <div className="mx-auto max-w-6xl">
              <div className={`grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center ${i % 2 === 1 ? 'lg:grid-flow-dense' : ''}`}>
                {/* Text side */}
                <div className={i % 2 === 1 ? 'lg:col-start-2' : ''}>
                  <div className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-600 ring-1 ring-brand-600/10">
                    Step {i + 1}: {section.eyebrow}
                  </div>
                  <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{section.title}</h2>
                  <p className="mt-4 text-base leading-relaxed text-gray-600">{section.description}</p>
                  <ul className="mt-6 space-y-3">
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

                {/* Mock preview side */}
                <div className={i % 2 === 1 ? 'lg:col-start-1' : ''}>
                  <div className="rounded-2xl border border-gray-200/60 bg-white p-1.5 shadow-elevated">
                    <div className="flex items-center gap-1.5 rounded-t-xl bg-gray-100 px-3 py-2">
                      <div className="h-2 w-2 rounded-full bg-red-400" />
                      <div className="h-2 w-2 rounded-full bg-amber-400" />
                      <div className="h-2 w-2 rounded-full bg-emerald-400" />
                      <div className="ml-2 text-[10px] text-gray-400">rfppipeline.com/portal/{section.id}</div>
                    </div>
                    <div className="rounded-b-xl bg-gray-50 p-4">
                      <EngineStepPreview stepId={section.id} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Section>
        )
      })}

      {/* ───── CTA ───── */}
      <CtaSection
        title="Stop searching. Start winning."
        description="The SBIR Engine replaces a BD team, a proposal shop, and a pipeline manager. Built by someone who has done it 100+ times. Powered by AI that learns from every win."
        primaryLabel="Join the Waitlist"
        primaryHref="/get-started"
        secondaryLabel="See Pricing"
        secondaryHref="/pricing"
      />
    </>
  )
}

/* ── Mock preview components for each engine step ── */

function EngineStepPreview({ stepId }: { stepId: string }) {
  switch (stepId) {
    case 'discovery':
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-gray-700">Opportunity Scanner</div>
            <div className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Live</div>
          </div>
          {[
            { agency: 'AFRL', title: 'Autonomous Cyber Defense Platform', match: 96 },
            { agency: 'NASA', title: 'ML-Based Telemetry Analysis', match: 94 },
            { agency: 'DEVCOM', title: 'Next-Gen Comm Systems', match: 91 },
            { agency: 'NCI', title: 'AI Diagnostic Imaging Tools', match: 88 },
            { agency: 'NSF', title: 'Quantum Computing R&D', match: 82 },
          ].map(opp => (
            <div key={opp.title} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-gray-100">
              <div className="flex-1 min-w-0 mr-2">
                <span className="text-[10px] font-bold text-gray-400">{opp.agency}</span>
                <span className="text-[11px] font-medium text-gray-800 block truncate">{opp.title}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${opp.match >= 90 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{opp.match}%</span>
            </div>
          ))}
        </div>
      )
    case 'decision':
      return (
        <div>
          <div className="text-xs font-bold text-gray-700 mb-3">Fit Analysis</div>
          <div className="rounded-lg bg-white border border-brand-200 p-3 mb-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-900">AFRL | Autonomous Cyber Defense</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">96% Match</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { label: 'Tech Fit', score: 98, color: 'bg-emerald-500' },
                { label: 'Agency Hist.', score: 85, color: 'bg-brand-500' },
                { label: 'Competition', score: 72, color: 'bg-amber-500' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className="text-[9px] text-gray-400">{s.label}</div>
                  <div className="mt-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                    <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.score}%` }} />
                  </div>
                  <div className="text-[9px] font-bold text-gray-600 mt-0.5">{s.score}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-center">
              <div className="text-[9px] text-emerald-600 font-bold">Pursue</div>
            </div>
            <div className="flex-1 rounded-lg bg-gray-50 px-2 py-1.5 text-center">
              <div className="text-[9px] text-gray-500 font-bold">Monitor</div>
            </div>
            <div className="flex-1 rounded-lg bg-gray-50 px-2 py-1.5 text-center">
              <div className="text-[9px] text-gray-500 font-bold">Pass</div>
            </div>
          </div>
        </div>
      )
    case 'build':
      return (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-gray-700">Proposal Builder</div>
            <div className="text-[10px] text-gray-400">Phase I | AFRL</div>
          </div>
          <div className="space-y-1.5">
            {[
              { section: 'Technical Objectives', status: 'complete', pct: 100 },
              { section: 'Innovation & Impact', status: 'drafting', pct: 65 },
              { section: 'Phase I Work Plan', status: 'pending', pct: 0 },
              { section: 'Key Personnel', status: 'auto-filled', pct: 100 },
              { section: 'Commercialization', status: 'pending', pct: 0 },
            ].map(s => (
              <div key={s.section} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 border border-gray-100">
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-medium text-gray-800 block">{s.section}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                  s.status === 'complete' || s.status === 'auto-filled' ? 'bg-emerald-100 text-emerald-700' :
                  s.status === 'drafting' ? 'bg-brand-100 text-brand-700' :
                  'bg-gray-100 text-gray-500'
                }`}>{s.status === 'auto-filled' ? 'Auto-filled' : s.status === 'complete' ? 'Done' : s.status === 'drafting' ? '65%' : 'To do'}</span>
              </div>
            ))}
          </div>
        </div>
      )
    case 'learn':
      return (
        <div>
          <div className="text-xs font-bold text-gray-700 mb-3">Content Library</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Team Bios', count: 8, icon: 'person' },
              { label: 'Past Performance', count: 12, icon: 'trophy' },
              { label: 'Tech Narratives', count: 15, icon: 'doc' },
              { label: 'Facility Desc.', count: 3, icon: 'building' },
            ].map(item => (
              <div key={item.label} className="rounded-lg bg-white px-3 py-2.5 border border-gray-100 text-center">
                <div className="text-lg font-bold text-brand-600">{item.count}</div>
                <div className="text-[10px] text-gray-500">{item.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-center">
            <div className="text-[10px] font-bold text-emerald-700">Proposal #5 builds 48% faster than #1</div>
          </div>
        </div>
      )
    default:
      return null
  }
}
