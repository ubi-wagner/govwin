/**
 * Seed HITL accounts for the Immobileyes tenant + the RFP-Pipeline shadow admin.
 *
 *   node scripts/seed-immobileyes-admins.mjs           # requires DATABASE_URL
 *
 * Creates / rotates (idempotent):
 *   • eric@rfppipeline.com   → master_admin (no tenant)  — the shadow/ingest operator.
 *       master_admin holds GLOBAL tenant access (lib/db.ts verifyTenantAccess short-circuits),
 *       so this one account dips into ANY company's portal to do work AND works the RFP-admin
 *       surface (/admin/rfp-curation) to ingest more proposals — no shadow-grant row needed.
 *   • eric@immobileyes.com   → tenant_admin @ Immobileyes
 *   • atossa@immobileyes.com → tenant_admin @ Immobileyes
 *
 * Then backfills the Immobileyes opportunity pipeline from the bridge head so the tenant
 * lands populated for HITL. Passwords hashed IN postgres via pgcrypto (bcrypt $2a$).
 */
import postgres from 'postgres';

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('[seed] DATABASE_URL not set'); process.exit(1); }
const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

const RFP_ADMIN = { email: 'eric@rfppipeline.com', name: 'Eric (RFP Pipeline Admin)', pw: process.env.RFP_ADMIN_PW || 'RFPAdmin2026!' };
const IMMO_PW = process.env.IMMO_PW || 'Immobileyes2026!';
const IMMO_ADMINS = [
  { email: 'eric@immobileyes.com', name: 'Eric (Immobileyes Admin)' },
  { email: 'atossa@immobileyes.com', name: 'Atossa Alavi (Immobileyes Admin)' },
];

async function upsertUser({ email, name, role, tenantId, password }) {
  const e = email.toLowerCase().trim();
  await sql`
    INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
    VALUES (${e}, ${name}, ${role}, ${tenantId}::uuid, crypt(${password}, gen_salt('bf', 12)), true, false)
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name, role = EXCLUDED.role, tenant_id = EXCLUDED.tenant_id,
          password_hash = EXCLUDED.password_hash, is_active = true, temp_password = false, updated_at = now()`;
  if (tenantId) {
    const [u] = await sql`SELECT id FROM users WHERE email = ${e} LIMIT 1`;
    if (u) await sql`
      INSERT INTO user_memberships (user_id, tenant_id, role, status)
      VALUES (${u.id}::uuid, ${tenantId}::uuid, ${role}, 'active')
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`;
  }
}

async function backfillTenantCards(tenantId) {
  const heads = await sql`SELECT DISTINCT ON (opportunity_id) id, opportunity_id, version, event_type, card
    FROM opportunity_bridge ORDER BY opportunity_id, version DESC`;
  let applied = 0;
  for (const h of heads) {
    const card = h.card; if (!card) continue;
    const STAGES = ['nofo', 'pre_release', 'open', 'updated', 'closed', 'archived'];
    const stage = STAGES.includes(card.submissionStage) ? card.submissionStage
      : h.event_type === 'closed' ? 'closed' : h.event_type === 'archived' ? 'archived'
      : card.lifecycleStatus === 'archived' ? 'archived' : card.lifecycleStatus === 'closed' ? 'closed' : 'open';
    const lifecycle = stage === 'closed' ? 'closed' : stage === 'archived' ? 'archived' : 'open';
    await sql`INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage)
      VALUES (${tenantId}::uuid, ${h.opportunity_id}::uuid, ${sql.json(card)}, ${h.version}, ${lifecycle}, ${stage})
      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET card = EXCLUDED.card, bridge_version = EXCLUDED.bridge_version,
        lifecycle_status = EXCLUDED.lifecycle_status, submission_stage = EXCLUDED.submission_stage, updated_at = now()`;
    applied++;
  }
  return applied;
}

async function run() {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  const [tenant] = await sql`
    INSERT INTO tenants (slug, name, status, product_tier) VALUES ('immobileyes', 'Immobileyes', 'active', 'grinder')
    ON CONFLICT (slug) DO UPDATE SET status = 'active', product_tier = 'grinder', updated_at = now() RETURNING id, slug`;

  await upsertUser({ email: RFP_ADMIN.email, name: RFP_ADMIN.name, role: 'master_admin', tenantId: null, password: RFP_ADMIN.pw });
  console.log(`✓ master_admin (shadow/ingest): ${RFP_ADMIN.email}  ·  pw: ${RFP_ADMIN.pw}`);

  for (const a of IMMO_ADMINS) {
    await upsertUser({ email: a.email, name: a.name, role: 'tenant_admin', tenantId: tenant.id, password: IMMO_PW });
    console.log(`✓ tenant_admin @ Immobileyes: ${a.email}  ·  pw: ${IMMO_PW}`);
  }

  const n = await backfillTenantCards(tenant.id);
  console.log(`✓ backfilled ${n} opportunity card(s) into Immobileyes`);

  // Verify
  const rows = await sql`SELECT u.email, u.role, u.is_active, (SELECT count(*)::int FROM user_memberships m WHERE m.user_id = u.id AND m.status='active') AS memberships
    FROM users u WHERE u.email IN (${RFP_ADMIN.email}, ${IMMO_ADMINS[0].email}, ${IMMO_ADMINS[1].email}) ORDER BY u.role`;
  console.log('\nAccounts:'); rows.forEach((r) => console.log(`   ${r.email.padEnd(28)} ${r.role.padEnd(14)} active=${r.is_active} memberships=${r.memberships}`));
  console.log('\nShadow flow: sign in as eric@rfppipeline.com → /admin (ingest at /admin/rfp-curation) → dip into /portal/immobileyes/* to do the work → back up to /admin. master_admin = global access.');
}
run().then(() => sql.end().then(() => process.exit(0))).catch((e) => { console.error(e); sql.end().then(() => process.exit(1)); });
