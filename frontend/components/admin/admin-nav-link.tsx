'use client'

// Re-exported from the shared NavLink component (FE-17 consolidation).
// Import sites that use '@/components/admin/admin-nav-link' continue to work.
import { NavLink, type NavLinkVariant } from '@/components/nav-link'
import type { ReactNode } from 'react'

export function AdminNavLink({
  href,
  children,
  external,
}: {
  href: string
  children: ReactNode
  external?: boolean
}) {
  return <NavLink href={href} variant="admin" external={external}>{children}</NavLink>
}

export type { NavLinkVariant }
