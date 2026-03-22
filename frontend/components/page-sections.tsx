'use client'

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
      className={`px-4 py-20 sm:px-6 sm:py-24 lg:px-8 ${dark ? 'bg-cta-gradient text-white' : ''} ${className}`}
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
        <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${dark ? 'bg-white/10 text-brand-300' : 'bg-brand-50 text-brand-600 ring-1 ring-brand-600/10'}`}>
          {eyebrow}
        </div>
      )}
      <h2 className={`mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-tight ${dark ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h2>
      {description && (
        <p className={`mt-4 max-w-2xl text-lg leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-600'} ${center ? 'mx-auto' : ''}`}>
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
    <div className="group card-hover p-6">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-all duration-300 group-hover:bg-brand-600 group-hover:text-white group-hover:shadow-glow">
        {icon}
      </div>
      <h3 className="text-base font-bold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">{description}</p>
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
      <p className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">{value}</p>
      <p className="mt-1.5 text-sm font-bold text-gray-900">{label}</p>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
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
    <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-card">
      <div className="flex items-start gap-6">
        {/* Avatar placeholder */}
        <div className="hidden h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-50 text-brand-600 sm:flex">
          <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">{name}</h3>
          <p className="text-sm font-semibold text-brand-600">{title}</p>
          {linkedIn && (
            <a
              href={linkedIn}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-500 hover:bg-brand-50 hover:text-brand-600 transition-all"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
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
        <div className="mt-6 border-t border-gray-100 pt-5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">Education & Credentials</h4>
          <ul className="mt-3 space-y-1.5">
            {credentials.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                </svg>
                {c}
              </li>
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
  primaryHref = '/get-started',
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
    <section className="relative overflow-hidden bg-cta-gradient px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      {/* Decorative orbs */}
      <div className="absolute -left-20 -top-20 h-60 w-60 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="absolute -bottom-20 -right-20 h-60 w-60 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2>
        <p className="mt-4 text-lg leading-relaxed text-gray-300">{description}</p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link href={primaryHref} className="btn-cta bg-white text-brand-700 hover:bg-gray-100 shadow-xl">
            {primaryLabel}
            <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
          {secondaryLabel && secondaryHref && (
            <Link href={secondaryHref} className="group text-sm font-semibold text-gray-300 hover:text-white transition-colors">
              {secondaryLabel}
              <span className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">&rarr;</span>
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
    <div className="card-hover p-6">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <time>{date}</time>
        {category && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span className="badge-blue">{category}</span>
          </>
        )}
      </div>
      <h3 className="mt-3 text-base font-bold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">{excerpt}</p>
    </div>
  )
}

/* ── Pricing card ─────────────────────────────────── */

export function PricingCard({
  name,
  price,
  period,
  description,
  features,
  cta,
  popular = false,
  onSelect,
}: {
  name: string
  price: string
  period: string
  description: string
  features: string[]
  cta: string
  popular?: boolean
  onSelect?: () => void
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-8 transition-all duration-300 ${
        popular
          ? 'border-brand-200 bg-white shadow-glow-lg scale-[1.02] ring-1 ring-brand-600/20'
          : 'border-gray-200/80 bg-white shadow-card hover:shadow-card-hover hover:-translate-y-0.5'
      }`}
    >
      {popular && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-brand-600 px-4 py-1 text-xs font-bold text-white shadow-sm">
            Most Popular
          </span>
        </div>
      )}

      <div>
        <h3 className="text-lg font-bold text-gray-900">{name}</h3>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-extrabold tracking-tight text-gray-900">{price}</span>
        <span className="text-sm font-medium text-gray-500">/{period}</span>
      </div>

      <ul className="mt-8 flex-1 space-y-3">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-gray-600">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <button
        onClick={onSelect}
        className={`mt-8 w-full rounded-xl py-3 text-sm font-bold transition-all duration-200 ${
          popular
            ? 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow-md'
            : 'bg-gray-50 text-gray-900 ring-1 ring-gray-200 hover:bg-gray-100 hover:ring-gray-300'
        }`}
      >
        {cta}
      </button>
    </div>
  )
}

/* ── Modal ─────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
}) {
  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className={`modal-panel ${maxWidth}`}
          onClick={e => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors z-10"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
          {children}
        </div>
      </div>
    </div>
  )
}

/* ── Breadcrumb ────────────────────────────────────── */

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="breadcrumb mb-6">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <svg className="breadcrumb-separator h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          )}
          {item.href ? (
            <Link href={item.href} className="breadcrumb-link">{item.label}</Link>
          ) : (
            <span className="breadcrumb-current">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
