'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function AdminNavLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  const pathname = usePathname()
  const isActive = pathname === href || (href !== '/admin' && pathname.startsWith(href))

  if (external) {
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
