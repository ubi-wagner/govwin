import Link from 'next/link'

const footerLinks = {
  Product: [
    { label: 'About RFP Finder', href: '/about' },
    { label: 'Tips & Tools', href: '/tips' },
    { label: 'Customer Wins', href: '/customers' },
    { label: 'News', href: '/announcements' },
  ],
  Company: [
    { label: 'Our Team', href: '/team' },
    { label: 'Contact', href: '/about#contact' },
    { label: 'Sign In', href: '/login' },
  ],
}

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </div>
              <span className="text-lg font-bold text-gray-900">RFP Finder</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-gray-500">
              AI-powered government opportunity intelligence. Find, score, and win federal contracts with confidence.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="text-sm font-semibold text-gray-900">{heading}</h3>
              <ul className="mt-3 space-y-2">
                {links.map(link => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-gray-100 pt-6">
          <p className="text-center text-xs text-gray-400">
            &copy; {new Date().getFullYear()} RFP Finder. All rights reserved. Built in Dayton, Ohio.
          </p>
        </div>
      </div>
    </footer>
  )
}
