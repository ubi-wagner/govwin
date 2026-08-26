/**
 * Resolve a drive's actor from the database, and refuse to continue if the login did not take.
 *
 * TWO DEFECTS IN THE DRIVE ESTATE, BOTH OF WHICH THIS EXISTS TO END.
 *
 * (1) PINNING. Drives hardcoded emails and uuids — `eric@immobileyes.com`,
 * `admin@acme-navy.test`, a proposal id commented "TVSF-R45 draft (18 unlocked sections)". The
 * database was rebuilt and none of those rows exist any more. A pinned identity is correct only
 * until the next re-seed; a RESOLVED one stays correct, because it asks what is actually there.
 *
 * (2) THE FAR WORSE ONE — a drive that could not log in still printed a verdict. `drive-rls-app`
 * pinned a missing account, its `login()` swallowed the failed navigation with `.catch(() => {})`,
 * nothing checked the result, every request came back 401 with n=0, and it concluded:
 *
 *     ❌ FAIL — a DENY-ALL surfaced (see 0-count rows)
 *
 * A security finding, shaped exactly like a real one, from a script that never authenticated.
 * Nothing in its output separated "the door is locked" from "I never knocked" — which is the same
 * confusion B83's write-up records, here at estate scale and pointed at RLS.
 *
 * SO THE CONTRACT HERE IS: a drive that cannot resolve an actor, or cannot authenticate, must DIE
 * with a message that says exactly that and an exit code that means "could not run" — never a
 * finding, never a pass. `CannotRun` carries exit code 2; a real finding stays exit 1.
 * `run-branch-drives.sh` prints the two differently so a reader can tell them apart at a glance.
 */

/**
 * The connection a HARNESS should use for its own bookkeeping — the OWNER, not the app role.
 *
 * Once the rig serves as `govtech_app` (NOBYPASSRLS, the production posture), a harness that
 * computes its expectations through the same connection sees nothing: it has no tenant context, so
 * RLS correctly denies it, and the drive concludes the fixture is empty. That is what happened the
 * first time these ran under real RLS — `drive-rls-app` refused to run, reporting "no tenant has
 * any rows", against a database holding thousands.
 *
 * The separation is the point, and CLAUDE.md already states it: the owner role exists for bootstrap
 * and "legitimate cross-tenant reads". Working out what a tenant SHOULD see is exactly such a read.
 * The APP stays scoped; only the harness's own arithmetic uses the owner.
 *
 * Falls back to DATABASE_URL so a box that has not split the roles still runs.
 */
export function harnessDbUrl() {
  return process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
}

/** Thrown when the rig cannot be driven at all. Exit 2 — not a finding, not a pass. */
export class CannotRun extends Error {
  constructor(message) {
    super(message);
    this.name = 'CannotRun';
    this.exitCode = 2;
  }
}

/**
 * The password for a role, from the env the drives already agree on.
 *
 * These are NOT interchangeable and never have been — a drive that reads `TENANT_PW` when the
 * caller exported `SANDBOX_PASSWORD` fails as a login error that looks like a product refusal.
 * Centralised so the mapping is written down once instead of guessed per file.
 */
export function passwordFor(role) {
  const admin = process.env.SANDBOX_PASSWORD || process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';
  const tenant = process.env.TENANT_PW || process.env.BUYER_PW || 'DemoPass123!';
  return (role === 'master_admin' || role === 'rfp_admin') ? admin : tenant;
}

/**
 * Find a real, active actor — by role, optionally within a tenant.
 *
 * Returns { id, email, role, tenantId, slug, password }. Throws CannotRun naming what was asked
 * for and what the box actually holds, because "no actor" with no context is the kind of message
 * that gets a drive quietly deleted instead of fixed.
 */
export async function resolveActor(sql, { role, tenantSlug = null, exclude = [] } = {}) {
  const rows = await sql`
    SELECT u.id, u.email, u.role, u.tenant_id AS tenant_id, t.slug
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.is_active
      AND (${role}::text IS NULL OR u.role = ${role})
      AND (${tenantSlug}::text IS NULL OR t.slug = ${tenantSlug})
    ORDER BY u.created_at
  `;
  const usable = rows.filter((r) => !exclude.includes(r.email));
  if (!usable.length) {
    const all = await sql`SELECT email, role, is_active FROM users ORDER BY role, email`;
    const have = all.map((r) => `${r.email} (${r.role}${r.is_active ? '' : ', INACTIVE'})`).join(', ');
    throw new CannotRun(
      `no active ${role ?? 'user'}${tenantSlug ? ` in tenant '${tenantSlug}'` : ''} on this box. ` +
      `The fixture holds: ${have}`,
    );
  }
  const a = usable[0];
  return {
    id: a.id, email: a.email, role: a.role,
    tenantId: a.tenantId ?? a.tenant_id, slug: a.slug,
    password: passwordFor(a.role),
  };
}

/** A tenant that exists, by slug — or a CannotRun that names the ones that do. */
export async function resolveTenant(sql, slug) {
  const [t] = await sql`SELECT id, slug, name FROM tenants WHERE slug = ${slug}`;
  if (t) return t;
  const all = await sql`SELECT slug FROM tenants ORDER BY created_at`;
  throw new CannotRun(
    `tenant '${slug}' does not exist. This box has: ${all.map((r) => r.slug).join(', ')}`,
  );
}

/**
 * Log in, and PROVE it took before returning.
 *
 * The old helpers ended with `.catch(() => {})` on the post-submit navigation and handed back a
 * page whether or not the session existed. Everything downstream then measured a logged-out
 * browser. This checks the landing URL and refuses to hand back an unauthenticated page.
 */
export async function loginOrDie(ctx, base, actor, opts = {}) {
  const { timeout = 20000 } = opts;
  const p = await ctx.newPage();
  await p.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { state: 'visible', timeout });
  await p.locator('#email').fill(actor.email);
  await p.locator('#password').fill(actor.password);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout }).catch(() => {});
  await p.waitForTimeout(1200);

  const url = p.url();
  if (url.includes('/login')) {
    const why = url.includes('error=') ? url.slice(url.indexOf('error=')) : 'still on /login';
    throw new CannotRun(
      `could not authenticate as ${actor.email} (${actor.role}) — ${why}. ` +
      `NOTHING measured after this point would mean anything: a logged-out browser gets 401 on ` +
      `every route, which reads identically to a deny-all. Check the password env for this role ` +
      `(admin: SANDBOX_PASSWORD, tenant: TENANT_PW).`,
    );
  }
  return p;
}

/**
 * Wrap a drive's main so CannotRun exits 2 and says why, while real failures keep exit 1.
 *
 *   main().catch(dieWell)
 */
export function dieWell(err) {
  if (err instanceof CannotRun || err?.name === 'CannotRun') {
    console.error(`\n⛔ CANNOT RUN — this is not a finding and not a pass.\n   ${err.message}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
}
