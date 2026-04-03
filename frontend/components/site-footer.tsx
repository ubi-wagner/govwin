import Link from 'next/link'

const footerLinks = {
  Product: [
    { label: 'SBIR Engine', href: '/engine' },
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Customer Stories', href: '/customers' },
  ],
  Company: [
    { label: 'About', href: '/about' },
    { label: 'Our Team', href: '/team' },
    { label: 'Happenings', href: '/happenings' },
    { label: 'Contact', href: '/about#contact' },
  ],
  Resources: [
    { label: 'SBIR Tips', href: '/tips' },
    { label: 'Tools & Templates', href: '/happenings' },
    { label: 'Get Started', href: '/get-started' },
    { label: 'Sign In', href: '/login' },
  ],
}

const trustBadges = [
  { label: 'SOC 2 Compliant', icon: 'shield' },
  { label: '256-bit Encryption', icon: 'lock' },
  { label: '99.9% Uptime', icon: 'server' },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200/60 bg-white">
      {/* Mini CTA section */}
      <div className="bg-navy-900 relative overflow-hidden">
        {/* Subtle background accents */}
        <div className="absolute -left-32 -top-32 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="absolute -right-32 -bottom-32 h-64 w-64 rounded-full bg-brand-600/8 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Ready to win your next contract?
              </h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-400">
                Join small businesses using RFP Pipeline to discover and win SBIR/STTR opportunities.
              </p>
            </div>
            <div className="flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <Link
                href="/get-started"
                className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-600/25 transition-all duration-200 hover:bg-brand-500 hover:shadow-xl hover:-translate-y-px whitespace-nowrap"
              >
                Join Waitlist
                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                href="/engine"
                className="inline-flex items-center justify-center rounded-xl border border-gray-600 px-6 py-3 text-sm font-semibold text-gray-300 transition-all duration-200 hover:border-gray-500 hover:text-white whitespace-nowrap"
              >
                See the SBIR Engine
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main footer */}
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-4 lg:col-span-5">
            <Link href="/" className="group inline-flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-navy-900 shadow-sm transition-all duration-300 group-hover:shadow-glow">
                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.3" />
                  <circle cx="18" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.3" />
                  <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.3" />
                  <path d="M8.2 7.1L15.8 11M8.2 16.9L15.8 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-navy-900 to-navy-800 bg-clip-text text-transparent">
                RFP Pipeline
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-gray-500">
              The Operating System for Non-Dilutive Funding. Find, decide, and build winning SBIR/STTR proposals.
            </p>
            <p className="mt-3 text-xs font-medium text-brand-600">
              Powered by the SBIR Engine
            </p>
            <div className="mt-5 flex items-center gap-4">
              <a href="mailto:eric@rfppipeline.com" className="group flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-brand-50 hover:text-brand-700">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
                eric@rfppipeline.com
              </a>
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading} className="md:col-span-2 lg:col-span-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">{heading}</h3>
              <ul className="mt-4 space-y-2.5">
                {links.map(link => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-gray-500 transition-colors hover:text-brand-600">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Trust badges */}
        <div className="mt-12 border-t border-gray-100 pt-8">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            {trustBadges.map(badge => (
              <div key={badge.label} className="flex items-center gap-2 text-gray-400">
                {badge.icon === 'shield' && (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                )}
                {badge.icon === 'lock' && (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                )}
                {badge.icon === 'server' && (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
                  </svg>
                )}
                <span className="text-xs font-medium">{badge.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-gray-100">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 sm:flex-row sm:px-6 lg:px-8">
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} RFP Pipeline. All rights reserved. Built in Dayton, Ohio.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/legal/privacy" className="text-xs text-gray-400 transition-colors hover:text-gray-600">
              Privacy
            </Link>
            <Link href="/legal/terms" className="text-xs text-gray-400 transition-colors hover:text-gray-600">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
