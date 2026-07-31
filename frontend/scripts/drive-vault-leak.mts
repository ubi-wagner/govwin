/**
 * Adversarial vault-leak PROOF (pre-alpha gate) — seed a real vault artifact, then assert
 * NONE of its grains surface through any main-library reader, tested with the two viewer
 * branches that defeated the visibility predicate: admin (isAdmin short-circuit) and owner
 * (owner_user_id). Covers the readers the sweep flagged: listAtomsFaceted, listAtoms,
 * selectForSection (incl. its broad fallback pass). Also proves grains are BORN vault-scoped.
 */
import { sql } from '@/lib/db';
import { GENERIC_STARTERS } from '@/lib/library/starter-set';
import { listAtomsFaceted, listAtoms, selectForSection } from '@/lib/atoms';
import { createVault, createVaultArtifact } from '@/lib/vaults/vaults';

const HOUSE = 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';
const ERIC = 'c9703126-dbb4-42f6-8e13-88b3333bc35d';
const SLUG = `vault-leak-${crypto.randomUUID().slice(0, 8)}`;
const admin = { isAdmin: true, userId: ERIC };
const owner = { isAdmin: false, userId: ERIC }; // ERIC owns the vault atoms (created_by)

async function main() {
  await sql`DELETE FROM collaboration_vaults WHERE partner_name = 'Leak Probe'`;
  const v = await createVault(HOUSE, { id: ERIC }, { partnerName: 'Leak Probe' });
  await createVaultArtifact(v.id, HOUSE, GENERIC_STARTERS[0].build(),
    { title: 'Secret Partner Bio', slug: SLUG, form: 'doc', kind: 'document', context: 'past-performance' }, { id: ERIC });

  // born vault-scoped: every grain has vault_id + visibility='vault' at insert time
  const [{ tot, ok }] = await sql<Array<{ tot: number; ok: number }>>`
    SELECT count(*)::int AS tot, count(*) FILTER (WHERE vault_id = ${v.id}::uuid AND visibility = 'vault')::int AS ok
    FROM library_atoms WHERE vault_id = ${v.id}::uuid`;
  const vaultIds = new Set((await sql<Array<{ id: string }>>`SELECT id FROM library_atoms WHERE vault_id = ${v.id}::uuid`).map((r) => r.id));
  const born = tot > 0 && tot === ok;

  const leaks = (rows: Array<{ id?: unknown }>) => rows.filter((r) => vaultIds.has(String(r.id))).length;

  // main-library readers, worst-case viewers
  const facA = leaks((await listAtomsFaceted(HOUSE, { pageSize: 100 }, admin)).atoms);
  const facO = leaks((await listAtomsFaceted(HOUSE, { pageSize: 100 }, owner)).atoms);
  const listA = leaks(await listAtoms(HOUSE, { limit: 500 }, admin));
  const listO = leaks(await listAtoms(HOUSE, { limit: 500 }, owner));
  const selA = leaks(await selectForSection(HOUSE, { limit: 50 }, admin));   // broad fallback pass
  const selO = leaks(await selectForSection(HOUSE, { limit: 50 }, owner));

  const checks: Array<[string, boolean]> = [
    [`grains born vault-scoped (${ok}/${tot})`, born],
    ['listAtomsFaceted admin=0 owner=0', facA === 0 && facO === 0],
    ['listAtoms admin=0 owner=0', listA === 0 && listO === 0],
    ['selectForSection admin=0 owner=0 (fallback)', selA === 0 && selO === 0],
  ];
  for (const [n, okk] of checks) console.log(`${okk ? '✅' : '❌'} ${n}`);

  await sql`DELETE FROM collaboration_vaults WHERE id = ${v.id}::uuid`;
  await sql`DELETE FROM library_atoms WHERE tenant_id = ${HOUSE}::uuid AND id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'doc' AND value = ${SLUG})`;

  const pass = checks.every(([, okk]) => okk);
  console.log(pass ? `\n✅ VAULT-LEAK PROOF PASS — vault content invisible to every main reader` : '\n❌ LEAK STILL PRESENT');
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
