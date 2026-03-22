import Link from 'next/link'

/* ── Section wrapper ─────────────────────────────── */

export function Section({
  children,
  className = '',
  id,
  dark = false,
}: {
  children: React.ReactNode
  className?: string
  id?: string
  dark?: boolean
}) {
  return (
    <section
      id={id}
      className={`px-4 py-16 sm:px-6 sm:py-20 lg:px-8 ${dark ? 'bg-brand-950 text-white' : 'bg-white'} ${className}`}
    >
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  )
}

/* ── Section header ──────────────────────────────── */

export function SectionHeader({
  eyebrow,
  title,
  description,
  center = true,
  dark = false,
}: {
  eyebrow?: string
  title: string
  description?: string
  center?: boolean
  dark?: boolean
}) {
  return (
    <div className={center ? 'text-center' : ''}>
      {eyebrow && (
        <p className={`text-sm font-semibold uppercase tracking-wider ${dark ? 'text-brand-300' : 'text-brand-600'}`}>
          {eyebrow}
        </p>
      )}
      <h2 className={`mt-2 text-3xl font-bold tracking-tight sm:text-4xl ${dark ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h2>
      {description && (
        <p className={`mt-4 max-w-2xl text-lg ${dark ? 'text-gray-300' : 'text-gray-600'} ${center ? 'mx-auto' : ''}`}>
          {description}
        </p>
      )}
    </div>
  )
}

/* ── Feature card ────────────────────────────────── */

export function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{description}</p>
    </div>
  )
}

/* ── Stat card ───────────────────────────────────── */

export function StatHighlight({
  value,
  label,
  description,
}: {
  value: string
  label: string
  description?: string
}) {
  return (
    <div className="text-center">
      <p className="text-4xl font-bold text-brand-600">{value}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{label}</p>
      {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
    </div>
  )
}

/* ── Team member card ────────────────────────────── */

export function TeamCard({
  name,
  title,
  bio,
  credentials,
  linkedIn,
}: {
  name: string
  title: string
  bio: string[]
  credentials?: string[]
  linkedIn?: string
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-8 shadow-sm">
      <div className="flex items-start gap-6">
        {/* Avatar placeholder */}
        <div className="hidden h-24 w-24 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 sm:flex">
          <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">{name}</h3>
          <p className="text-sm font-medium text-brand-600">{title}</p>
          {linkedIn && (
            <a
              href={linkedIn}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600 transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              LinkedIn
            </a>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {bio.map((paragraph, i) => (
          <p key={i} className="text-sm leading-relaxed text-gray-600">{paragraph}</p>
        ))}
      </div>

      {credentials && credentials.length > 0 && (
        <div className="mt-6 border-t border-gray-100 pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Education & Credentials</h4>
          <ul className="mt-2 space-y-1">
            {credentials.map((c, i) => (
              <li key={i} className="text-sm text-gray-600">{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── CTA section ─────────────────────────────────── */

export function CtaSection({
  title,
  description,
  primaryLabel = 'Get Started',
  primaryHref = '/about#contact',
  secondaryLabel,
  secondaryHref,
}: {
  title: string
  description: string
  primaryLabel?: string
  primaryHref?: string
  secondaryLabel?: string
  secondaryHref?: string
}) {
  return (
    <section className="bg-brand-950 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2>
        <p className="mt-4 text-lg text-gray-300">{description}</p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href={primaryHref} className="btn-primary bg-white text-brand-700 hover:bg-gray-100">
            {primaryLabel}
          </Link>
          {secondaryLabel && secondaryHref && (
            <Link href={secondaryHref} className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
              {secondaryLabel} &rarr;
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

/* ── Content card (for tips, announcements, etc.) ── */

export function ContentCard({
  date,
  category,
  title,
  excerpt,
}: {
  date: string
  category?: string
  title: string
  excerpt: string
}) {
  return (
    <div className="block rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <time>{date}</time>
        {category && (
          <>
            <span>&middot;</span>
            <span className="badge-blue">{category}</span>
          </>
        )}
      </div>
      <h3 className="mt-3 text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{excerpt}</p>
    </div>
  )
}
