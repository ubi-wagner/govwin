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
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [], // Credentials provider is added in auth.ts
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: copy the custom fields from the authorize()
      // return value onto the token so they persist across requests.
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: Role }).role;
        token.tenantId = (user as { tenantId: string | null }).tenantId;
        token.tenantSlug = (user as { tenantSlug: string | null }).tenantSlug;
        token.tempPassword = (user as { tempPassword: boolean }).tempPassword;
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
      }
      return session;
    },
  },
};
