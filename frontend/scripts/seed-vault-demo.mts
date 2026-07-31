/**
 * Seed a demo collaboration vault ("nook") for screenshots — tenant + collaborator sides.
 *   • nook "Acme Robotics" owned by Immobileyes
 *   • a login-capable partner user (partner@acme.test / Sandbox2026!) invited into it
 *   • a tenant-side copy-in artifact + a collaborator upload (→ the HITL review ToDo)
 * Idempotent: drops a prior "Acme Robotics" nook and reuses/creates the partner user.
 *   DATABASE_URL=... npx tsx scripts/seed-vault-demo.mts
 */
import { sql } from '@/lib/db';
import { GENERIC_STARTERS } from '@/lib/library/starter-set';
import {
  createVault, inviteVaultMember, createVaultArtifact, notifyCollaboratorUpload,
} from '@/lib/vaults/vaults';

const SLUG = 'immobileyes';
const PARTNER_EMAIL = 'partner@acme.test';

async function main() {
  const [t] = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug = ${SLUG} LIMIT 1`;
  const [eric] = await sql<Array<{ id: string; passwordHash: string | null }>>`
    SELECT id, password_hash AS "passwordHash" FROM users WHERE email = 'eric@immobileyes.com' LIMIT 1`;
  if (!t || !eric) throw new Error('immobileyes tenant or eric not found');
  const tenantId = t.id, ericId = eric.id;

  // A login-capable partner user — reuse eric's bcrypt hash (same password Sandbox2026!),
  // no tenant membership so the dispatcher routes them to /vaults.
  const [pu] = await sql<Array<{ id: string }>>`
    INSERT INTO users (email, role, is_active, temp_password, password_hash, timezone)
    VALUES (${PARTNER_EMAIL}, 'partner_user', true, false, ${eric.passwordHash}, 'America/New_York')
    ON CONFLICT (email) DO UPDATE SET role = 'partner_user', is_active = true, temp_password = false,
      password_hash = ${eric.passwordHash}
    RETURNING id`;
  const partnerId = pu.id;

  // Fresh nook
  await sql`DELETE FROM collaboration_vaults WHERE tenant_id = ${tenantId}::uuid AND partner_name = 'Acme Robotics'`;
  const v = await createVault(tenantId, { id: ericId, email: 'eric@immobileyes.com' }, { partnerName: 'Acme Robotics', partnerOrg: 'Acme Robotics, Inc.' });
  const member = await inviteVaultMember(v.id, tenantId, { id: ericId }, PARTNER_EMAIL);
  // Link the accepted user id so the collaborator resolves by id AND email.
  await sql`UPDATE vault_members SET user_id = ${partnerId}::uuid, status = 'active' WHERE id = ${member.id}::uuid`;

  // Tenant-side copy-in artifact
  await createVaultArtifact(
    v.id, tenantId, GENERIC_STARTERS[0].build(),
    { title: 'Immobileyes capability statement', slug: `demo-cap-${crypto.randomUUID().slice(0, 8)}`, form: 'doc', kind: 'document', context: 'past-performance' },
    { id: ericId },
  );
  // Collaborator upload → raises the tenant-admin review ToDo (HITL)
  const up = await createVaultArtifact(
    v.id, tenantId, GENERIC_STARTERS[0].build(),
    { title: 'Acme sensor spec sheet', slug: `demo-acme-${crypto.randomUUID().slice(0, 8)}`, form: 'doc', kind: 'document', context: 'general' },
    { id: partnerId },
  );
  await notifyCollaboratorUpload(v.id, tenantId, { id: partnerId, email: PARTNER_EMAIL, role: 'partner_user' }, up.foundationId, 'Acme Robotics');

  console.log(`✅ seeded nook ${v.id} (Acme Robotics) · partner ${PARTNER_EMAIL} / Sandbox2026! · 2 artifacts + 1 review ToDo`);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
