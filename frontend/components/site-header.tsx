'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'

const navLinks = [
  { href: '/engine', label: 'SBIR Engine' },
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
]

const resourceLinks = [
  { href: '/happenings', label: 'Happenings', description: 'Updates, tips, and SBIR strategy', icon: 'megaphone' },
  { href: '/customers', label: 'Customer Stories', description: 'Teams using RFP Pipeline to win', icon: 'trophy' },
  { href: '/team', label: 'Our Team', description: 'Meet the people behind the SBIR Engine', icon: 'people' },
  { href: '/tips', label: 'Tips & Tools', description: 'SBIR guides and checklists', icon: 'book' },
]

const resourceIcons: Record<string, React.ReactNode> = {
  book: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  trophy: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m4.644-9.492a6.003 6.003 0 0 1-1.194 3.972" />
    </svg>
  ),
  megaphone: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
    </svg>
  ),
  people: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  ),
}

export function SiteHeader() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const resourcesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
    setResourcesOpen(false)
  }, [pathname])

  // Close resources dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (resourcesRef.current && !resourcesRef.current.contains(event.target as Node)) {
        setResourcesOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <>
      {/* Announcement bar */}
      <div className="relative z-50 bg-navy-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium sm:px-6 lg:px-8">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-subtle" />
          <span className="text-gray-300">
            We built it so you don&apos;t have to — start your free trial
          </span>
          <Link href="/get-started" className="ml-1 inline-flex items-center gap-0.5 font-semibold text-brand-400 hover:text-brand-300 transition-colors">
            Get started
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </div>

      <header
        className={clsx(
          'sticky top-0 z-40 transition-all duration-300',
          scrolled
            ? 'bg-white/80 backdrop-blur-xl shadow-sm border-b border-gray-200/60'
            : 'bg-white/60 backdrop-blur-md border-b border-transparent'
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo — pipeline flow mark + bold wordmark */}
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-navy-900 shadow-sm transition-all duration-300 group-hover:shadow-glow group-hover:scale-105">
              {/* Stylized pipeline icon — three connected nodes */}
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.3" />
                <circle cx="18" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.3" />
                <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.3" />
                <path d="M8.2 7.1L15.8 11M8.2 16.9L15.8 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-extrabold leading-tight tracking-tight bg-gradient-to-r from-navy-900 to-navy-800 bg-clip-text text-transparent">
                RFP Pipeline
              </span>
            </div>
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

            {/* Resources dropdown */}
            <div ref={resourcesRef} className="relative">
              <button
                onClick={() => setResourcesOpen(!resourcesOpen)}
                className={clsx(
                  'relative flex items-center gap-1 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200',
                  resourcesOpen
                    ? 'text-brand-700 bg-gray-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                )}
              >
                Resources
                <svg
                  className={clsx('h-3.5 w-3.5 transition-transform duration-200', resourcesOpen && 'rotate-180')}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {/* Dropdown panel */}
              <div
                className={clsx(
                  'absolute right-0 top-full mt-2 w-80 rounded-xl border border-gray-200/80 bg-white/95 backdrop-blur-xl p-2 shadow-elevated transition-all duration-200 origin-top-right',
                  resourcesOpen
                    ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
                    : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
                )}
              >
                {resourceLinks.map((link, i) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group/item flex items-start gap-3 rounded-lg px-3 py-3 transition-all duration-150 hover:bg-brand-50/60"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition-colors group-hover/item:bg-brand-100 group-hover/item:text-brand-600">
                      {resourceIcons[link.icon]}
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{link.label}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">{link.description}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </nav>

          {/* CTA */}
          <div className="hidden items-center gap-3 md:flex">
            <Link href="/login" className="btn-ghost px-4 py-2 text-sm">
              Sign in
            </Link>
            <Link
              href="/get-started"
              className="group relative inline-flex items-center justify-center overflow-hidden rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 hover:shadow-md hover:-translate-y-px"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-brand-600 bg-[length:200%_100%] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:animate-gradient-x" />
              <span className="relative flex items-center">
                Start Free
                <svg
                  className="ml-1.5 h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="relative rounded-xl p-2.5 text-gray-600 hover:bg-gray-100 transition-colors md:hidden"
            aria-label="Toggle menu"
          >
            <div className="relative h-5 w-5">
              <span
                className={clsx(
                  'absolute left-0 top-[4px] h-[1.5px] w-5 rounded-full bg-current transition-all duration-300',
                  mobileOpen && 'top-[10px] rotate-45'
                )}
              />
              <span
                className={clsx(
                  'absolute left-0 top-[10px] h-[1.5px] w-5 rounded-full bg-current transition-all duration-300',
                  mobileOpen && 'opacity-0 scale-x-0'
                )}
              />
              <span
                className={clsx(
                  'absolute left-0 top-[16px] h-[1.5px] w-5 rounded-full bg-current transition-all duration-300',
                  mobileOpen && 'top-[10px] -rotate-45'
                )}
              />
            </div>
          </button>
        </div>

        {/* Mobile menu — animated slide-down with backdrop */}
        <div
          className={clsx(
            'grid transition-all duration-300 ease-out md:hidden',
            mobileOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-gray-100 bg-white/95 backdrop-blur-xl px-4 pb-6 pt-4">
              <nav className="space-y-1">
                {navLinks.map((link, i) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={clsx(
                      'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 animate-slide-up',
                      pathname === link.href
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-gray-600 hover:bg-gray-50 active:bg-gray-100'
                    )}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    {link.label}
                    {pathname === link.href && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-600" />
                    )}
                  </Link>
                ))}

                {/* Resources section in mobile */}
                <div className="pt-3 pb-1">
                  <p className="px-4 text-xs font-bold uppercase tracking-wider text-gray-400">Resources</p>
                </div>
                {resourceLinks.map((link, i) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={clsx(
                      'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 animate-slide-up',
                      pathname === link.href
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-gray-600 hover:bg-gray-50 active:bg-gray-100'
                    )}
                    style={{ animationDelay: `${(navLinks.length + i + 1) * 60}ms` }}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                      {resourceIcons[link.icon]}
                    </span>
                    <div>
                      <span className="block">{link.label}</span>
                      <span className="block text-xs text-gray-400 font-normal">{link.description}</span>
                    </div>
                  </Link>
                ))}
              </nav>
              <div className="mt-5 flex flex-col gap-2.5 border-t border-gray-100 pt-5">
                <Link href="/login" className="btn-secondary text-center text-sm">
                  Sign in
                </Link>
                <Link href="/get-started" className="btn-primary text-center text-sm font-bold">
                  Start Free
                  <svg className="ml-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </header>
    </>
  )
}
