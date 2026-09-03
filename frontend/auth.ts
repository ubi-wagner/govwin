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

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
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
                      ${sql.json({ correlationId: crypto.randomUUID() })})
            `;
          } catch { /* non-critical */ }
          return null;
        }

        await touchLastLogin(user.id);

        try {
          await sql`
            INSERT INTO system_events (namespace, type, phase, actor_type, actor_id, actor_email, payload)
            VALUES ('identity', 'user.logged_in', 'single', 'user', ${user.id}, ${user.email},
                    ${sql.json({ userId: user.id, correlationId: crypto.randomUUID() })})
          `;
          // ^ userId in the PAYLOAD (not just actor_id) is load-bearing: the
          // OnApplicationAccepted HITL gate waits for user.logged_in and resumes
          // via manager._event_correlates, which keys on payload.userId. Without it
          // the login shares no correlation key with the parked onboarding instance
          // and ANY user's login would resume ANY waiting gate (fail-open).
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

  /**
   * SIGNING OUT ENDS EVERY BRACKET — from wherever it happens.
   *
   * The four in-product exits (pressing exit, turning up outside, moving to another company, the
   * idle sweep) all assume the person is still driving the product. Sign-out is the one that does
   * not, and it can be pressed from INSIDE a customer's workspace — which is exactly where it
   * matters, because at that instant the actor is unambiguously gone.
   *
   * Without this, a shadow admin who signed out of a customer's portal left the bracket open until
   * the hourly sweep noticed, so that company's audit trail asserted an administrator was in their
   * workspace at a moment when they had demonstrably logged out. That is worse than a missing
   * record: it is a confident wrong one.
   *
   * Closes ALL open brackets, with no `except` — including the space they first landed in. There is
   * no "current tenant" to preserve once the session is over.
   *
   * SESSION EXPIRY has no hook here and deliberately gets none: nothing fires when a JWT quietly
   * expires, because there is no request to observe. The sweep's `timeout` is the honest record of
   * that — "we stopped seeing them" — and inventing an `expired` reason would assert a moment
   * nobody measured.
   *
   * Best-effort and never throwing: a failure here must not be able to prevent somebody signing
   * out. The sweep remains the backstop.
   */
  events: {
    async signOut(message) {
      try {
        const token = (message as { token?: { sub?: string; email?: string } }).token;
        const id = token?.sub;
        if (!id) return;
        const { closePresence } = await import('@/lib/space-presence');
        await closePresence({ id, email: token?.email ?? null }, 'signed_out');
      } catch (e) {
        console.error('[auth] signOut presence close failed:', e);
      }
    },
  },
});
