/**
 * The e2e suite's fixture accounts — the file `e2e/auth.setup.ts` has always pointed at and which
 * was not in the repository.
 *
 * WHY IT MATTERS. `auth.setup.ts` is a Playwright SETUP project: it signs in three accounts and
 * saves their storage state, and every other spec depends on it. Its own comment reads
 * "Passwords match scripts/seed_dev_accounts.mjs defaults" — but that script did not exist, and
 * two of the three accounts (`eric@lighthouse.com`, `collab@lighthouse.com`) and the `lighthouse`
 * tenant existed only as runtime state on a long-lived box.
 *
 * So on a machine built from the repo the setup fails, and the failure cascades: measured on this
 * run, **13 passed, 59 failed, 97 never ran**. The suite that is supposed to be the safety net had
 * the same "only works on a box someone already hand-prepared" property as the bugs it exists to
 * catch — and it would fail the same way in CI against a fresh database.
 *
 * This creates exactly what `auth.setup.ts` asks for, with the passwords it defaults to:
 *
 *   eric@rfppipeline.com   RFPAdmin2026!      master_admin   (password re-set to the expected one)
 *   eric@lighthouse.com    LighthouseAdmin    tenant_admin   of the `lighthouse` tenant
 *   collab@lighthouse.com  CollabPass1        partner_user   scoped into `lighthouse`
 *
 * FIXTURES, NOT PRODUCTION. These are test credentials for a local box, which is why the script
 * refuses to run against a non-local DSN. Migrations 124 and 198 exist precisely to keep known
 * credentials OUT of a real database, and nothing here changes that: a deployment never runs this.
 *
 *   source scripts/sandbox-env.sh && node scripts/seed_dev_accounts.mjs
 */
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL_OWNER not set — source scripts/sandbox-env.sh'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('REFUSING — this seeds KNOWN test passwords and is local-only.');
  process.exit(2);
}
const sql = postgres(DB, { max: 3 });

/** Matches e2e/auth.setup.ts. Change both together or the suite stops being able to sign in. */
const ADMIN = { email: 'eric@rfppipeline.com', password: process.env.RFP_ADMIN_PW || 'RFPAdmin2026!' };
const TENANT = { slug: 'lighthouse', name: 'Lighthouse Defense Systems' };
const OWNER = { email: 'eric@lighthouse.com', name: 'Eric (Lighthouse)', password: process.env.LIGHTHOUSE_PW || 'LighthouseAdmin', role: 'tenant_admin' };
const COLLAB = { email: process.env.COLLAB_EMAIL || 'collab@lighthouse.com', name: 'Lighthouse Collaborator', password: process.env.COLLAB_PW || 'CollabPass1', role: 'partner_user' };

const hash = (pw) => bcrypt.hash(pw, 12);

async function upsertUser({ email, name, role, password, tenantId }) {
  const password_hash = await hash(password);
  // temp_password=false on purpose: the suite signs in and goes straight to a gated page, and a
  // forced /change-password redirect would fail every spec. Fixtures only.
  const [u] = await sql`
    INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
    VALUES (${email}, ${name}, ${role}, ${tenantId}::uuid, ${password_hash}, false, true)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name, role = EXCLUDED.role, tenant_id = EXCLUDED.tenant_id,
      password_hash = EXCLUDED.password_hash, temp_password = false, is_active = true
    RETURNING id, email, role`;
  // A tenant_admin needs a membership row as well as users.tenant_id — the portal layout and the
  // multi-membership selector both read memberships, not the denormalised column.
  await sql`
    INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
    VALUES (${u.id}::uuid, ${tenantId}::uuid, ${role}, 'active', 'home')
    ON CONFLICT DO NOTHING`;
  return u;
}

try {
  const [tenant] = await sql`
    INSERT INTO tenants (name, slug, status) VALUES (${TENANT.name}, ${TENANT.slug}, 'active')
    ON CONFLICT (slug) DO UPDATE SET status = 'active', name = EXCLUDED.name
    RETURNING id, slug`;
  console.log(`  ✓ tenant ${tenant.slug}`);

  for (const acct of [OWNER, COLLAB]) {
    const u = await upsertUser({ ...acct, tenantId: tenant.id });
    console.log(`  ✓ ${u.email.padEnd(24)} [${u.role}]`);
  }

  // The admin already exists (migration 001 creates it); 124 and 198 leave it on a hash nobody
  // holds. Set it to what the suite expects.
  const [admin] = await sql`
    UPDATE users SET password_hash = ${await hash(ADMIN.password)}, temp_password = false, is_active = true
    WHERE email = ${ADMIN.email} RETURNING email, role`;
  console.log(admin ? `  ✓ ${admin.email.padEnd(24)} [${admin.role}] password set to the suite's default`
                    : `  – ${ADMIN.email} not found`);

  console.log('\ne2e fixtures ready. Local box only.');
} catch (e) {
  console.error('seed failed:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
