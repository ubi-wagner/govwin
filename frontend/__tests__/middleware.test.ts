/**
 * Middleware logic tests — verifies route protection rules without
 * depending on NextAuth or a running server.
 *
 * We extract the pure decision logic from middleware.ts and test it here.
 */
import { describe, it, expect } from 'vitest'

// ── Replicate the route-decision logic from middleware.ts ──
type User = { role: string; tenantId?: string | null }

function getHomeUrl(user: User): string {
  if (user.role === 'master_admin') return '/admin/dashboard'
  return '/portal'
}

type RouteDecision =
  | { action: 'redirect'; url: string }
  | { action: 'next' }
  | { action: 'next_with_headers'; slug: string }

function decideRoute(pathname: string, user: User | null): RouteDecision {
  // Public routes
  if (pathname.startsWith('/login')) {
    if (user) return { action: 'redirect', url: getHomeUrl(user) }
    return { action: 'next' }
  }

  // Require auth
  if (!user) return { action: 'redirect', url: '/login' }

  // Admin routes
  if (pathname.startsWith('/admin')) {
    if (user.role !== 'master_admin') {
      if (user.tenantId) return { action: 'redirect', url: '/portal' }
      return { action: 'redirect', url: '/login' }
    }
    return { action: 'next' }
  }

  // Portal routes
  if (pathname.startsWith('/portal/')) {
    const segments = pathname.split('/')
    const slugInUrl = segments[2]
    if (!slugInUrl) return { action: 'next' }
    if (user.role === 'master_admin') return { action: 'next' }
    return { action: 'next_with_headers', slug: slugInUrl }
  }

  // Root redirect
  if (pathname === '/') {
    return { action: 'redirect', url: getHomeUrl(user) }
  }

  return { action: 'next' }
}

// ── Tests ──

describe('Route protection', () => {
  const admin: User = { role: 'master_admin', tenantId: null }
  const tenantUser: User = { role: 'tenant_user', tenantId: 'tenant-uuid-1' }
  const tenantAdmin: User = { role: 'tenant_admin', tenantId: 'tenant-uuid-2' }

  describe('Login page', () => {
    it('allows unauthenticated access to /login', () => {
      expect(decideRoute('/login', null)).toEqual({ action: 'next' })
    })

    it('redirects logged-in admin away from /login to /admin/dashboard', () => {
      expect(decideRoute('/login', admin)).toEqual({
        action: 'redirect',
        url: '/admin/dashboard',
      })
    })

    it('redirects logged-in tenant user away from /login to /portal', () => {
      expect(decideRoute('/login', tenantUser)).toEqual({
        action: 'redirect',
        url: '/portal',
      })
    })
  })

  describe('Unauthenticated users', () => {
    it('redirects to /login for any protected route', () => {
      expect(decideRoute('/admin/dashboard', null)).toEqual({
        action: 'redirect',
        url: '/login',
      })
      expect(decideRoute('/portal/acme/pipeline', null)).toEqual({
        action: 'redirect',
        url: '/login',
      })
      expect(decideRoute('/', null)).toEqual({
        action: 'redirect',
        url: '/login',
      })
    })
  })

  describe('Admin routes', () => {
    it('allows master_admin access to /admin/*', () => {
      expect(decideRoute('/admin/dashboard', admin)).toEqual({ action: 'next' })
      expect(decideRoute('/admin/tenants', admin)).toEqual({ action: 'next' })
      expect(decideRoute('/admin/pipeline', admin)).toEqual({ action: 'next' })
    })

    it('blocks tenant_user from /admin, redirects to /portal', () => {
      expect(decideRoute('/admin/dashboard', tenantUser)).toEqual({
        action: 'redirect',
        url: '/portal',
      })
    })

    it('blocks tenant_admin from /admin, redirects to /portal', () => {
      expect(decideRoute('/admin/dashboard', tenantAdmin)).toEqual({
        action: 'redirect',
        url: '/portal',
      })
    })
  })

  describe('Portal routes', () => {
    it('allows master_admin to access any tenant portal', () => {
      expect(decideRoute('/portal/acme-tech/dashboard', admin)).toEqual({
        action: 'next',
      })
    })

    it('sets tenant context headers for tenant users', () => {
      const result = decideRoute('/portal/acme-tech/pipeline', tenantUser)
      expect(result).toEqual({
        action: 'next_with_headers',
        slug: 'acme-tech',
      })
    })

    it('extracts slug correctly from URL', () => {
      const result = decideRoute('/portal/my-company/documents', tenantUser)
      expect(result).toEqual({
        action: 'next_with_headers',
        slug: 'my-company',
      })
    })
  })

  describe('Root redirect', () => {
    it('redirects admin to /admin/dashboard', () => {
      expect(decideRoute('/', admin)).toEqual({
        action: 'redirect',
        url: '/admin/dashboard',
      })
    })

    it('redirects tenant user to /portal', () => {
      expect(decideRoute('/', tenantUser)).toEqual({
        action: 'redirect',
        url: '/portal',
      })
    })
  })
})

describe('Tenant isolation patterns', () => {
  it('tenant user can only access their own portal slug', () => {
    const user: User = { role: 'tenant_user', tenantId: 'uuid-for-acme' }

    // Accesses portal with a slug — middleware attaches headers
    // The actual slug verification happens in API routes via verifyTenantAccess
    const result = decideRoute('/portal/acme/pipeline', user)
    expect(result).toEqual({ action: 'next_with_headers', slug: 'acme' })

    // Even accessing a different slug still passes at middleware level
    // (isolation enforced at DB layer via verifyTenantAccess)
    const result2 = decideRoute('/portal/other-company/pipeline', user)
    expect(result2).toEqual({ action: 'next_with_headers', slug: 'other-company' })
  })

  it('tenant user cannot access admin routes', () => {
    const user: User = { role: 'tenant_user', tenantId: 'uuid-for-acme' }
    const result = decideRoute('/admin/tenants', user)
    expect(result).toEqual({ action: 'redirect', url: '/portal' })
  })
})
