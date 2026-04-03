import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { TeamPageContent } from '@/types'

const STATIC_CONTENT: TeamPageContent = {
  hero: {
    eyebrow: 'Meet the Founder',
    title: 'We built the system we always wished we had',
    description: 'RFP Pipeline was not built by software engineers guessing about government contracting. It was built by someone who spent decades helping startups win federal funding — and saw firsthand that most teams cannot afford the expertise to compete. So we built AI agents trained by the best to be the best.',
  },
  members: [
    {
      name: 'Eric Wagner',
      title: 'Founder & CEO, RFP Pipeline',
      linkedIn: 'https://www.linkedin.com/in/eric-wagner-7480385/',
      bio: [
        'We always wanted this system but did not have the team to build it. Every startup I worked with — whether through APEX, Converge, or Ohio State — faced the same problem: the technology was strong, but the proposal process broke them. Hiring a full BD team or paying $15-25K per proposal is not viable for a 10-person company chasing a $150K Phase I. So we built RFP Pipeline — decades of expert knowledge distilled into AI agents that deliver high-impact, low-friction, cost-effective opp-to-prop-to-win capabilities without the cost of a team or external consultants.',
        'As President of D&S Consultants, I led an aerospace and defense company with over $300M in annual revenue and over 800 employees. Our core mission was innovation development and the successful transition of that innovation into high-tech fieldable hardware and software solutions for the DoD. I saw the full lifecycle of federal contracting at scale — from opportunity identification through contract execution. That operational knowledge is embedded in every workflow RFP Pipeline delivers.',
        'I co-founded Converge Technologies, commercializing emerging technology across defense and civilian markets. I co-founded Lighthouse Avionics, bringing next-gen avionics solutions to market. And I founded Ohio Gateway Tech Fund — a $10M pre-seed fund and support studio where I served as GP and LP — backing the earliest-stage deep tech companies that most investors wouldn\'t touch. Building companies from breakthrough innovation is what drove every chapter of my career before RFP Pipeline.',
        'As a senior advisory consultant to the Air Force APEX commercialization program, I advised 40+ startups on SBIR/STTR participation. Over the last decade I won dozens of Phase I, II, and III awards for my own startups and mentored hundreds of additional wins that drove hundreds of millions in non-dilutive funding into the startups I advised. That methodology — the scoring, the structure, the review cadence — is what powers the SBIR Engine.',
        'I created and program-managed the Manufacturing Extension Partnership (MEP) program at Ohio State University CDME, supporting small businesses across 35+ counties and directly launching 20+ technology-focused startups from university and federal lab innovation. I also served as an Ohio TechAngels member and founding instructor for I-Corps@Ohio in Engineering and Physical Sciences.',
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
    { value: 'Dozens', label: 'Phase I, II & III Awards', description: 'Over the last decade for his startups' },
    { value: '40+', label: 'Startups Advised', description: 'Through Air Force APEX program' },
    { value: '20+', label: 'Startups Launched', description: 'From university & federal lab innovation' },
    { value: '$10M', label: 'Pre-Seed Fund', description: 'Ohio Gateway Tech Fund (GP & LP)' },
  ],
}

const STATIC_META = {
  title: 'Meet the Founder | RFP Pipeline',
  description: 'Eric Wagner — Founder & CEO of RFP Pipeline. Dozens of Phase I, II & III awards, hundreds of wins mentored, 40+ startups advised. Built by someone who has done it.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('team')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function TeamPage() {
  const published = await getPageContent('team')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  const member = content.members[0]
  if (!member) return null

  const chapters = [
    {
      tag: 'The Founder',
      headline: 'Why he built RFP Pipeline',
      paragraph: member.bio[0] ?? '',
    },
    {
      tag: 'The Executive',
      headline: 'Led at scale in aerospace & defense',
      paragraph: member.bio[1] ?? '',
    },
    {
      tag: 'The Entrepreneur',
      headline: 'Co-founded companies and funded what others wouldn\'t',
      paragraph: member.bio[2] ?? '',
    },
    {
      tag: 'The Mentor',
      headline: 'Dozens of awards. Hundreds of wins mentored.',
      paragraph: member.bio[3] ?? '',
    },
    {
      tag: 'The Builder',
      headline: 'Launched startups from universities and federal labs',
      paragraph: member.bio[4] ?? '',
    },
  ]

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
            We built the system we{' '}
            <span className="bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">always wished we had</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* ───── Key stats banner ───── */}
      <section className="border-y border-gray-100 bg-gray-950 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          {content.stats.slice(0, 4).map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{s.value}</p>
              <p className="mt-1 text-sm font-semibold text-gray-300">{s.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Founder intro card ───── */}
      <Section className="bg-white">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-gray-200/80 bg-white shadow-card overflow-hidden">
            {/* Header bar */}
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

            {/* Founder vision statement */}
            <div className="px-8 py-8">
              <p className="text-base leading-relaxed text-gray-700 font-medium italic border-l-4 border-brand-500 pl-5">
                &ldquo;We always wanted this system but did not have the team to build it. We built it so you don&rsquo;t have to get a team to succeed. AI agents trained by the best to be the best.&rdquo;
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ───── Mock platform screenshot — Proposal Builder view ───── */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Inside the Platform"
          title="From opportunity to submission-ready proposal"
          description="Expert-derived structure, AI-assisted drafting, and a content library that compounds with every submission."
        />
        <div className="relative mx-auto mt-14 max-w-4xl">
          <div className="rounded-2xl border border-gray-200/60 bg-white p-1.5 shadow-elevated">
            {/* Browser chrome */}
            <div className="flex items-center gap-1.5 rounded-t-xl bg-gray-100 px-4 py-2.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <div className="ml-3 flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400">
                rfppipeline.com/portal/proposals/new
              </div>
            </div>
            {/* Mock proposal builder content */}
            <div className="rounded-b-xl bg-gray-50 p-4 sm:p-6">
              {/* Builder header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Proposal Builder</div>
                  <div className="text-sm font-bold text-gray-900 mt-0.5">USAF | Autonomous Cyber Defense Platform — Phase I</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-brand-50 px-2.5 py-1 text-[10px] font-bold text-brand-700 ring-1 ring-brand-600/10">Draft</div>
                  <div className="rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-600/10">Match: 96</div>
                </div>
              </div>
              {/* Stat cards row */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <MockStatCard label="Sections Complete" value="7 / 12" color="bg-blue-50" accent="text-blue-600" />
                <MockStatCard label="AI Suggestions" value="23" subtext="accepted" color="bg-violet-50" accent="text-violet-600" />
                <MockStatCard label="Compliance Score" value="94%" subtext="all requirements met" color="bg-emerald-50" accent="text-emerald-600" />
                <MockStatCard label="Days to Deadline" value="11" subtext="on track" color="bg-amber-50" accent="text-amber-600" />
              </div>
              {/* Section checklist */}
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs font-bold text-gray-700 mb-3">Proposal Sections</div>
                <div className="space-y-2">
                  <MockSectionRow title="Technical Approach" status="complete" words={2840} />
                  <MockSectionRow title="Phase I Work Plan" status="complete" words={1650} />
                  <MockSectionRow title="Key Personnel & Qualifications" status="complete" words={980} />
                  <MockSectionRow title="Related Work & Past Performance" status="in-progress" words={420} />
                  <MockSectionRow title="Commercialization Strategy" status="pending" words={0} />
                  <MockSectionRow title="Budget Justification" status="pending" words={0} />
                </div>
              </div>
            </div>
          </div>
          {/* Subtle glow */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 h-40 w-3/4 bg-gradient-to-t from-brand-500/5 to-transparent blur-2xl -z-10" />
        </div>
      </Section>

      {/* ───── Career chapters ───── */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Career History"
          title="Founder. Executive. Mentor. Teacher. Builder."
          description="Every role shaped the system. Every lesson is built into the platform."
        />
        <div className="mx-auto mt-14 max-w-4xl space-y-8">
          {chapters.map((chapter, i) => (
            <div key={i} className="group rounded-2xl border border-gray-200/80 bg-white p-6 sm:p-8 shadow-card transition-all duration-300 hover:shadow-card-hover">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 font-bold text-sm transition-all duration-300 group-hover:bg-brand-600 group-hover:text-white">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-gray-900 px-3 py-1 text-xs font-bold text-white">
                      {chapter.tag}
                    </span>
                    <h3 className="text-lg font-bold text-gray-900">{chapter.headline}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-gray-600">{chapter.paragraph}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───── Credentials ───── */}
      {member.credentials && member.credentials.length > 0 && (
        <Section className="bg-surface-50">
          <div className="mx-auto max-w-4xl">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 text-center">Education & Credentials</h4>
            <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {member.credentials.map((c, j) => (
                <li key={j} className="flex items-start gap-2.5 rounded-xl bg-white border border-gray-200/80 px-5 py-4 text-sm text-gray-600 shadow-card">
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
      <section className="relative border-t border-gray-100 bg-gray-950 px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <div className="absolute inset-0 -z-0">
          <div className="absolute left-1/4 top-0 h-40 w-40 rounded-full bg-brand-500/10 blur-3xl" />
          <div className="absolute right-1/4 bottom-0 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Built by someone who has{' '}
            <span className="bg-gradient-to-r from-brand-400 to-cyan-400 bg-clip-text text-transparent">done it.</span>
            <br />
            Powered by AI that{' '}
            <span className="bg-gradient-to-r from-brand-400 to-cyan-400 bg-clip-text text-transparent">learns from every win.</span>
          </h2>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/get-started" className="btn-cta px-8 py-3.5 text-base">
              Join the Waitlist
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <Link href="/engine" className="inline-flex items-center gap-2 rounded-full border border-gray-600 px-6 py-3 text-sm font-semibold text-gray-300 transition-colors hover:border-white hover:text-white">
              See the SBIR Engine
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

/* ── Mock UI components for platform screenshot ─────────────── */

function MockStatCard({ label, value, subtext, color, accent }: { label: string; value: string; subtext?: string; color: string; accent?: string }) {
  return (
    <div className={`rounded-lg ${color} p-3`}>
      <div className="text-[10px] font-medium text-gray-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${accent ?? 'text-gray-900'}`}>{value}</div>
      {subtext && <div className="text-[9px] text-gray-400 mt-0.5">{subtext}</div>}
    </div>
  )
}

function MockSectionRow({ title, status, words }: { title: string; status: 'complete' | 'in-progress' | 'pending'; words: number }) {
  const statusConfig = {
    'complete': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Complete' },
    'in-progress': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'In Progress' },
    'pending': { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Pending' },
  }
  const cfg = statusConfig[status]

  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 transition-colors hover:bg-gray-100">
      <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-3">
        {status === 'complete' ? (
          <svg className="h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        ) : status === 'in-progress' ? (
          <svg className="h-4 w-4 flex-shrink-0 text-amber-500 animate-pulse-subtle" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
        ) : (
          <div className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-gray-300" />
        )}
        <span className="text-[11px] font-semibold text-gray-800 truncate">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        {words > 0 && <span className="text-[9px] text-gray-400">{words.toLocaleString()} words</span>}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.bg} ${cfg.text}`}>
          {cfg.label}
        </span>
      </div>
    </div>
  )
}
