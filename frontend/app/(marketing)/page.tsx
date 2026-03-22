import Link from 'next/link'
import { Section, SectionHeader, FeatureCard, StatHighlight, CtaSection } from '@/components/page-sections'

export default function LandingPage() {
  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden bg-white px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-hero-mesh" />
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-brand-500/5 blur-3xl" />
          <div className="absolute right-0 top-1/3 h-[400px] w-[400px] rounded-full bg-violet-500/5 blur-3xl" />
          <div className="absolute left-0 bottom-0 h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-5xl text-center">
          {/* Trust badge */}
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10 animate-fade-in">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse-subtle" />
            Trusted by 50+ startups &middot; $100M+ secured
          </div>

          <h1 className="mt-8 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl xl:text-7xl animate-fade-in-up">
            Find and win federal contracts{' '}
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-cyan-500 bg-clip-text text-transparent">
              before your competitors
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl animate-fade-in-up">
            RFP Pipeline uses AI-powered scoring to surface the government opportunities most relevant to
            your business. Stop searching. Start winning.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center animate-fade-in-up">
            <Link href="/get-started" className="btn-cta px-8 py-3.5 text-base">
              Start Free Trial
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <Link href="/about" className="group flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-brand-600 transition-colors">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-gray-200 transition-all group-hover:border-brand-300 group-hover:bg-brand-50">
                <svg className="h-4 w-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              See how it works
            </Link>
          </div>
        </div>

        {/* Platform preview mockup */}
        <div className="mx-auto mt-16 max-w-5xl animate-fade-in-up">
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
            <div className="rounded-b-xl bg-gray-50 p-6">
              <div className="grid grid-cols-4 gap-3">
                <MockStatCard label="In Pipeline" value="147" color="bg-blue-50" />
                <MockStatCard label="High Priority" value="23" color="bg-emerald-50" />
                <MockStatCard label="Pursuing" value="8" color="bg-violet-50" />
                <MockStatCard label="Closing Soon" value="5" color="bg-red-50" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                  <div className="text-xs font-bold text-gray-700">Top Scored Opportunities</div>
                  <div className="mt-3 space-y-2">
                    <MockOppRow title="USAF Cyber Defense Platform" score={96} />
                    <MockOppRow title="NASA Research Data Analysis" score={92} />
                    <MockOppRow title="Army Communication Systems" score={88} />
                  </div>
                </div>
                <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                  <div className="text-xs font-bold text-gray-700">Closing Soon</div>
                  <div className="mt-3 space-y-2">
                    <MockOppRow title="DHS Border Security Tech" score={85} days={3} />
                    <MockOppRow title="VA Telehealth Expansion" score={79} days={5} />
                    <MockOppRow title="DOE Clean Energy R&D" score={74} days={7} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Social proof stats ───── */}
      <section className="relative border-y border-gray-100 bg-white px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 sm:grid-cols-4">
          <StatHighlight value="$100M+" label="Non-Dilutive Capital" description="Secured for clients" />
          <StatHighlight value="100%" label="Recent Win Rate" description="13/13 SBIR/STTR awards" />
          <StatHighlight value="50+" label="Startups Supported" description="Early-stage technology companies" />
          <StatHighlight value="20+" label="Years Experience" description="Federal contracting expertise" />
        </div>
      </section>

      {/* ───── Trusted by logos placeholder ───── */}
      <section className="bg-white px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-gray-400">
            Trusted by innovative companies across the defense & technology landscape
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {['Air Force APEX', 'Parallax Advanced Research', 'Ohio State CDME', 'Converge Ventures', 'AFRL'].map(name => (
              <span key={name} className="text-sm font-semibold text-gray-300">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Features grid ───── */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Platform Capabilities"
          title="Everything you need to win government contracts"
          description="From opportunity discovery to proposal submission, RFP Pipeline streamlines the entire federal procurement process."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<SearchIcon />}
            title="Smart Opportunity Discovery"
            description="Automated scanning of SAM.gov and federal procurement sources. Never miss a relevant RFP, RFI, or sources sought notice."
          />
          <FeatureCard
            icon={<ChartIcon />}
            title="AI-Powered Scoring"
            description="Each opportunity is scored against your company profile, NAICS codes, keywords, set-aside eligibility, and past performance."
          />
          <FeatureCard
            icon={<BellIcon />}
            title="Deadline Alerts"
            description="Automated notifications for approaching deadlines, new high-scoring matches, and status changes on opportunities you're tracking."
          />
          <FeatureCard
            icon={<ShieldIcon />}
            title="Set-Aside Matching"
            description="Instant identification of small business, SDVOSB, WOSB, HUBZone, and 8(a) set-asides that match your certifications."
          />
          <FeatureCard
            icon={<DocumentIcon />}
            title="Document Management"
            description="Centralized storage for capability statements, past performance records, and proposal templates — ready when you need them."
          />
          <FeatureCard
            icon={<TeamIcon />}
            title="Multi-Tenant Workspaces"
            description="Each client gets their own secure workspace with customized scoring profiles, opportunity pipelines, and team access."
          />
        </div>
      </Section>

      {/* ───── How it works ───── */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="How It Works"
          title="From search to submission in three steps"
        />
        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Profile Your Business',
              description: 'Enter your NAICS codes, keywords, set-aside certifications, and target agencies. Our scoring engine learns what matters to you.',
              icon: <UserProfileIcon />,
            },
            {
              step: '02',
              title: 'Review Scored Opportunities',
              description: 'Every day, new federal opportunities are automatically scored and ranked. Focus on the highest-value matches first.',
              icon: <ScoreIcon />,
            },
            {
              step: '03',
              title: 'Pursue & Win',
              description: 'Track your pipeline, collaborate with your team, and leverage AI insights to craft winning proposals.',
              icon: <TrophyIcon />,
            },
          ].map(item => (
            <div key={item.step} className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-7 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1">
              {/* Step number watermark */}
              <span className="absolute -right-2 -top-4 text-8xl font-black text-gray-50 transition-colors duration-300 group-hover:text-brand-50">
                {item.step}
              </span>
              <div className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 transition-all duration-300 group-hover:bg-brand-600 group-hover:text-white group-hover:shadow-glow">
                  {item.icon}
                </div>
                <h3 className="mt-5 text-lg font-bold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───── Testimonial highlight ───── */}
      <section className="bg-surface-50 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <svg className="mx-auto h-10 w-10 text-brand-200" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H14.017zM0 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H0z" />
          </svg>
          <blockquote className="mt-6 text-xl font-medium leading-relaxed text-gray-900 sm:text-2xl">
            &ldquo;RFP Pipeline surfaced an Air Force opportunity we would have completely missed. The scoring told us it was a 94% match — and they were right. We won our first SBIR Phase I within 60 days.&rdquo;
          </blockquote>
          <div className="mt-6">
            <p className="text-sm font-bold text-gray-900">Defense Technology Startup</p>
            <p className="text-sm text-gray-500">$150K SBIR Phase I Award</p>
          </div>
        </div>
      </section>

      {/* ───── Pricing teaser ───── */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Simple Pricing"
          title="Plans that grow with your pipeline"
          description="Start with a free trial. Upgrade when you're ready. No surprises."
        />
        <div className="mt-10 flex justify-center">
          <Link
            href="/get-started"
            className="group inline-flex items-center gap-2 rounded-xl bg-brand-50 px-6 py-3 text-sm font-bold text-brand-700 ring-1 ring-brand-600/10 transition-all hover:bg-brand-100 hover:ring-brand-600/20"
          >
            View Plans & Pricing
            <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </Section>

      {/* ───── CTA ───── */}
      <CtaSection
        title="Ready to find your next contract?"
        description="Join the companies already using RFP Pipeline to discover and win government opportunities faster."
        primaryLabel="Start Free Trial"
        primaryHref="/get-started"
        secondaryLabel="See customer wins"
        secondaryHref="/customers"
      />
    </>
  )
}

/* ── Mock dashboard components (for hero preview) ── */

function MockStatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`rounded-lg ${color} p-3`}>
      <div className="text-[10px] font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-gray-900">{value}</div>
    </div>
  )
}

function MockOppRow({ title, score, days }: { title: string; score: number; days?: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
      <span className="text-[11px] font-medium text-gray-700 truncate mr-2">{title}</span>
      <div className="flex items-center gap-2">
        {days != null && <span className="text-[10px] text-red-500 font-semibold">{days}d</span>}
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

function UserProfileIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
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
