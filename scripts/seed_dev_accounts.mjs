/**
 * Seed DEV test accounts (idempotent) — two customer tenants + the RFP-Pipeline admin.
 *
 *   node scripts/seed_dev_accounts.mjs            # additive seed
 *   PURGE_DEMO=1 node scripts/seed_dev_accounts.mjs   # also remove the apex-defense /
 *                                                      # techalliance demo fixtures
 *
 * Requires DATABASE_URL (the govtech_intel connection). Standalone — uses the postgres
 * driver directly (like db/migrations/migrate.mjs) and hashes passwords IN postgres via
 * pgcrypto's crypt()/gen_salt('bf',12), which produces a $2a$ bcrypt hash that the app's
 * bcryptjs.compare verifies. No JS bcrypt dependency, no Next.js coupling.
 *
 * Creates / rotates (ON CONFLICT → re-asserts role/tenant + rotates password):
 *   • eric@rfppipeline.com  → master_admin (no tenant)   — the platform operator
 *   • Lighthouse  (tenant)  + eric@lighthouse.com → tenant_admin
 *   • Ubihere     (tenant)  + eric@ubihere.com    → tenant_admin
 *
 * temp_password = FALSE so the seeded credential works directly (no /change-password
 * wall) — these are test logins. Emails are lowercased to match auth.ts's login lookup.
 *
 * ⚠️ eric@rfppipeline.com is a REAL inbox. Seeding sends NO email (direct DB write); once
 *    active it will receive live system/nudge emails during an end-to-end run.
 * ⚠️ PURGE_DEMO deletes ONLY the apex-defense tenant + its users + the techalliance
 *    partner. It deliberately PRESERVES eric.c.wagner@gmail.com (a real master_admin).
 */
import postgres from 'postgres';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('[seed] FATAL: DATABASE_URL not set');
  process.exit(1);
}

// 'grinder' = top tier → nothing feature-gated during a full project-loop test.
const CUSTOMER_TIER = 'grinder';

const ADMIN = { email: 'eric@rfppipeline.com', name: 'Eric (RFP Pipeline Admin)', pw: process.env.RFP_ADMIN_PW || 'RFPAdmin' };
const TENANTS = [
  { slug: 'lighthouse', name: 'Lighthouse', adminEmail: 'eric@lighthouse.com', adminName: 'Eric (Lighthouse Admin)', pw: process.env.LIGHTHOUSE_PW || 'LighthouseAdmin' },
  { slug: 'ubihere', name: 'Ubihere', adminEmail: 'eric@ubihere.com', adminName: 'Eric (Ubihere Admin)', pw: process.env.UBIHERE_PW || 'UbihereAdmin' },
];

const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

async function upsertUser({ email, name, role, tenantId, password }) {
  const e = email.toLowerCase().trim();
  await sql`
    INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
    VALUES (${e}, ${name}, ${role}, ${tenantId}::uuid, crypt(${password}, gen_salt('bf', 12)), true, false)
    ON CONFLICT (email) DO UPDATE
      SET name          = EXCLUDED.name,
          role          = EXCLUDED.role,
          tenant_id     = EXCLUDED.tenant_id,
          password_hash = EXCLUDED.password_hash,
          is_active     = true,
          temp_password = false,
          updated_at    = now()
  `;
}

async function run() {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  // 1) RFP-Pipeline operator (master_admin, no tenant). Baseline seeds this email
  //    with a different password + temp_password=true; rotate it here.
  await upsertUser({ email: ADMIN.email, name: ADMIN.name, role: 'master_admin', tenantId: null, password: ADMIN.pw });
  console.log(`✓ master_admin: ${ADMIN.email}`);

  // 2) The two customer tenants + their tenant_admins.
  for (const t of TENANTS) {
    const [tenant] = await sql`
      INSERT INTO tenants (slug, name, status, product_tier)
      VALUES (${t.slug}, ${t.name}, 'active', ${CUSTOMER_TIER})
      ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name, status = 'active', product_tier = EXCLUDED.product_tier, updated_at = now()
      RETURNING id
    `;
    await upsertUser({ email: t.adminEmail, name: t.adminName, role: 'tenant_admin', tenantId: tenant.id, password: t.pw });
    console.log(`✓ tenant '${t.slug}' (${tenant.id}) + tenant_admin ${t.adminEmail}`);
  }

  // 3) Optional: remove the migration-seeded demo fixtures (apex-defense + techalliance).
  //    PRESERVES eric.c.wagner@gmail.com (real master_admin) and eric@rfppipeline.com.
  if (process.env.PURGE_DEMO === '1') {
    const demoEmails = ['admin@apexdefense.test', 'james@apexdefense.test', 'partner@techalliance.test'];
    const delUsers = await sql`DELETE FROM users WHERE email = ANY(${demoEmails}) RETURNING email`;
    // tenant_profiles → tenants (FK order; the demo tenant has no business data on a fresh reset).
    await sql`DELETE FROM tenant_profiles WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'apex-defense')`;
    const delTenants = await sql`DELETE FROM tenants WHERE slug = 'apex-defense' RETURNING slug`;
    console.log(`✓ PURGE_DEMO: removed ${delUsers.length} demo user(s) + ${delTenants.length} demo tenant(s) (kept eric.c.wagner@gmail.com)`);
  }

  console.log('\nDone. Sign in at /login with the emails above. (@lighthouse/@ubihere are fake inboxes; @rfppipeline is real.)');
}

run()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch((e) => { console.error(e); sql.end().then(() => process.exit(1)); });
