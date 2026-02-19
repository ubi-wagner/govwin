/**
 * NextAuth.js v5 (Auth.js) configuration
 * - Email/password via Credentials provider
 * - Magic link via Email provider (Resend or SMTP)
 * - Postgres adapter for session/user storage
 * - Custom session includes role + tenantId
 */
import NextAuth from 'next-auth'
import PostgresAdapter from '@auth/pg-adapter'
import Credentials from 'next-auth/providers/credentials'
import Resend from 'next-auth/providers/resend'
import bcrypt from 'bcryptjs'
import { pool } from '@/lib/db'
import type { AppSession, UserRole } from '@/types'

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

        // Update last_login_at
        await pool.query(
          'UPDATE users SET last_login_at = NOW() WHERE id = $1',
          [user.id]
        )

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

    // ── Magic Link (email) ───────────────────────────────────
    // Uses Resend — swap for Nodemailer if preferred
    Resend({
      from: process.env.EMAIL_FROM ?? 'noreply@yourdomain.com',
    }),
  ],

  callbacks: {
    // Attach role + tenantId to the session object
    async session({ session, user }) {
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
    },
  },

  pages: {
    signIn:  '/login',
    error:   '/login',
  },
})
