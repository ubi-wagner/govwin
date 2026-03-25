import Link from 'next/link'

const footerLinks = {
  Platform: [
    { label: 'How It Works', href: '/about' },
    { label: 'Pricing', href: '/get-started' },
    { label: 'Customer Wins', href: '/customers' },
    { label: 'Tips & Tools', href: '/tips' },
  ],
  Company: [
    { label: 'About', href: '/about' },
    { label: 'Our Team', href: '/team' },
    { label: 'News', href: '/announcements' },
    { label: 'Contact', href: '/about#contact' },
  ],
  Resources: [
    { label: 'SBIR/STTR Guide', href: '/tips' },
    { label: 'SAM.gov Checklist', href: '/tips' },
    { label: 'Capability Statement', href: '/tips' },
    { label: 'Sign In', href: '/login' },
  ],
}

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200/60 bg-white">
      {/* Main footer */}
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-4 lg:col-span-5">
            <Link href="/" className="group inline-flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 shadow-sm">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </div>
              <span className="text-lg font-bold text-gray-900">RFP Pipeline</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-gray-500">
              AI-powered government opportunity intelligence. Find, score, and win federal contracts with confidence.
            </p>
            <div className="mt-6 flex items-center gap-4">
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
