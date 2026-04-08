/**
 * NextAuth v5 configuration — credentials provider backed by our
 * users table. No pg adapter is used because we issue JWT sessions
 * (not database sessions), which avoids a session table on every
 * request and matches how the middleware checks the token.
 *
 * Role hierarchy is enforced centrally in middleware.ts and in
 * lib/rbac.ts. This file's only job is to authenticate the user
 * and stamp the minimum set of claims (id, email, role, tenantId,
 * tempPassword) onto the JWT.
 *
 * See docs/DECISIONS.md D001 and D004.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { sql } from './lib/db';

export const ROLES = [
  'master_admin',
  'rfp_admin',
  'tenant_admin',
  'tenant_user',
  'partner_user',
] as const;
export type Role = (typeof ROLES)[number];

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  tenantId: string | null;
  passwordHash: string | null;
  isActive: boolean;
  tempPassword: boolean;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  try {
    const [row] = await sql<UserRow[]>`
      SELECT id, email, name, role, tenant_id, password_hash, is_active, temp_password
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;
    return row ?? null;
  } catch (e) {
    console.error('[auth.findUserByEmail] db error', String(e));
    return null;
  }
}

async function touchLastLogin(userId: string): Promise<void> {
  try {
    await sql`UPDATE users SET last_login_at = now() WHERE id = ${userId}`;
  } catch (e) {
    // Non-critical — don't fail login on a last_login_at update error.
    console.error('[auth.touchLastLogin] update failed', String(e));
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
          return null;
        }
        if (!email || !password) return null;

        const user = await findUserByEmail(email);
        if (!user) return null;
        if (!user.isActive) return null;
        if (!user.passwordHash) return null;

        let ok = false;
        try {
          ok = await bcrypt.compare(password, user.passwordHash);
        } catch (e) {
          console.error('[auth.authorize] bcrypt error', String(e));
          return null;
        }
        if (!ok) return null;

        await touchLastLogin(user.id);

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
          tenantId: user.tenantId,
          tempPassword: user.tempPassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: Role }).role;
        token.tenantId = (user as { tenantId: string | null }).tenantId;
        token.tempPassword = (user as { tempPassword: boolean }).tempPassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string | undefined;
        (session.user as { role?: Role }).role = token.role as Role | undefined;
        (session.user as { tenantId?: string | null }).tenantId =
          (token.tenantId as string | null | undefined) ?? null;
        (session.user as { tempPassword?: boolean }).tempPassword =
          (token.tempPassword as boolean | undefined) ?? false;
      }
      return session;
    },
  },
});
