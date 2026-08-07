/**
 * NextAuth v5 edge-safe configuration.
 *
 * This file is imported by BOTH `auth.ts` (the full Node-runtime
 * config with the Credentials provider and DB lookups) AND
 * `middleware.ts` (which runs on the Edge runtime and cannot import
 * the `postgres` client or `bcryptjs`).
 *
 * Everything in this file MUST work in the Edge runtime:
 *   - No DB imports (postgres, pg, etc.)
 *   - No Node crypto imports (bcryptjs uses Node APIs)
 *   - No file system access
 *
 * The JWT and session callbacks live here because they need to run
 * in both contexts. The Credentials provider (which DOES need the DB
 * and bcrypt) lives in auth.ts and is merged into the final NextAuth
 * instance there.
 *
 * Why the split exists: NextAuth v5's middleware integration uses
 * the `auth()` wrapper, which must be edge-compatible. If middleware
 * imported `auth.ts` directly it would pull in `postgres` via
 * `lib/db.ts`, which uses Node's `net` and `tls` modules and
 * immediately breaks the Edge build. This was the root cause of the
 * login → /portal → /login redirect loop — the previous middleware
 * worked around the edge-import problem by calling v4-style
 * `getToken({ req, secret })` from `next-auth/jwt`, which can't
 * decrypt NextAuth v5's JWE session tokens, so it silently returned
 * null and the middleware thought every request was unauthenticated
 * even when the pages' `auth()` call succeeded.
 *
 * See https://authjs.dev/guides/edge-compatibility for the canonical
 * split pattern.
 */
import type { NextAuthConfig } from 'next-auth';
import type { Role } from './lib/rbac';

export const authConfig: NextAuthConfig = {
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: '/login',
  },
  providers: [], // Credentials provider is added in auth.ts
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // First sign-in: copy the custom fields from the authorize()
      // return value onto the token so they persist across requests.
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: Role }).role;
        token.tenantId = (user as { tenantId: string | null }).tenantId;
        token.tenantSlug = (user as { tenantSlug: string | null }).tenantSlug;
        token.tempPassword = (user as { tempPassword: boolean }).tempPassword;
        // Fresh login → not yet committed to a company. A multi-membership user is
        // routed to /select-company to pick (which pins); single-membership users
        // never see it. Singular-session enforcement, see
        // docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
        token.membershipPinned = false;
        // Set only while a partner-manager is DESCENDED into one of their companies
        // (their real base role, so the portal chrome can offer "Exit to console" and
        // the console can auto-ascend). Null when not descended. See PARTNER_MANAGER_DESIGN §3b.
        token.partnerHomeRole = null;
      }
      // Membership selection: the /select-company server action calls unstable_update
      // to REWRITE the active company + role onto the token, so every downstream reader
      // (portal layout, all portal API routes, middleware) authorizes off the SELECTED
      // membership — not the home role. This is what caps a tenant_admin-at-home to
      // partner_user when they act as a collaborator elsewhere. The data is
      // server-produced (validated membership) but we still narrow it defensively.
      if (trigger === 'update' && session && typeof session === 'object') {
        const su = (session as { user?: Record<string, unknown> }).user;
        if (su && typeof su === 'object') {
          if (typeof su.role === 'string') token.role = su.role as Role;
          if ('tenantId' in su) token.tenantId = (su.tenantId as string | null) ?? null;
          if ('tenantSlug' in su) token.tenantSlug = (su.tenantSlug as string | null) ?? null;
          // Partner descend sets this to the partner's real base role; ascend clears it (null).
          if ('partnerHomeRole' in su) token.partnerHomeRole = (su.partnerHomeRole as string | null) ?? null;
          token.membershipPinned = true;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Expose token claims on session.user so server components and
      // API routes can read them via `(await auth()).user`.
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string | undefined;
        (session.user as { role?: Role }).role = token.role as Role | undefined;
        (session.user as { tenantId?: string | null }).tenantId =
          (token.tenantId as string | null | undefined) ?? null;
        (session.user as { tenantSlug?: string | null }).tenantSlug =
          (token.tenantSlug as string | null | undefined) ?? null;
        (session.user as { tempPassword?: boolean }).tempPassword =
          (token.tempPassword as boolean | undefined) ?? false;
        // Whether this session has committed to a company (singular-session pin).
        (session.user as { membershipPinned?: boolean }).membershipPinned =
          (token.membershipPinned as boolean | undefined) ?? false;
        // Set only while a partner-manager is descended into a company (their real base role).
        (session.user as { partnerHomeRole?: string | null }).partnerHomeRole =
          (token.partnerHomeRole as string | null | undefined) ?? null;
      }
      return session;
    },
  },
};
