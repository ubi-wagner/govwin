/**
 * Drive-test P8.9 (collaborator surface) + P8.7 (collaborator-content HITL).
 *   1) listVaultsForCollaborator resolves an invited email → the nook, joined to owner name/slug
 *   2) null/empty session email NEVER matches a member row (the isolation guard)
 *   3) getVaultOwnerContext returns the owner slug + name (for the /vaults/<id> apiBase + label)
 *   4) resolveVaultAccess for the collaborator → side='collaborator' + COLLAB_RIGHTS
 *   5) notifyCollaboratorUpload raises exactly ONE open review ToDo per nook (idempotent),
 *      assigned to tenant_admin at the OWNER tenant, and emits a library audit event
 * Self-cleaning (unique vault; cascade + explicit task/event purge).
 */
import { sql } from '@/lib/db';
import { GENERIC_STARTERS } from '@/lib/library/starter-set';
import {
  createVault, inviteVaultMember, listVaultsForCollaborator, getVaultOwnerContext,
  resolveVaultAccess, createVaultArtifact, notifyCollaboratorUpload,
} from '@/lib/vaults/vaults';

const HOUSE = 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';
const ERIC = 'c9703126-dbb4-42f6-8e13-88b3333bc35d';
const COLLAB_EMAIL = `collab-surface-${crypto.randomUUID().slice(0, 8)}@example.com`;
const COLLAB_UID = crypto.randomUUID();      // a synthetic partner user id (email-match path)
const SLUG = `vault-surface-${crypto.randomUUID().slice(0, 8)}`;

async function main() {
  await sql`DELETE FROM collaboration_vaults WHERE partner_name = 'Surface Probe'`;
  const v = await createVault(HOUSE, { id: ERIC }, { partnerName: 'Surface Probe', partnerOrg: 'Surface Co' });
  await inviteVaultMember(v.id, HOUSE, { id: ERIC }, COLLAB_EMAIL);

  // 1) email-match list, joined to owner name/slug
  const listed = await listVaultsForCollaborator(COLLAB_UID, COLLAB_EMAIL);
  const row = listed.find((x) => x.id === v.id);
  const s1 = !!row && !!row.ownerName && !!row.ownerSlug;

  // 2) a null email must NOT match (the defensive guard)
  const listedNull = await listVaultsForCollaborator(COLLAB_UID, null);
  const s2 = !listedNull.some((x) => x.id === v.id);

  // 3) owner context for the apiBase + label
  const ctx = await getVaultOwnerContext(v.id);
  const s3 = !!ctx && !!ctx.ownerSlug && !!ctx.ownerName;

  // 4) resolved collaborator side + rights
  const access = await resolveVaultAccess(v.id, { userId: COLLAB_UID, email: COLLAB_EMAIL, role: 'partner_user' });
  const s4 = !!access && access.side === 'collaborator'
    && access.rights.upload && access.rights.downloadWhole
    && !access.rights.downloadGrain && !access.rights.ingest && !access.rights.manage;

  // 5) HITL — a collaborator upload notifies the owner; idempotent standing ToDo + audit event.
  // (library_atoms.owner_user_id has an FK to users, so the upload must be owned by a REAL
  // user; the synthetic COLLAB_UID above only exercises the FK-free membership/email match.
  // Using ERIC as the uploader identity here is harmless — notifyCollaboratorUpload asserts
  // no auth, it just records who uploaded and raises the owner's review ToDo.)
  const { foundationId } = await createVaultArtifact(
    v.id, HOUSE, GENERIC_STARTERS[0].build(),
    { title: 'Partner Upload', slug: SLUG, form: 'doc', kind: 'document', context: 'general' },
    { id: ERIC },
  );
  const uploader = { id: ERIC, email: COLLAB_EMAIL, role: 'partner_user' as const };
  await notifyCollaboratorUpload(v.id, HOUSE, uploader, foundationId, v.partnerName);
  await notifyCollaboratorUpload(v.id, HOUSE, uploader, foundationId, v.partnerName); // second upload → no new ToDo

  const [{ openTasks, role }] = await sql<Array<{ openTasks: number; role: string | null }>>`
    SELECT count(*)::int AS "openTasks", max(assignee_role) AS role
    FROM tasks WHERE tenant_id = ${HOUSE}::uuid AND task_type = 'vault_artifact_review'
      AND entity_id = ${v.id}::uuid AND status IN ('open', 'in_progress')`;
  const [{ events }] = await sql<Array<{ events: number }>>`
    SELECT count(*)::int AS events FROM system_events
    WHERE type = 'vault.artifact_uploaded' AND tenant_id = ${HOUSE}::uuid AND payload->>'vaultId' = ${v.id}`;
  const s5 = openTasks === 1 && role === 'tenant_admin' && events === 2;

  const results: Array<[string, boolean]> = [
    ['1 listVaultsForCollaborator email-match + owner name/slug', s1],
    ['2 null email never matches a member (isolation guard)', s2],
    ['3 getVaultOwnerContext returns owner slug + name', s3],
    ['4 collaborator side + COLLAB_RIGHTS (no grain/ingest/manage)', s4],
    ['5 HITL: 1 standing ToDo (tenant_admin) + 2 audit events', s5],
  ];
  for (const [n, ok] of results) console.log(`${ok ? '✅' : '❌'} ${n}`);
  if (!s5) console.log(`   (openTasks=${openTasks} role=${role} events=${events})`);

  // cleanup
  await sql`DELETE FROM tasks WHERE entity_id = ${v.id}::uuid AND task_type = 'vault_artifact_review'`;
  await sql`DELETE FROM system_events WHERE type = 'vault.artifact_uploaded' AND payload->>'vaultId' = ${v.id}`;
  await sql`DELETE FROM collaboration_vaults WHERE id = ${v.id}::uuid`;

  const pass = results.every(([, ok]) => ok);
  console.log(pass ? `\n✅ COLLAB SURFACE + HITL PROOF PASS (${results.length}/${results.length})` : '\n❌ FAIL');
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
