'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
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
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  return (
    <header
      className={clsx(
        'sticky top-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-white/95 backdrop-blur-xl shadow-sm border-b border-gray-200/60'
          : 'bg-white/70 backdrop-blur-md border-b border-transparent'
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 shadow-sm transition-all duration-300 group-hover:shadow-glow group-hover:scale-105">
            <svg className="h-4.5 w-4.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </div>
          <span className="text-lg font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
            RFP Finder
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-0.5 md:flex">
          {navLinks.map(link => {
            const isActive = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'relative rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'text-brand-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                )}
              >
                {link.label}
                {isActive && (
                  <span className="absolute inset-x-2 -bottom-[1.15rem] h-0.5 rounded-full bg-brand-600" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* CTA */}
        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login" className="btn-ghost px-4 py-2 text-sm">
            Sign in
          </Link>
          <Link href="/get-started" className="btn-primary text-sm">
            Get Started
            <svg className="ml-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-xl p-2.5 text-gray-600 hover:bg-gray-100 transition-colors md:hidden"
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
        <div className="border-t border-gray-100 bg-white px-4 pb-5 pt-3 md:hidden animate-fade-in-down">
          <nav className="space-y-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'block rounded-xl px-4 py-2.5 text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4">
            <Link href="/login" className="btn-secondary text-center text-sm">
              Sign in
            </Link>
            <Link href="/get-started" className="btn-primary text-center text-sm">
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
