/**
 * NextAuth v5 configuration — full Node-runtime version.
 *
 * This file imports the edge-safe base config from `auth.config.ts`
 * and merges in the Credentials provider (which needs `lib/db` and
 * `bcryptjs`, neither of which are Edge-compatible).
 *
 * Middleware does NOT import this file directly — see `middleware.ts`
 * and `auth.config.ts` for the edge-safe split.
 *
 * See docs/DECISIONS.md D001 and D004.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { authConfig } from './auth.config';
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
  ...authConfig,
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
        if (!ok) {
          try {
            await sql`
              INSERT INTO system_events (namespace, type, phase, actor_type, actor_id, actor_email, payload)
              VALUES ('identity', 'user.login_failed', 'single', 'system', 'auth', ${email},
                      ${JSON.stringify({ correlationId: crypto.randomUUID() })}::jsonb)
            `;
          } catch { /* non-critical */ }
          return null;
        }

        await touchLastLogin(user.id);

        try {
          await sql`
            INSERT INTO system_events (namespace, type, phase, actor_type, actor_id, actor_email, payload)
            VALUES ('identity', 'user.logged_in', 'single', 'user', ${user.id}, ${user.email},
                    ${JSON.stringify({ correlationId: crypto.randomUUID() })}::jsonb)
          `;
        } catch { /* non-critical */ }

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
});
