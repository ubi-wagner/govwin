'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { clsx } from 'clsx'

const navLinks = [
  { href: '/about', label: 'About' },
  { href: '/customers', label: 'Customer Wins' },
  { href: '/tips', label: 'Tips & Tools' },
  { href: '/announcements', label: 'News' },
  { href: '/team', label: 'Our Team' },
]

export function SiteHeader() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-gray-900">RFP Finder</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname === link.href
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">
            Sign in
          </Link>
          <Link href="/about#contact" className="btn-primary text-sm">
            Get Started
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden"
          aria-label="Toggle menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-gray-200 bg-white px-4 pb-4 pt-2 md:hidden">
          {navLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={clsx(
                'block rounded-lg px-3 py-2 text-sm font-medium',
                pathname === link.href
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3">
            <Link href="/login" className="btn-secondary text-center text-sm" onClick={() => setMobileOpen(false)}>
              Sign in
            </Link>
            <Link href="/about#contact" className="btn-primary text-center text-sm" onClick={() => setMobileOpen(false)}>
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
