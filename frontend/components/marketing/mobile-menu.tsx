'use client'
import { useState } from 'react'
import Link from 'next/link'

interface NavLink {
  href: string
  label: string
  children?: NavLink[]
}

export function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-navy-600 hover:text-navy-900"
        aria-label="Toggle menu"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 bg-white border-b border-cream-200 shadow-lg z-50">
          <nav className="flex flex-col p-4 gap-1">
            {links.map((link) =>
              link.children ? (
                <div key={link.label}>
                  <button
                    onClick={() =>
                      setExpandedGroup(expandedGroup === link.label ? null : link.label)
                    }
                    className="flex items-center justify-between w-full px-3 py-2 rounded text-sm font-medium text-navy-700 hover:bg-cream-50"
                  >
                    {link.label}
                    <svg
                      className={`w-4 h-4 text-navy-400 transition-transform ${
                        expandedGroup === link.label ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  {expandedGroup === link.label && (
                    <div className="ml-3 border-l border-cream-200 pl-2">
                      {link.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => setOpen(false)}
                          className="block px-3 py-2 rounded text-sm text-navy-600 hover:bg-cream-50 hover:text-brand-600"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 rounded text-sm text-navy-700 hover:bg-cream-50 hover:text-brand-600"
                >
                  {link.label}
                </Link>
              ),
            )}
            <div className="border-t border-cream-100 mt-2 pt-2 flex flex-col gap-1">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded text-sm font-medium text-navy-700 border border-navy-200 text-center"
              >
                Login
              </Link>
              <Link
                href="/apply"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded text-sm font-medium bg-brand-500 text-white text-center"
              >
                Apply Now
              </Link>
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}
