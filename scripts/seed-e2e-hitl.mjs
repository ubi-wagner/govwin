/**
 * Seed the E2E HITL test cohort (idempotent, additive, dev-only).
 *
 *   node scripts/seed-e2e-hitl.mjs
 *   E2E_PW='YourPass1!' node scripts/seed-e2e-hitl.mjs   # override the shared password
 *
 * Purpose: give a human (or Playwright) ONE login-able account for EVERY HITL role, all
 * with the SAME known dev password, pointed at the existing drivable "Acme Navy Systems"
 * scenario — so every gate in the OPP → curate → release → purchase → provision → draft →
 * full-draft (A/B/C) → adversarial gate → lock → advance → package flow is reachable by the
 * right actor. Closes the gap that the repo has NO rfp_admin account at all (the entire
 * ingest/curate/release path was untestable).
 *
 * These are TEST logins (temp_password=false so the credential works directly; the shared
 * password is a dev constant, same practice as scripts/seed_dev_accounts.mjs — NOT a
 * production secret). The script is IDEMPOTENT (ON CONFLICT upserts) and ADDITIVE (it
 * creates only e2e-* accounts + reuses the existing acme-navy-systems tenant/proposal; it
 * deletes nothing).
 *
 * Requires DATABASE_URL (govtech_intel). Standalone — postgres driver + pgcrypto in-DB
 * bcrypt, like migrate.mjs / seed_dev_accounts.mjs (no Next.js / bcryptjs coupling).
 */
import postgres from 'postgres';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('[seed-e2e-hitl] FATAL: DATABASE_URL not set');
  process.exit(1);
}

// One shared password across every E2E role account — documented in docs/E2E_HITL_RUNBOOK.md.
const E2E_PW = process.env.E2E_PW || 'E2ETest!2026';

// The scenario the tenant-scope roles bind to. This tenant already carries a draftable
// proposal ("Acme → Navy SBIR Phase I") with sections + a compliance matrix, so full-draft
// (Modes A/B/C) + the adversarial gate are drivable against it out of the box.
const SCENARIO_TENANT = { slug: 'acme-navy-systems', name: 'Acme Navy Systems' };

// One canonical account per HITL role. Platform roles (master_admin / rfp_admin) carry no
// tenant; tenant roles bind to the scenario tenant; the partner is invited per-gate (see runbook).
const ACCOUNTS = [
  { email: 'e2e-master@rfppipeline.test',  name: 'E2E Master Admin',   role: 'master_admin', tenant: null },
  { email: 'e2e-rfpadmin@rfppipeline.test', name: 'E2E RFP Admin',     role: 'rfp_admin',    tenant: null },
  { email: 'e2e-tadmin@acme-navy.test',    name: 'E2E Tenant Admin',   role: 'tenant_admin', tenant: SCENARIO_TENANT.slug },
  { email: 'e2e-tuser@acme-navy.test',     name: 'E2E Tenant User',    role: 'tenant_user',  tenant: SCENARIO_TENANT.slug },
  { email: 'e2e-partner@ext.test',         name: 'E2E Partner User',   role: 'partner_user', tenant: null },
];

const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

async function ensureScenarioTenant() {
  const [t] = await sql`
    INSERT INTO tenants (slug, name, status, product_tier)
    VALUES (${SCENARIO_TENANT.slug}, ${SCENARIO_TENANT.name}, 'active', 'grinder')
    ON CONFLICT (slug) DO UPDATE SET status = 'active', updated_at = now()
    RETURNING id
  `;
  return t.id;
}

async function upsertUser({ email, name, role, tenantId }) {
  const e = email.toLowerCase().trim();
  await sql`
    INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
    VALUES (${e}, ${name}, ${role}, ${tenantId}::uuid, crypt(${E2E_PW}, gen_salt('bf', 12)), true, false)
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name, role = EXCLUDED.role, tenant_id = EXCLUDED.tenant_id,
          password_hash = EXCLUDED.password_hash, is_active = true, temp_password = false,
          updated_at = now()
  `;
  // The portal resolves the active workspace from user_memberships (#110/#115), not
  // users.tenant_id — a tenant role without a membership hits "No workspace assigned".
  if (tenantId) {
    const [u] = await sql`SELECT id FROM users WHERE email = ${e} LIMIT 1`;
    if (u) {
      await sql`
        INSERT INTO user_memberships (user_id, tenant_id, role, status)
        VALUES (${u.id}::uuid, ${tenantId}::uuid, ${role}, 'active')
        ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
      `;
    }
  }
}

// The scenario proposal the tenant roles drive. Its id is PINNED because e2e/hitl-full-draft.spec.ts
// hardcodes it (`const PROPOSAL = '3b0e7f8b-…'`) — that spec used to depend on a proposal that
// existed only as hand-made runtime state on one long-lived box, so on a machine built from the
// repo it failed 4/4 with no product defect behind it. Seeding it here is what makes the spec mean
// something. Change the id in both places or not at all.
const SCENARIO_PROPOSAL = '3b0e7f8b-7ca2-4570-91d9-48326add00ff';
const SCENARIO_OPP = '3b0e7f8b-0000-4000-8000-00000000000a';

/** Draft + unlocked + sectioned — the three properties full-draft Modes A/B/C need. */
async function ensureScenarioProposal(tenantId) {
  await sql`
    INSERT INTO opportunities (id, source, source_id, title, is_active, close_date, dates_estimated)
    VALUES (${SCENARIO_OPP}::uuid, 'manual_upload', 'e2e-acme-navy-sbir',
            'Acme → Navy SBIR Phase I', true, now() + interval '60 days', true)
    ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${SCENARIO_PROPOSAL}::uuid, ${tenantId}::uuid, ${SCENARIO_OPP}::uuid,
            'Acme → Navy SBIR Phase I', 'draft', false)
    ON CONFLICT (id) DO UPDATE SET stage = 'draft', is_locked = false, tenant_id = EXCLUDED.tenant_id`;
  // A section per volume so the draft cohort has somewhere to write and the build page is not an
  // empty shell. sort_index is the ordering key (mig 143) — section_number is a LABEL, never sorted.
  // Pinned ids + ON CONFLICT (id): proposal_sections has NO unique on (proposal_id, section_number)
  // — only the pkey — so conflict-targeting the pair throws 42P10 on every call. Same shape as
  // scripts/e2e_fixtures.sql.
  const SECTIONS = [
    ['3b0e7f8b-0000-4000-8000-000000000101', '1', 'Identification and Significance of the Problem', 'technical'],
    ['3b0e7f8b-0000-4000-8000-000000000102', '2', 'Phase I Technical Objectives', 'technical'],
    ['3b0e7f8b-0000-4000-8000-000000000103', '3', 'Phase I Work Plan', 'technical'],
    ['3b0e7f8b-0000-4000-8000-000000000104', '4', 'Commercialization Strategy', 'narrative'],
  ];
  for (const [i, [id, num, title, type]] of SECTIONS.entries()) {
    await sql`
      INSERT INTO proposal_sections (id, proposal_id, section_number, sort_index, title, section_type,
                                     status, version, is_locked, content)
      VALUES (${id}::uuid, ${SCENARIO_PROPOSAL}::uuid, ${num}, ${i + 1}, ${title}, ${type}, 'in_progress', 1, false,
              ${sql.json({ version: 1, nodes: [{ id: `n${i + 1}`, type: 'text_block', content: { text: 'seed' } }] })})
      ON CONFLICT (id) DO UPDATE
        SET is_locked = false, status = 'in_progress', sort_index = EXCLUDED.sort_index`;
  }
}

// Replay the bridge head into the tenant's card pipeline (inlined backfillTenant, same as
// seed_dev_accounts.mjs) so the Spotlight / purchase flow has cards to act on.
async function backfillTenantCards(tenantId) {
  const heads = await sql`
    SELECT DISTINCT ON (opportunity_id) id, opportunity_id, version, event_type, card
    FROM opportunity_bridge ORDER BY opportunity_id, version DESC
  `;
  let applied = 0;
  for (const h of heads) {
    const card = h.card;
    if (!card) continue;
    const STAGES = ['nofo', 'pre_release', 'open', 'updated', 'closed', 'archived'];
    const stage =
      STAGES.includes(card.submissionStage) ? card.submissionStage
      : h.event_type === 'closed' ? 'closed'
      : h.event_type === 'archived' ? 'archived'
      : h.event_type === 'reopened' ? 'open'
      : card.lifecycleStatus === 'archived' ? 'archived'
      : card.lifecycleStatus === 'closed' ? 'closed'
      : 'open';
    const lifecycle = stage === 'closed' ? 'closed' : stage === 'archived' ? 'archived' : 'open';
    await sql`
      INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage)
      VALUES (${tenantId}::uuid, ${h.opportunity_id}::uuid, ${sql.json(card)}, ${h.version}, ${lifecycle}, ${stage})
      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
        card = EXCLUDED.card, bridge_version = EXCLUDED.bridge_version,
        lifecycle_status = EXCLUDED.lifecycle_status, submission_stage = EXCLUDED.submission_stage,
        updated_at = now()
    `;
    applied++;
  }
  return applied;
}

async function run() {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  const tenantId = await ensureScenarioTenant();
  console.log(`✓ scenario tenant '${SCENARIO_TENANT.slug}' (${tenantId})`);

  for (const a of ACCOUNTS) {
    const tid = a.tenant ? tenantId : null;
    await upsertUser({ email: a.email, name: a.name, role: a.role, tenantId: tid });
    console.log(`✓ ${a.role.padEnd(13)} ${a.email}${a.tenant ? ` @ ${a.tenant}` : ''}`);
  }

  await ensureScenarioProposal(tenantId);
  console.log(`✓ scenario proposal ${SCENARIO_PROPOSAL} (draft, unlocked, 4 sections)`);

  const cards = await backfillTenantCards(tenantId);
  console.log(`✓ pipeline: ${cards} card(s) in '${SCENARIO_TENANT.slug}'`);

  // Scenario readiness report — the proposal each tenant role drives, plus its stage/lock.
  const props = await sql`
    SELECT p.id, p.title, p.stage, p.is_locked,
           (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) AS sections
    FROM proposals p WHERE p.tenant_id = ${tenantId}::uuid ORDER BY p.created_at
  `;
  const atoms = await sql`SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id = ${tenantId}::uuid`;

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('E2E HITL cohort ready. Sign in at /login — shared password below.');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  password (all roles):  ${E2E_PW}`);
  for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(13)} ${a.email}`);
  console.log(`\n  scenario tenant:  ${SCENARIO_TENANT.slug}`);
  console.log(`  library atoms:    ${atoms[0].n}`);
  if (props.length === 0) {
    console.log('  ⚠ no proposal in this tenant yet — provision one (release a purchased portal)');
    console.log('    or run the acme-navy scenario seed to get a draftable proposal.');
  } else {
    for (const p of props) {
      console.log(`  proposal:  ${p.id}  "${p.title}"  [stage=${p.stage} locked=${p.is_locked} sections=${p.sections}]`);
    }
    const drivable = props.find((p) => p.stage === 'draft' && !p.is_locked && p.sections > 0);
    console.log(drivable
      ? `\n  ✓ Full-draft drivable against: ${drivable.id} (draft, unlocked, ${drivable.sections} sections)`
      : '\n  ⚠ no draft+unlocked+sectioned proposal — full-draft Modes A/B/C need one (unlock or provision).');
  }
  console.log('\n  Runbook: docs/E2E_HITL_RUNBOOK.md');
}

run()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch((e) => { console.error(e); sql.end().then(() => process.exit(1)); });
