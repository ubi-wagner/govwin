/**
 * NextAuth.js v5 (Auth.js) configuration
 * - Email/password via Credentials provider
 * - JWT strategy (required for Credentials; also works with OAuth providers)
 * - Postgres adapter kept for OAuth user storage (Google login planned)
 * - Custom JWT/session includes role + tenantId
 */
import NextAuth from 'next-auth'
import PostgresAdapter from '@auth/pg-adapter'
import Credentials from 'next-auth/providers/credentials'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import type { AppSession, UserRole } from '@/types'

// Separate pg Pool for Auth.js adapter (uses callback-style, not postgres.js)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
pool.on('error', (err) => {
  console.error('[auth] Unexpected pool error:', err)
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Trust the host header behind Railway/Vercel reverse proxy
  trustHost: true,

  // Adapter retained for OAuth providers (Google) — stores users/accounts in PG
  adapter: PostgresAdapter(pool),

  session: {
    strategy: 'jwt',   // JWT required for Credentials provider; works with OAuth too
    maxAge: 30 * 24 * 60 * 60,  // 30 days
  },

  providers: [
    // ── Email/Password ──────────────────────────────────────
    Credentials({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        let user: any
        try {
          const result = await pool.query(
            'SELECT id, email, name, password_hash, role, tenant_id, is_active, temp_password FROM users WHERE email = $1',
            [credentials.email]
          )
          user = result.rows[0]
        } catch (e) {
          console.error('[auth] authorize DB query failed:', e)
          return null
        }

        if (!user || !user.is_active) return null

        const valid = await bcrypt.compare(credentials.password as string, user.password_hash)
        if (!valid) return null

        // Update last_login_at (non-critical — don't block login on failure)
        try {
          await pool.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1',
            [user.id]
          )
        } catch (e) {
          console.error('[auth] Failed to update last_login_at:', e)
        }

        return {
          id:          user.id,
          email:       user.email,
          name:        user.name,
          role:        user.role,
          tenantId:    user.tenant_id,
          tempPassword: user.temp_password,
        }
      },
    }),
    // Google OAuth not used — tenants authenticate via email/password only.
    // Drive integration uses a service account with domain-wide delegation.
  ],

  callbacks: {
    // Encode custom fields into the JWT on sign-in and on every token refresh
    async jwt({ token, user }) {
      // `user` is only present on initial sign-in
      if (user) {
        token.id           = user.id
        token.role         = (user as any).role
        token.tenantId     = (user as any).tenantId
        token.tempPassword = (user as any).tempPassword
      }

      // For OAuth users whose role/tenantId aren't set by authorize(),
      // look them up from the DB on first sign-in
      if (user && !token.role) {
        try {
          const result = await pool.query(
            'SELECT role, tenant_id, temp_password FROM users WHERE id = $1',
            [user.id]
          )
          const dbUser = result.rows[0]
          if (dbUser) {
            token.role         = dbUser.role
            token.tenantId     = dbUser.tenant_id
            token.tempPassword = dbUser.temp_password
          }
        } catch (e) {
          console.error('[auth] JWT callback DB lookup error:', e)
        }
      }

      return token
    },

    // Populate the session from the JWT (no DB call needed on every request)
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id:          token.id as string,
          role:        (token.role as UserRole) ?? 'tenant_user',
          tenantId:    (token.tenantId as string) ?? null,
          tempPassword: (token.tempPassword as boolean) ?? false,
        },
      } as AppSession
    },
  },

  pages: {
    signIn:  '/login',
    error:   '/login',
  },
})
