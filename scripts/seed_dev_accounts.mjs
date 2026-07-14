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
 * Then backfills every active/trial tenant's opportunity pipeline from the bridge
 * head so seeded tenants land fully populated (no manual /backfill-cards call).
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

const ADMIN = { email: 'eric@rfppipeline.com', name: 'Eric (RFP Pipeline Admin)', pw: process.env.RFP_ADMIN_PW || 'RFPAdmin2026!' };
const TENANTS = [
  { slug: 'lighthouse', name: 'Lighthouse', adminEmail: 'eric@lighthouse.com', adminName: 'Eric (Lighthouse Admin)', pw: process.env.LIGHTHOUSE_PW || 'LighthouseAdmin' },
  { slug: 'ubihere', name: 'Ubihere', adminEmail: 'eric@ubihere.com', adminName: 'Eric (Ubihere Admin)', pw: process.env.UBIHERE_PW || 'UbihereAdmin' },
];

const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

/**
 * Replay the bridge head (latest version of every opportunity) into a tenant's
 * pipeline — the same logic as frontend/lib/opportunity-bridge.ts backfillTenant,
 * inlined here (standalone script; no Next.js/@ imports). Idempotent upsert, so a
 * seeded tenant lands with its full card pipeline even when opportunities were
 * pushed BEFORE the tenant existed (fan-out only covers tenants live at push time).
 *
 * NOTE: this script's `sql` has no camelCase column transform, so bridge rows come
 * back snake_case (opportunity_id, event_type, …). The `card` JSONB keeps the keys
 * it was written with (camelCase: card.lifecycleStatus). Cards are rewritten via
 * sql.json() to avoid the stringify-into-jsonb char-iteration bug.
 */
async function backfillTenantCards(tenantId) {
  const heads = await sql`
    SELECT DISTINCT ON (opportunity_id) id, opportunity_id, version, event_type, card
    FROM opportunity_bridge
    ORDER BY opportunity_id, version DESC
  `;
  let applied = 0;
  for (const h of heads) {
    const card = h.card;
    if (!card) continue;
    const STAGES = ['nofo', 'pre_release', 'open', 'updated', 'closed', 'archived'];
    // Canonical 6-state stage — prefer the card's own stage, else derive from event/lifecycle.
    const stage =
      STAGES.includes(card.submissionStage) ? card.submissionStage
      : h.event_type === 'closed' ? 'closed'
      : h.event_type === 'archived' ? 'archived'
      : h.event_type === 'reopened' ? 'open'
      : card.lifecycleStatus === 'archived' ? 'archived'
      : card.lifecycleStatus === 'closed' ? 'closed'
      : 'open';
    // Coarse lifecycle_status the feed filters on (nofo/pre_release/updated all read as open).
    const lifecycle = stage === 'closed' ? 'closed' : stage === 'archived' ? 'archived' : 'open';
    await sql`
      INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage)
      VALUES (${tenantId}::uuid, ${h.opportunity_id}::uuid, ${sql.json(card)}, ${h.version}, ${lifecycle}, ${stage})
      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
        card = EXCLUDED.card,
        bridge_version = EXCLUDED.bridge_version,
        lifecycle_status = EXCLUDED.lifecycle_status,
        submission_stage = EXCLUDED.submission_stage,
        pin_update_available = CASE
          WHEN tenant_opportunity_cards.is_pinned AND EXCLUDED.bridge_version > tenant_opportunity_cards.bridge_version
          THEN true ELSE tenant_opportunity_cards.pin_update_available END,
        updated_at = now()
    `;
    await sql`
      INSERT INTO tenant_bridge_cursor (tenant_id, last_posted_at, last_event_id, last_applied_at)
      VALUES (${tenantId}::uuid, now(), ${h.id}::uuid, now())
      ON CONFLICT (tenant_id) DO UPDATE SET last_event_id = EXCLUDED.last_event_id, last_applied_at = now()
    `;
    applied++;
  }
  return applied;
}

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

  // 4) Fully populate every active/trial tenant's pipeline from the bridge head —
  //    the same audience fan-out targets. Idempotent: no-op on a fresh DB (empty
  //    bridge), and catches every tenant up to the current head once RFPs are
  //    pushed, in EITHER order (seed-then-push or push-then-seed). This removes the
  //    "tenant created after a release has an empty pipeline" dead-end.
  const activeTenants = await sql`SELECT id, slug FROM tenants WHERE status IN ('active', 'trial')`;
  let totalCards = 0;
  for (const t of activeTenants) {
    const n = await backfillTenantCards(t.id);
    totalCards += n;
    console.log(`✓ pipeline: backfilled ${n} card(s) into tenant '${t.slug}'`);
  }
  console.log(`✓ pipeline backfill complete — ${totalCards} card(s) across ${activeTenants.length} active/trial tenant(s)`);

  console.log('\nDone. Sign in at /login with the emails above. (@lighthouse/@ubihere are fake inboxes; @rfppipeline is real.)');
}

run()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch((e) => { console.error(e); sql.end().then(() => process.exit(1)); });
