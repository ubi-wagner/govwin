import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { TeamPageContent } from '@/types'

const STATIC_CONTENT: TeamPageContent = {
  hero: {
    eyebrow: 'The Founder',
    title: 'Built by Someone Who Has Done It 100+ Times',
    description: 'RFP Pipeline was not built by software engineers guessing about government contracting. It was built by someone who has personally helped secure over $100M in non-dilutive funding — and who got tired of watching brilliant companies lose because the system was broken.',
  },
  members: [
    {
      name: 'Eric Wagner',
      title: 'Founder & CEO, RFP Pipeline',
      linkedIn: 'https://www.linkedin.com/in/eric-wagner-7480385/',
      bio: [
        'Eric launched RFP Pipeline to solve a problem he has seen firsthand hundreds of times: brilliant small businesses struggle to find and win the federal contracts they deserve — not because their technology is weak, but because the procurement process is opaque, fragmented, and unforgiving. You needed a BD team, proposal writers, a pipeline manager, and consultants. Most companies can\'t afford that. We can\'t let innovation die in a SAM.gov search bar.',
        'The vision: AI agents trained by the best to be the best. Every score, template, and recommendation in RFP Pipeline comes from decades of real wins. The system doesn\'t guess — it learned from someone who has actually done it. We built it so you don\'t have to get a team to succeed.',
      ],
      credentials: [
        'BS in Computer Science (cum laude) — The Ohio State University',
        'Executive MBA (magna cum laude, Salutatorian, Pace Setter Award) — The Ohio State University',
        'Ohio TechAngels member and active angel investor',
        'I-Corps@Ohio founding instructor (Engineering & Physical Sciences)',
      ],
    },
  ],
  stats: [
    { value: '13/13', label: 'SBIR/STTR Awards', description: '100% success rate in most recent cohort' },
    { value: '40+', label: 'Startups Advised', description: 'Through Air Force APEX program' },
    { value: '20+', label: 'Startups Launched', description: 'From university & federal lab innovation' },
    { value: '$11M', label: 'Startup Studio', description: 'Converge Ventures fund' },
  ],
}

const STATIC_META = {
  title: 'Our Founder | RFP Pipeline',
  description: 'Meet Eric Wagner — founder, executive, mentor, and builder. 13/13 SBIR win rate, 40+ startups advised, $100M+ in non-dilutive capital. He built RFP Pipeline so you don\'t have to build a team.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('team')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function TeamPage() {
  const published = await getPageContent('team')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden bg-white px-4 pt-20 pb-12 sm:px-6 sm:pt-28 sm:pb-16 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="absolute right-0 top-0 h-[400px] w-[400px] rounded-full bg-brand-500/5 blur-3xl" />

        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Built by Someone Who Has{' '}
            <span className="bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">Done It 100+ Times</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* ───── Key stats banner ───── */}
      <section className="border-y border-gray-100 bg-gray-950 px-4 py-12 sm:px-6 lg:px-8">
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

      {/* ───── Founder Profile — Why He Built This ───── */}
      <Section className="bg-white">
        <div className="mx-auto max-w-4xl">
          {content.members.map((member, i) => (
            <div key={i} className="rounded-2xl border border-gray-200/80 bg-white shadow-card overflow-hidden">
              <div className="bg-gradient-to-r from-gray-950 to-gray-800 px-8 py-6">
                <div className="flex items-center gap-5">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm text-white border border-white/10">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{member.name}</h2>
                    <p className="text-sm font-semibold text-brand-300">{member.title}</p>
                    {member.linkedIn && (
                      <a
                        href={member.linkedIn}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                        Connect on LinkedIn
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-8 py-8">
                <div className="space-y-4">
                  {member.bio.map((paragraph, j) => (
                    <p key={j} className="text-sm leading-relaxed text-gray-600">{paragraph}</p>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───── Career Chapters ───── */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Career History"
          title="Founder. Executive. Mentor. Builder."
          description="The expertise behind every score, template, and recommendation in RFP Pipeline."
        />
        <div className="mx-auto mt-14 max-w-4xl space-y-6">
          <CareerChapter
            role="The Executive"
            title="President, D&S Consultants"
            description="Led an aerospace and defense company with $270M in annual revenue and 800+ employees. Oversaw government contracts, proposal operations, and business development at scale."
            highlights={['$270M+ annual revenue', '800+ employees', 'Aerospace & defense operations']}
          />
          <CareerChapter
            role="The Entrepreneur"
            title="Co-Founder, Converge Ventures & Converge Technologies"
            description="Built an $11M startup studio developing high-potential companies from innovation at Ohio universities and federal laboratories. Co-founded Converge Technologies as CSO and EVP of Business Development."
            highlights={['$11M startup studio', 'University-to-market pipeline', 'CSO & EVP Business Development']}
          />
          <CareerChapter
            role="The Mentor"
            title="Senior Advisory Consultant, Air Force APEX"
            description="Advised 40+ startups on SBIR/STTR participation through the Air Force commercialization program. Most recent cohort submitted 13 proposals and received 13 awards — an unheard-of 100% success rate."
            highlights={['40+ startups advised', '13/13 SBIR win rate', 'Ohio TechAngels investor']}
          />
          <CareerChapter
            role="The Builder"
            title="Creator, MEP Program at Ohio State CDME"
            description="Created and program-managed the Manufacturing Extension Partnership program at Ohio State University, supporting small businesses across 35+ counties and leading the formation of 20+ technology-focused startups from university and federal lab innovation."
            highlights={['20+ startups launched', '35+ counties served', 'I-Corps@Ohio founding instructor']}
          />
        </div>
      </Section>

      {/* ───── System Preview — What He Built ───── */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="What He Built"
          title="Decades of expertise, distilled into software"
          description="Every capability Eric used to help 100+ companies win — from opportunity scanning to proposal structure to content reuse — is now available as an AI-powered platform."
        />
        <div className="mx-auto mt-14 max-w-4xl">
          <div className="rounded-2xl border border-gray-200/60 bg-white p-1.5 shadow-elevated">
            <div className="flex items-center gap-1.5 rounded-t-xl bg-gray-100 px-4 py-2.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <div className="ml-3 flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400">
                rfppipeline.com/portal/proposal-builder
              </div>
            </div>
            <div className="rounded-b-xl bg-gray-50 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Proposal Builder</div>
                  <div className="text-sm font-bold text-gray-900 mt-0.5">AFRL | Autonomous Cyber Defense Platform</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-brand-50 px-2.5 py-1 text-[10px] font-bold text-brand-700 ring-1 ring-brand-600/10">Phase I</div>
                  <div className="rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">96% Match</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  {[
                    { section: 'Technical Objectives', status: 'complete' },
                    { section: 'Innovation Significance', status: 'complete' },
                    { section: 'Phase I Work Plan', status: 'ai-drafting' },
                    { section: 'Key Personnel', status: 'auto-filled' },
                    { section: 'Related Work', status: 'pending' },
                    { section: 'Commercialization Plan', status: 'pending' },
                  ].map(s => (
                    <div key={s.section} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-gray-100">
                      <span className="text-[11px] font-medium text-gray-800">{s.section}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                        s.status === 'complete' ? 'bg-emerald-100 text-emerald-700' :
                        s.status === 'auto-filled' ? 'bg-cyan-100 text-cyan-700' :
                        s.status === 'ai-drafting' ? 'bg-brand-100 text-brand-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {s.status === 'complete' ? 'Done' :
                         s.status === 'auto-filled' ? 'Auto-filled' :
                         s.status === 'ai-drafting' ? 'AI Drafting...' :
                         'To do'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="rounded-lg bg-white p-3 border border-gray-100">
                    <div className="text-[10px] font-bold text-gray-400 uppercase">Content Library</div>
                    <div className="mt-2 space-y-1">
                      <div className="text-[10px] text-gray-600"><span className="font-bold text-brand-600">8</span> Team Bios</div>
                      <div className="text-[10px] text-gray-600"><span className="font-bold text-brand-600">12</span> Past Perf.</div>
                      <div className="text-[10px] text-gray-600"><span className="font-bold text-brand-600">15</span> Narratives</div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3 border border-emerald-100">
                    <div className="text-[10px] font-bold text-emerald-700">Est. Completion</div>
                    <div className="text-lg font-bold text-emerald-800 mt-1">3 days</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ───── Credentials ───── */}
      {content.members[0]?.credentials && content.members[0].credentials.length > 0 && (
        <Section className="bg-surface-50">
          <div className="mx-auto max-w-3xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 text-center mb-6">Education & Credentials</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {content.members[0].credentials.map((c, j) => (
                <li key={j} className="flex items-start gap-2.5 rounded-xl bg-white border border-gray-200/80 px-4 py-3 text-sm text-gray-600 shadow-sm">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                  </svg>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* ───── CTA ───── */}
      <CtaSection
        title="Built by someone who has done it. Powered by AI that learns from every win."
        description="Whether you are a first-time SBIR applicant or a seasoned contractor, decades of expertise are built into every score, every template, and every recommendation."
        primaryLabel="Start Free Trial"
        primaryHref="/get-started"
        secondaryLabel="See the SBIR Engine"
        secondaryHref="/engine"
      />
    </>
  )
}

/* ── Career Chapter component ── */

function CareerChapter({ role, title, description, highlights }: {
  role: string
  title: string
  description: string
  highlights: string[]
}) {
  return (
    <div className="group rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-wider text-brand-600">{role}</div>
          <h3 className="mt-1 text-lg font-bold text-gray-900">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">{description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {highlights.map(h => (
              <span key={h} className="inline-flex items-center rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200/80">
                {h}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
