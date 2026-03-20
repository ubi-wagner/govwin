/**
 * NextAuth.js v5 (Auth.js) configuration
 * - Email/password via Credentials provider
 * - Postgres adapter for session/user storage
 * - Custom session includes role + tenantId
 */
import NextAuth from 'next-auth'
import PostgresAdapter from '@auth/pg-adapter'
import Credentials from 'next-auth/providers/credentials'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import type { AppSession, UserRole } from '@/types'

// Separate pg Pool for Auth.js adapter (uses callback-style, not postgres.js)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),

  session: {
    strategy: 'database',   // Sessions stored in Postgres (not JWT)
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

        const result = await pool.query(
          'SELECT id, email, name, password_hash, role, tenant_id, is_active, temp_password FROM users WHERE email = $1',
          [credentials.email]
        )

        const user = result.rows[0]
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
  ],

  callbacks: {
    // Attach role + tenantId to the session object
    async session({ session, user }) {
      try {
        const result = await pool.query(
          'SELECT role, tenant_id, temp_password FROM users WHERE id = $1',
          [user.id]
        )
        const dbUser = result.rows[0]

        return {
          ...session,
          user: {
            ...session.user,
            id:          user.id,
            role:        dbUser?.role as UserRole ?? 'tenant_user',
            tenantId:    dbUser?.tenant_id ?? null,
            tempPassword: dbUser?.temp_password ?? false,
          },
        } as AppSession
      } catch (e) {
        console.error('[auth] Session callback DB error:', e)
        return {
          ...session,
          user: {
            ...session.user,
            id:          user.id,
            role:        'tenant_user' as UserRole,
            tenantId:    null,
            tempPassword: false,
          },
        } as AppSession
      }
    },
  },

  pages: {
    signIn:  '/login',
    error:   '/login',
  },
})
