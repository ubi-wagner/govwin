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
import { ROLES, type Role } from './lib/rbac';

export { ROLES, type Role };

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  tenantId: string | null;
  tenantSlug: string | null;
  passwordHash: string | null;
  isActive: boolean;
  tempPassword: boolean;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  try {
    // LEFT JOIN tenants so the JWT can carry the URL-ready tenant slug
    // alongside the UUID. The /portal dispatcher and role-based landing
    // redirects need the slug, not the UUID, to build
    // /portal/<slug>/dashboard URLs.
    const [row] = await sql<UserRow[]>`
      SELECT u.id, u.email, u.name, u.role, u.tenant_id,
             u.password_hash, u.is_active, u.temp_password,
             t.slug AS tenant_slug
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = ${email.toLowerCase().trim()}
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
          tenantSlug: user.tenantSlug,
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
        token.tenantSlug = (user as { tenantSlug: string | null }).tenantSlug;
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
        (session.user as { tenantSlug?: string | null }).tenantSlug =
          (token.tenantSlug as string | null | undefined) ?? null;
        (session.user as { tempPassword?: boolean }).tempPassword =
          (token.tempPassword as boolean | undefined) ?? false;
      }
      return session;
    },
  },
});
