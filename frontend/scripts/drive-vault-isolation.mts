/**
 * Adversarial isolation proof (P8.10 security gate) for the vault authorization contract
 * (P8.2/P8.5/P8.6). Sets up two owner tenants' vaults + collaborators and asserts every
 * boundary of docs/LIBRARY_AND_VAULTS_DESIGN.md §5.2. Self-cleaning.
 */
import { sql } from '@/lib/db';
import {
  createVault, inviteVaultMember, resolveVaultAccess, listVaultsForCollaborator,
} from '@/lib/vaults/vaults';

const HOUSE = 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';   // owner A; eric is tenant_admin here
const IMMOBI = 'dd831b77-2d6b-4b53-bb18-4d48569a2258';  // owner B
// Resolved by run-branch-drives.sh; the literal is a last resort and is DEAD on any
// rebuilt database — it used to FK-violate on owner_user_id, which reads as a product
// bug rather than a moved fixture.
const ERIC = process.env.TEST_ACTOR_ID ?? 'c9703126-dbb4-42f6-8e13-88b3333bc35d';    // tenant_admin @ HOUSE
const EMAIL_A = 'partner-a@ext.test';
const EMAIL_B = 'partner-b@ext.test';
const uid = () => crypto.randomUUID();

async function main() {
  // fresh
  await sql`DELETE FROM collaboration_vaults WHERE partner_name IN ('Probe Partner A', 'Probe Partner B')`;

  const vA = await createVault(HOUSE, { id: ERIC }, { partnerName: 'Probe Partner A' });
  const vB = await createVault(IMMOBI, { id: ERIC }, { partnerName: 'Probe Partner B' });
  await inviteVaultMember(vA.id, HOUSE, { id: ERIC }, EMAIL_A);
  await inviteVaultMember(vB.id, IMMOBI, { id: ERIC }, EMAIL_B);

  const collabA = { userId: uid(), email: EMAIL_A, role: 'partner_user' as const };

  const results: Array<[string, boolean]> = [];
  const check = (name: string, ok: boolean) => { results.push([name, ok]); };

  // 1) tenant admin of the owner → tenant side, full rights
  const t = await resolveVaultAccess(vA.id, { userId: ERIC, email: 'eric@x', role: 'tenant_admin' });
  check('1 owner tenant_admin → tenant + full rights',
    t?.side === 'tenant' && t.rights.downloadGrain && t.rights.ingest && t.rights.manage);

  // 2) collaborator → whole-only (no grain, no ingest, no manage)
  const c = await resolveVaultAccess(vA.id, collabA);
  check('2 collaborator → whole-only',
    c?.side === 'collaborator' && c.rights.downloadWhole && !c.rights.downloadGrain && !c.rights.ingest && !c.rights.manage);

  // 3) cross-vault: partner A cannot reach vault B
  check('3 collaborator A → vault B = null', (await resolveVaultAccess(vB.id, collabA)) === null);

  // 4) non-member → null
  check('4 non-member → null', (await resolveVaultAccess(vA.id, { userId: uid(), email: 'nobody@ext.test', role: 'partner_user' })) === null);

  // 5) tenant_admin of ANOTHER company (no membership at owner) → null
  check('5 other-company tenant_admin → null', (await resolveVaultAccess(vA.id, { userId: uid(), email: 'x@other', role: 'tenant_admin' })) === null);

  // 6) platform admin (rfp_admin shadow / master_admin) → tenant side
  const rfp = await resolveVaultAccess(vA.id, { userId: uid(), email: 'rfp@x', role: 'rfp_admin' });
  const master = await resolveVaultAccess(vA.id, { userId: uid(), email: 'm@x', role: 'master_admin' });
  check('6 platform admin (rfp/master) → tenant', rfp?.side === 'tenant' && master?.side === 'tenant');

  // 7) segregation: each collaborator sees ONLY their own vault
  const seenA = await listVaultsForCollaborator(collabA.userId, EMAIL_A);
  const seenB = await listVaultsForCollaborator(uid(), EMAIL_B);
  check('7 collaborator sees only their vault',
    seenA.some((v) => v.id === vA.id) && !seenA.some((v) => v.id === vB.id) &&
    seenB.some((v) => v.id === vB.id) && !seenB.some((v) => v.id === vA.id));

  for (const [name, ok] of results) console.log(`${ok ? '✅' : '❌'} ${name}`);
  const pass = results.every(([, ok]) => ok);

  // cleanup (cascades members + any vault atoms)
  await sql`DELETE FROM collaboration_vaults WHERE id IN (${vA.id}::uuid, ${vB.id}::uuid)`;
  console.log(pass ? `\n✅ VAULT ISOLATION PROOF PASS (${results.length}/${results.length})` : '\n❌ FAIL');
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
