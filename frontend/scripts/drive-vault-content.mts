/**
 * Drive-test P8.5/P8.6 — vault content ops + rights gate on real content.
 *   1) createVaultArtifact tags every grain vault_id + visibility='vault'
 *   2) isolation: the vault artifact is invisible to the MAIN library (even admin viewer)
 *   3) listVaultArtifacts returns it (both sides see whole artifacts)
 *   4) canDownloadGrain: collaborator=whole-only, tenant=any grain
 *   5) ingestVaultFoundation copies into the main library (vault_id NULL) → now visible
 * Self-cleaning (unique slug; vault cascade removes vault atoms).
 */
import { sql } from '@/lib/db';
import { GENERIC_STARTERS } from '@/lib/library/starter-set';
import { listAtomsFaceted } from '@/lib/atoms';
import {
  createVault, createVaultArtifact, listVaultArtifacts, canDownloadGrain,
  ingestVaultFoundation, TENANT_RIGHTS, COLLAB_RIGHTS,
} from '@/lib/vaults/vaults';

const HOUSE = 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';
const ERIC = 'c9703126-dbb4-42f6-8e13-88b3333bc35d';
const SLUG = `vault-probe-${crypto.randomUUID().slice(0, 8)}`;
const adminViewer = { isAdmin: true, userId: ERIC };

const inMainLibrary = async (foundationId: string): Promise<boolean> => {
  const r = await listAtomsFaceted(HOUSE, { grain: 'foundation', pageSize: 100 }, adminViewer);
  return r.atoms.some((a) => a.id === foundationId);
};

async function main() {
  await sql`DELETE FROM collaboration_vaults WHERE partner_name = 'Content Probe'`;
  const v = await createVault(HOUSE, { id: ERIC }, { partnerName: 'Content Probe' });

  // 1) create a vault artifact from a real starter doc
  const { foundationId } = await createVaultArtifact(
    v.id, HOUSE, GENERIC_STARTERS[0].build(),
    { title: 'Vault Bio', slug: SLUG, form: 'doc', kind: 'document', context: 'past-performance' },
    { id: ERIC },
  );
  const [{ tagged, vaulted }] = await sql<Array<{ tagged: number; vaulted: number }>>`
    SELECT count(*)::int AS tagged,
           count(*) FILTER (WHERE vault_id = ${v.id}::uuid AND visibility = 'vault')::int AS vaulted
    FROM library_atoms WHERE vault_id = ${v.id}::uuid`;
  const s1 = tagged > 0 && tagged === vaulted;

  // 2) isolation — invisible to the MAIN library even for an admin viewer
  const s2 = (await inMainLibrary(foundationId)) === false;

  // 3) both-sides list
  const arts = await listVaultArtifacts(v.id);
  const s3 = arts.some((a) => a.id === foundationId);

  // 4) download gate
  const tAccess = { vaultId: v.id, ownerTenantId: HOUSE, side: 'tenant' as const, rights: TENANT_RIGHTS };
  const cAccess = { vaultId: v.id, ownerTenantId: HOUSE, side: 'collaborator' as const, rights: COLLAB_RIGHTS };
  const s4 = canDownloadGrain(cAccess, 'foundation') && !canDownloadGrain(cAccess, 'section')
    && canDownloadGrain(tAccess, 'foundation') && canDownloadGrain(tAccess, 'section');

  // 5) ingest → copies into the MAIN library (vault_id NULL) → now visible there
  const ing = await ingestVaultFoundation(v.id, foundationId, HOUSE, { id: ERIC });
  const [{ vid }] = await sql<Array<{ vid: number }>>`
    SELECT count(*) FILTER (WHERE vault_id IS NOT NULL)::int AS vid FROM library_atoms WHERE id = ${ing.foundationId}::uuid`;
  const s5 = (await inMainLibrary(ing.foundationId)) === true && vid === 0;

  const results: Array<[string, boolean]> = [
    ['1 createVaultArtifact tags all grains vault/visibility', s1],
    ['2 vault artifact invisible to main library (admin viewer)', s2],
    ['3 listVaultArtifacts returns it', s3],
    ['4 collaborator whole-only, tenant any-grain', s4],
    ['5 ingest → main library, copy vault_id NULL', s5],
  ];
  for (const [n, ok] of results) console.log(`${ok ? '✅' : '❌'} ${n}`);

  // cleanup: vault cascade + ingested copies (unique slug)
  await sql`DELETE FROM collaboration_vaults WHERE id = ${v.id}::uuid`;
  await sql`DELETE FROM library_atoms WHERE tenant_id = ${HOUSE}::uuid AND id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'doc' AND value = ${SLUG})`;

  const pass = results.every(([, ok]) => ok);
  console.log(pass ? `\n✅ VAULT CONTENT PROOF PASS (${results.length}/${results.length})` : '\n❌ FAIL');
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
