import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, FeatureCard, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { HomePageContent } from '@/types'

const STATIC_CONTENT: HomePageContent = {
  hero: {
    eyebrow: 'Built for High-Tech Small Businesses & Startups',
    title: 'The First Platform Built to Win Non-Dilutive Federal Research Funding',
    description: 'RFP Pipeline is purpose-built for CEOs and lean-launch teams pursuing SBIR, STTR, Challenge, OTA, and other non-dilutive funding programs with billions in annual awards specifically for small businesses. Stop hiring consultants. Start winning.',
    trustBadge: '$100M+ non-dilutive funding secured | Dozens of Phase I, II & III awards | 11 Federal SBIR/STTR agencies',
  },
  features: [
    { icon: 'Search', title: 'Smart Opportunity Discovery', description: 'AI scans SAM.gov, SBIR.gov, and every agency portal daily. SBIR, STTR, OTA, BAA, and Challenge opportunities matched to your technology profile automatically.' },
    { icon: 'Chart', title: 'AI-Powered Fit Scoring', description: 'Every opportunity scored against your capabilities, NAICS codes, and agency history. Know what to pursue before investing time reading 200-page solicitations.' },
    { icon: 'Bell', title: 'Deadline Intelligence', description: 'SBIR release cycles, pre-solicitation windows, and agency timelines — all tracked. Get notified at exactly the right time, not the last minute.' },
    { icon: 'Shield', title: 'Expert-Derived Templates', description: 'Proposal structures built from real winning submissions. Agency-aligned, section-by-section, with evaluation criteria baked in. Submission-ready in days.' },
    { icon: 'Document', title: 'Compound Learning Library', description: 'Team bios, past performance, technical narratives — stored and indexed. Every proposal makes the next one faster. Your 5th takes half the effort of your 1st.' },
    { icon: 'Team', title: 'Team Collaboration', description: 'Invite STTR research partners, subcontractors, and consultants with proposal-level access controls. Track changes, revision history, and upload portals.' },
  ],
  stats: [
    { value: '$4B+', label: 'Annual SBIR/STTR Funding', description: 'Across 11 federal agencies' },
    { value: '$199', label: 'Pipeline Engine', description: 'Per month — your SBIR command center' },
    { value: '$999', label: 'Phase I Build', description: 'Per proposal — one-time fee' },
    { value: '150x', label: 'Potential ROI', description: '$999 build → $150K+ Phase I award' },
  ],
  howItWorks: [
    { step: '01', title: 'Discover', description: 'AI scans every federal agency for SBIR, STTR, OTA, BAA, and Challenge opportunities matched to your technology.' },
    { step: '02', title: 'Qualify', description: 'Fit scoring, risk flags, and strategic alignment help you pick only the opportunities worth pursuing.' },
    { step: '03', title: 'Build', description: 'Expert-derived templates and AI-assisted drafting get your proposal submission-ready in days, not months.' },
    { step: '04', title: 'Collaborate', description: 'Team integration with track changes, revision history, upload portals, and partner access controls.' },
    { step: '05', title: 'Win', description: 'Higher quality packages, more submissions per cycle, and development efficiency that compounds over time.' },
    { step: '06', title: 'Improve', description: 'Each proposal adds intelligence and foundational content to your library — making every future submission faster.' },
    { step: '07', title: 'Extend', description: 'A growing content library and expert-curated templates enable well-aligned submissions across agencies efficiently.' },
    { step: '08', title: 'Expand', description: 'The system learns which offices and program managers across agencies support your mission — enabling targeted Phase III BD and champion development.' },
  ],
  partners: ['Air Force APEX', 'Parallax Advanced Research', 'Ohio State CDME', 'Converge Ventures', 'AFRL'],
  testimonial: {
    quote: 'RFP Pipeline surfaced an Air Force SBIR topic we would have completely missed. The scoring told us it was a 94% match — and they were right. We won our first Phase I within 60 days.',
    company: 'CEO, Defense Technology Startup',
    result: '$150K SBIR Phase I Award',
  },
  pricingTeaser: {
    eyebrow: 'Look Only. Never Pay Until You Build.',
    title: '10 Phase I proposals for less than the price of a consultant.',
    description: 'Pipeline Engine runs 24/7 for $199/month — your SBIR command center. Phase I Build ($999) and Phase II Build ($2,500) are one-time per-proposal fees covering any SBIR or STTR agency. The cost of missing an opportunity because you never saw it should never happen.',
    ctaText: 'View Plans & Pricing',
    ctaLink: '/get-started',
  },
  cta: {
    title: 'Be One of the First 20.',
    description: 'Up to 20 small businesses who join the waitlist will be selected for early access and personal onboarding by our founder — plus 3 months of free Pipeline Engine subscription as long as you actively use and test the system as intended.',
    primaryLabel: 'Join the Waitlist',
    primaryHref: '/get-started',
    secondaryLabel: 'See the SBIR Engine',
    secondaryHref: '/engine',
  },
}

const STATIC_META = {
  title: 'RFP Pipeline | The First Platform Built to Win SBIR/STTR Awards',
  description: 'Purpose-built for high-tech small businesses and startups pursuing SBIR, STTR, OTA, and Challenge funding. $199/mo Pipeline Engine + per-proposal builds. Launching May 15, 2026.',
}

const ICON_MAP: Record<string, () => React.JSX.Element> = {
  Search: SearchIcon, Chart: ChartIcon, Bell: BellIcon,
  Shield: ShieldIcon, Document: DocumentIcon, Team: TeamIcon,
}

const STEP_ICON_MAP: Record<string, () => React.JSX.Element> = {
  '01': SearchIcon, '02': ScoreIcon, '03': DocumentIcon, '04': TeamIcon,
  '05': TrophyIcon, '06': ChartIcon, '07': ShieldIcon, '08': BellIcon,
}

const FEDERAL_AGENCIES = [
  { abbr: 'DoD', name: 'Department of Defense', sbirUrl: 'https://www.dodsbirsttr.mil/', color: 'from-blue-600 to-blue-800' },
  { abbr: 'NIH', name: 'National Institutes of Health', sbirUrl: 'https://seed.nih.gov/', color: 'from-sky-500 to-sky-700' },
  { abbr: 'NSF', name: 'National Science Foundation', sbirUrl: 'https://www.nsf.gov/eng/iip/sbir/', color: 'from-indigo-500 to-indigo-700' },
  { abbr: 'DOE', name: 'Department of Energy', sbirUrl: 'https://www.energy.gov/science/sbir-sttr', color: 'from-emerald-500 to-emerald-700' },
  { abbr: 'NASA', name: 'NASA', sbirUrl: 'https://sbir.nasa.gov/', color: 'from-red-500 to-red-700' },
  { abbr: 'DHS', name: 'Dept of Homeland Security', sbirUrl: 'https://www.dhs.gov/science-and-technology/sbir', color: 'from-cyan-600 to-cyan-800' },
  { abbr: 'USDA', name: 'Dept of Agriculture', sbirUrl: 'https://www.usda.gov/topics/research-and-science', color: 'from-green-600 to-green-800' },
  { abbr: 'DOT', name: 'Dept of Transportation', sbirUrl: 'https://www.volpe.dot.gov/work-with-us/small-business-innovation-research', color: 'from-violet-500 to-violet-700' },
  { abbr: 'EPA', name: 'Environmental Protection Agency', sbirUrl: 'https://www.epa.gov/sbir', color: 'from-teal-500 to-teal-700' },
  { abbr: 'DoC', name: 'Dept of Commerce (NIST)', sbirUrl: 'https://www.nist.gov/tpo/small-business-innovation-research-program', color: 'from-amber-500 to-amber-700' },
  { abbr: 'ED', name: 'Dept of Education', sbirUrl: 'https://ies.ed.gov/sbir/', color: 'from-rose-500 to-rose-700' },
]

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('home')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function LandingPage() {
  const published = await getPageContent('home')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden bg-white px-4 pb-24 pt-16 sm:px-6 sm:pb-32 sm:pt-24 lg:px-8">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-hero-mesh" />
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/3 h-[800px] w-[800px] rounded-full bg-brand-500/5 blur-3xl" />
          <div className="absolute right-0 top-1/4 h-[500px] w-[500px] rounded-full bg-violet-500/5 blur-3xl" />
          <div className="absolute left-0 bottom-0 h-[500px] w-[500px] rounded-full bg-cyan-500/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-5xl text-center">
          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10 animate-fade-in">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse-subtle" />
            {content.hero.eyebrow}
          </div>

          <h1 className="mt-8 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl animate-fade-in-up">
            The First Platform Built to{' '}
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-cyan-500 bg-clip-text text-transparent">
              Win Non-Dilutive
            </span>
            {' '}Federal Research{' '}
            <br className="hidden sm:block" />
            <span className="text-gray-900">Funding</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl animate-fade-in-up">
            {content.hero.description}
          </p>

          {/* ROI proof strip */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 animate-fade-in-up">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-extrabold bg-gradient-to-r from-emerald-600 to-emerald-500 bg-clip-text text-transparent">$4B+</span>
              <span className="text-sm font-medium text-gray-500">annual SBIR/STTR funding</span>
            </div>
            <div className="h-6 w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <span className="text-2xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">$199/mo</span>
              <span className="text-sm font-medium text-gray-500">Pipeline Engine</span>
            </div>
            <div className="h-6 w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <span className="text-2xl font-extrabold bg-gradient-to-r from-violet-600 to-violet-500 bg-clip-text text-transparent">11</span>
              <span className="text-sm font-medium text-gray-500">federal SBIR/STTR agencies</span>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center animate-fade-in-up">
            <Link href="/get-started" className="btn-cta px-8 py-3.5 text-base">
              Join the Waitlist
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <p className="text-xs text-gray-400">Launching May 15, 2026</p>
          </div>
        </div>

        {/* Platform preview mockup */}
        <div className="mx-auto mt-20 max-w-5xl animate-fade-in-up">
          <div className="relative rounded-2xl border border-gray-200/60 bg-white p-1.5 shadow-elevated">
            {/* Browser chrome */}
            <div className="flex items-center gap-1.5 rounded-t-xl bg-gray-100 px-4 py-2.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <div className="ml-3 flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400">
                rfppipeline.com/portal/dashboard
              </div>
            </div>
            {/* Mock dashboard content */}
            <div className="rounded-b-xl bg-gray-50 p-4 sm:p-6">
              {/* Dashboard header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pipeline Overview</div>
                  <div className="text-sm font-bold text-gray-900 mt-0.5">FY2026 SBIR/STTR Opportunities</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-600/10">Live Scanning</div>
                  <div className="rounded-md bg-gray-100 px-2.5 py-1 text-[10px] font-medium text-gray-500">Last sync: 2m ago</div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <MockStatCard label="In Pipeline" value="147" subtext="across 11 agencies" color="bg-blue-50" accent="text-blue-600" />
                <MockStatCard label="High Match (90%+)" value="23" subtext="action recommended" color="bg-emerald-50" accent="text-emerald-600" />
                <MockStatCard label="Actively Pursuing" value="8" subtext="proposals in progress" color="bg-violet-50" accent="text-violet-600" />
                <MockStatCard label="Closing This Week" value="5" subtext="deadlines approaching" color="bg-red-50" accent="text-red-600" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="col-span-2 rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-gray-700">Highest-Match Opportunities</div>
                    <div className="text-[10px] text-gray-400">Match Score</div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <MockOppRow title="USAF | Autonomous Cyber Defense Platform" agency="AFRL" score={96} phase="Phase I" amount="$150K" />
                    <MockOppRow title="NASA | ML-Based Telemetry Analysis" agency="STMD" score={94} phase="Phase II" amount="$1M" />
                    <MockOppRow title="Army | Next-Gen Comm Systems" agency="DEVCOM" score={91} phase="Phase I" amount="$150K" />
                    <MockOppRow title="NIH | AI Diagnostic Imaging Tools" agency="NCI" score={88} phase="Phase I" amount="$275K" />
                  </div>
                </div>
                <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                  <div className="text-xs font-bold text-gray-700">Closing Soon</div>
                  <div className="mt-3 space-y-2">
                    <MockDeadlineRow title="DHS Border Security" days={2} score={85} />
                    <MockDeadlineRow title="VA Telehealth Platform" days={4} score={82} />
                    <MockDeadlineRow title="DOE Clean Energy R&D" days={6} score={79} />
                    <MockDeadlineRow title="NSF Quantum Computing" days={8} score={74} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Subtle glow under mockup */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 h-40 w-3/4 bg-gradient-to-t from-brand-500/5 to-transparent blur-2xl -z-10" />
        </div>
      </section>

      {/* ───── Federal Agency Coverage — All 11 SBIR/STTR Agencies ───── */}
      <section className="border-y border-gray-100 bg-slate-900 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            Covering All 11 SBIR &amp; STTR Participating Federal Agencies
          </p>
          <p className="text-center text-sm text-slate-500 mb-10">
            Click any agency to visit their SBIR/STTR program page
          </p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {FEDERAL_AGENCIES.map(agency => (
              <a
                key={agency.abbr}
                href={agency.sbirUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center gap-2 rounded-xl bg-slate-800/60 px-3 py-4 ring-1 ring-slate-700/60 transition-all duration-300 hover:bg-slate-700 hover:ring-brand-500/40 hover:scale-105"
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${agency.color} text-xs font-black text-white shadow-lg transition-all duration-300 group-hover:shadow-brand-500/20`}>
                  {agency.abbr}
                </div>
                <span className="text-[10px] font-medium text-slate-400 text-center leading-tight group-hover:text-white transition-colors">
                  {agency.name}
                </span>
                <svg className="h-3 w-3 text-slate-600 group-hover:text-brand-400 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ───── ROI & Pricing Snapshot ───── */}
      <section className="bg-white px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <div className="inline-flex items-center rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-600/10">
              The ROI
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              The cost of missing an opportunity you never saw<br />
              <span className="text-gray-400">should never happen.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-gray-600 leading-relaxed">
              10 Phase I proposals generated for less than the price of a single consultant &ldquo;helping&rdquo; with your proposal package. Look only, never pay — Builds are per-proposal, one-time fees only when you are ready.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {/* Pipeline Engine */}
            <div className="relative overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-8 text-center shadow-card">
              <div className="absolute -right-4 -top-4 text-[80px] font-black text-brand-50">1-2</div>
              <div className="relative">
                <div className="inline-flex items-center rounded-full bg-brand-100 px-3 py-1 text-[10px] font-bold text-brand-700 mb-4">Steps 1 &amp; 2: Discover &amp; Qualify</div>
                <div className="text-xs font-bold uppercase tracking-wider text-brand-600">Pipeline Engine</div>
                <div className="mt-2 text-4xl font-extrabold text-gray-900">$199<span className="text-lg font-medium text-gray-400">/mo</span></div>
                <p className="mt-3 text-sm text-gray-500 leading-relaxed">Your SBIR command center. AI scans all 11 agencies, scores every opportunity, and tracks every deadline — 24/7.</p>
                <div className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">Monthly subscription</div>
              </div>
            </div>

            {/* Phase I Build */}
            <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-card">
              <div className="absolute -right-4 -top-4 text-[80px] font-black text-gray-50">3</div>
              <div className="relative">
                <div className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold text-gray-600 mb-4">Step 3: Build</div>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Phase I Build</div>
                <div className="mt-2 text-4xl font-extrabold text-gray-900">$999<span className="text-lg font-medium text-gray-400">/ea</span></div>
                <p className="mt-3 text-sm text-gray-500 leading-relaxed">Per proposal, one-time fee. Covers any SBIR or STTR agency. Expert templates + AI drafting.</p>
                <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2">
                  <span className="text-xs font-bold text-emerald-700">Win $150K+ → 150x ROI</span>
                </div>
              </div>
            </div>

            {/* Phase II Build */}
            <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-card">
              <div className="absolute -right-4 -top-4 text-[80px] font-black text-gray-50">3</div>
              <div className="relative">
                <div className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold text-gray-600 mb-4">Step 3: Build</div>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Phase II Build</div>
                <div className="mt-2 text-4xl font-extrabold text-gray-900">$2,500<span className="text-lg font-medium text-gray-400">/ea</span></div>
                <p className="mt-3 text-sm text-gray-500 leading-relaxed">Per proposal, one-time fee. Covers any SBIR or STTR agency. Full technical + commercialization.</p>
                <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2">
                  <span className="text-xs font-bold text-emerald-700">Win $1M+ → 400x ROI</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <Link href="/get-started" className="btn-cta px-8 py-3.5 text-base">
              Join the Waitlist
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <p className="mt-3 text-xs text-gray-400">Launching May 15, 2026</p>
          </div>
        </div>
      </section>

      {/* ───── Social proof stats ───── */}
      <section className="relative border-y border-gray-100 bg-slate-900 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="absolute inset-0 -z-0">
          <div className="absolute left-1/4 top-0 h-40 w-40 rounded-full bg-brand-500/10 blur-3xl" />
          <div className="absolute right-1/4 bottom-0 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-5xl">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-12">
            The numbers behind the platform
          </p>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {content.stats.map(stat => (
              <div key={stat.label} className="text-center">
                <p className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-brand-400 to-cyan-400 bg-clip-text text-transparent sm:text-5xl">{stat.value}</p>
                <p className="mt-2 text-sm font-bold text-white">{stat.label}</p>
                <p className="mt-0.5 text-xs text-slate-400">{stat.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Features grid ───── */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Inside the SBIR Engine"
          title="Everything you need to find, decide, and build"
          description="Each capability addresses a specific pain point that small businesses face when competing for federal R&D contracts."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {content.features.map(feat => {
            const IconComponent = ICON_MAP[feat.icon] ?? SearchIcon
            return (
              <FeatureCard
                key={feat.title}
                icon={<IconComponent />}
                title={feat.title}
                description={feat.description}
              />
            )
          })}
        </div>
      </Section>

      {/* ───── 8-Step Process Flow ───── */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="The RFP Pipeline Process"
          title="From Discovery to Expansion — One Continuous System"
          description="Steps 1-2 are your monthly Pipeline Engine. Step 3 is a per-build price. Steps 4-8 are the compounding advantages that grow with every submission."
        />
        <div className="relative mt-14">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {content.howItWorks.map((item, idx) => {
              const StepIcon = STEP_ICON_MAP[item.step] ?? SearchIcon
              const isSubscription = idx < 2
              const isBuild = idx === 2
              return (
                <div key={item.step} className={`group relative overflow-hidden rounded-2xl border p-6 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 ${
                  isSubscription ? 'border-brand-200 bg-gradient-to-br from-brand-50 to-white' :
                  isBuild ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white' :
                  'border-gray-200/80 bg-white'
                }`}>
                  <span className="absolute -right-2 -top-4 text-7xl font-black text-gray-50/80 transition-colors duration-300 group-hover:text-brand-50">
                    {item.step}
                  </span>
                  <div className="relative">
                    <div className="mb-3 flex items-center gap-2.5">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${
                        isSubscription ? 'bg-brand-100 text-brand-600 group-hover:bg-brand-600 group-hover:text-white' :
                        isBuild ? 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white' :
                        'bg-gray-100 text-gray-600 group-hover:bg-brand-600 group-hover:text-white'
                      }`}>
                        <StepIcon />
                      </div>
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[9px] font-bold text-white">
                        {idx + 1}
                      </div>
                      {isSubscription && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[9px] font-bold text-brand-700">$199/mo</span>}
                      {isBuild && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">Per build</span>}
                    </div>
                    <h3 className="text-base font-bold text-gray-900">{item.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{item.description}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Explode — future vision callout */}
          <div className="mt-8 rounded-2xl border border-dashed border-brand-300 bg-gradient-to-r from-brand-50 via-white to-cyan-50 p-8 text-center">
            <div className="inline-flex items-center rounded-full bg-brand-100 px-4 py-1.5 text-xs font-bold text-brand-700 mb-3">
              The Vision
            </div>
            <h3 className="text-xl font-bold text-gray-900">As Our Customers Grow, So Does the Network</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-600 leading-relaxed">
              As RFP Pipeline customers win and grow, we will develop networks of investors, state and local support partners, and accelerator programs chartered with finding the best FedTech startups to support — creating a flywheel of opportunity, capital, and growth.
            </p>
          </div>
        </div>
      </Section>

      {/* ───── Testimonial highlight ───── */}
      <section className="bg-slate-900 px-4 py-20 sm:px-6 sm:py-28 lg:px-8 relative overflow-hidden">
        <div className="absolute left-0 top-0 h-60 w-60 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="absolute right-0 bottom-0 h-60 w-60 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-4xl text-center">
          {/* Five stars */}
          <div className="flex items-center justify-center gap-1 mb-6">
            {[1,2,3,4,5].map(i => (
              <svg key={i} className="h-5 w-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <blockquote className="text-xl font-medium leading-relaxed text-white sm:text-2xl lg:text-3xl">
            &ldquo;{content.testimonial.quote}&rdquo;
          </blockquote>
          <div className="mt-8">
            <p className="text-sm font-bold text-white">{content.testimonial.company}</p>
            <p className="mt-1 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              {content.testimonial.result}
            </p>
          </div>
        </div>
      </section>

      {/* ───── Authority + Partners ───── */}
      <Section className="bg-white border-b border-gray-100">
        <SectionHeader
          eyebrow="Built by Experts, for Experts"
          title="AI Agents Trained by the Best to Be the Best"
          description="Every score, template, and recommendation comes from someone who has actually won — decades of real-world capture management, dozens of Phase I/II/III awards, and hundreds of millions in non-dilutive funding mentored. The AI doesn't guess. It builds on what works."
        />
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-14 gap-y-4">
          {content.partners.map(name => (
            <span key={name} className="text-sm font-bold text-gray-300 tracking-wide">{name}</span>
          ))}
        </div>
      </Section>

      {/* ───── CTA ───── */}
      <CtaSection
        title={content.cta.title}
        description={content.cta.description}
        primaryLabel={content.cta.primaryLabel}
        primaryHref={content.cta.primaryHref}
        secondaryLabel={content.cta.secondaryLabel}
        secondaryHref={content.cta.secondaryHref}
      />
    </>
  )
}

/* ── Problem/Solution helper components ── */

function ProblemItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
        <svg className="h-3 w-3 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </div>
      <p className="text-sm leading-relaxed text-gray-600">{text}</p>
    </div>
  )
}

function SolutionItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-100">
        <svg className="h-3 w-3 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <p className="text-sm leading-relaxed text-gray-600">{text}</p>
    </div>
  )
}

/* ── Mock dashboard components (for hero preview) ── */

function MockStatCard({ label, value, subtext, color, accent }: { label: string; value: string; subtext?: string; color: string; accent?: string }) {
  return (
    <div className={`rounded-lg ${color} p-3`}>
      <div className="text-[10px] font-medium text-gray-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${accent ?? 'text-gray-900'}`}>{value}</div>
      {subtext && <div className="text-[9px] text-gray-400 mt-0.5">{subtext}</div>}
    </div>
  )
}

function MockOppRow({ title, agency, score, phase, amount }: { title: string; agency?: string; score: number; phase?: string; amount?: string; days?: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 transition-colors hover:bg-gray-100">
      <div className="flex-1 min-w-0 mr-3">
        <span className="text-[11px] font-semibold text-gray-800 truncate block">{title}</span>
        <div className="flex items-center gap-2 mt-0.5">
          {agency && <span className="text-[9px] font-medium text-gray-400">{agency}</span>}
          {phase && <span className="text-[9px] font-medium text-brand-500">{phase}</span>}
          {amount && <span className="text-[9px] font-bold text-emerald-600">{amount}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-12 h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div className={`h-full rounded-full ${score >= 90 ? 'bg-emerald-500' : score >= 80 ? 'bg-amber-500' : 'bg-gray-400'}`} style={{ width: `${score}%` }} />
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${score >= 90 ? 'bg-emerald-100 text-emerald-700' : score >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {score}
        </span>
      </div>
    </div>
  )
}

function MockDeadlineRow({ title, days, score }: { title: string; days: number; score: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
      <span className="text-[11px] font-medium text-gray-700 truncate mr-2">{title}</span>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold ${days <= 3 ? 'text-red-500' : 'text-amber-500'}`}>{days}d</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${score >= 90 ? 'bg-emerald-100 text-emerald-700' : score >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {score}
        </span>
      </div>
    </div>
  )
}

/* ── SVG icons ────────────────────────────────────── */

function SearchIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}

function TeamIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
    </svg>
  )
}

function ScoreIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
    </svg>
  )
}

function TrophyIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .982-3.172M8.25 4.5h7.5M6 7.5h12a1.5 1.5 0 0 0 1.5-1.5V4.5a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5V6A1.5 1.5 0 0 0 6 7.5Zm0 0v3a6 6 0 0 0 6 6 6 6 0 0 0 6-6V7.5" />
    </svg>
  )
}
