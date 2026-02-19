/**
 * Next.js middleware — runs on every request before rendering
 *
 * Route protection:
 *   /login            → public (redirect to home if already authed)
 *   /admin/**         → master_admin only
 *   /portal/[slug]/** → tenant users whose tenant matches slug
 *                       OR master_admin (can view any tenant)
 *   /**               → authenticated users only
 *
 * This is the security boundary. The DB queries in API routes
 * also enforce tenant isolation, but middleware is the first gate.
 */
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export default auth(async function middleware(req: NextRequest & { auth: any }) {
  const { pathname } = req.nextUrl
  const session = req.auth

  // ── Public routes ──────────────────────────────────────────
  if (pathname.startsWith('/login')) {
    // Already logged in → redirect to appropriate home
    if (session?.user) {
      return NextResponse.redirect(new URL(getHomeUrl(session.user), req.url))
    }
    return NextResponse.next()
  }

  // ── All other routes require authentication ────────────────
  if (!session?.user) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const { role, tenantId } = session.user

  // ── Admin routes: master_admin only ───────────────────────
  if (pathname.startsWith('/admin')) {
    if (role !== 'master_admin') {
      // Tenant users trying to access admin → send to their portal
      if (tenantId) {
        // Would need tenant slug here — redirect to portal root
        return NextResponse.redirect(new URL('/portal', req.url))
      }
      return NextResponse.redirect(new URL('/login', req.url))
    }
    return NextResponse.next()
  }

  // ── Portal routes: tenant access control ──────────────────
  if (pathname.startsWith('/portal/')) {
    const segments = pathname.split('/')
    const slugInUrl = segments[2]  // /portal/[tenantSlug]/...

    if (!slugInUrl) return NextResponse.next()

    // Master admin can view any tenant's portal
    if (role === 'master_admin') return NextResponse.next()

    // Non-admin users must belong to a tenant
    if (!tenantId) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    // Note: slug-to-tenantId verification happens in API routes via
    // verifyTenantAccess(). Middleware cannot do DB lookups on Edge runtime.
    // Page shells are accessible but data fetches are tenant-isolated.
    const response = NextResponse.next()
    response.headers.set('x-tenant-id', tenantId)
    return response
  }

  // ── Root redirect ──────────────────────────────────────────
  if (pathname === '/') {
    return NextResponse.redirect(new URL(getHomeUrl(session.user), req.url))
  }

  return NextResponse.next()
})

function getHomeUrl(user: { role: string; tenantId?: string | null }): string {
  if (user.role === 'master_admin') return '/admin/dashboard'
  // Portal home: need tenant slug — handled by portal root page
  return '/portal'
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}
