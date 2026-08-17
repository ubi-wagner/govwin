'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavLinkVariant = 'portal' | 'admin'

interface NavLinkProps {
  href: string
  children: React.ReactNode
  variant?: NavLinkVariant
  /** Admin variant only: open link in a new tab */
  external?: boolean
}

/**
 * Shared nav link for both the portal sidebar and the admin sidebar.
 *
 * variant="portal" — light sidebar (bg-navy-900 with blue active highlight)
 * variant="admin"  — dark sidebar (bg-navy-900 with blue active highlight)
 *
 * The visual behaviour of the two navbars is identical; the only historical
 * difference was CSS class names, which have been unified here.
 */
export function NavLink({ href, children, variant = 'portal', external = false }: NavLinkProps) {
  const pathname = usePathname()

  // Exact-match for root segments (e.g. /portal, /admin) to avoid matching
  // every sub-route; prefix-match for everything else.
  const rootSegment = variant === 'portal' ? '/portal' : '/admin'
  const isActive = pathname === href || (href !== rootSegment && pathname.startsWith(href))

  if (variant === 'admin' && external) {
    return (
      <a
        href={href}
        className="block px-3 py-1.5 rounded text-sm transition-colors text-slate-300 hover:text-white hover:bg-slate-700"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children} &rarr;
      </a>
    )
  }

  if (variant === 'admin') {
    return (
      <Link
        href={href}
        className={`block px-3 py-1.5 rounded text-sm transition-colors ${
          isActive
            ? 'bg-blue-600 text-white font-medium'
            : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
      >
        {children}
      </Link>
    )
  }

  // portal variant
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        isActive
          ? 'bg-blue-50 text-blue-700 font-medium'
          : 'text-slate-300 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {children}
    </Link>
  )
}
