/**
 * Drive-test: copy a system_starter foundation into a tenant (the P5 copy-on-use path)
 * and prove the FULL grain tree — foundation ⊃ section ⊃ group ⊃ primitive — copies with
 * derived_from lineage. Throwaway; cleans up its own copies at the end.
 */
import { sql } from '@/lib/db';
import { listSystemFoundations, copyFoundationToTenant } from '@/lib/library/foundation';

const TENANT = process.env.TEST_TENANT_ID ?? 'dd831b77-2d6b-4b53-bb18-4d48569a2258'; // immobileyes
const ACTOR = process.env.TEST_ACTOR_ID ?? 'c9703126-dbb4-42f6-8e13-88b3333bc35d';   // eric

async function grainCounts(ids: string[]) {
  const rows = await sql<Array<{ grain: string; n: number }>>`
    SELECT grain, count(*)::int AS n FROM library_atoms WHERE id = ANY(${ids}::uuid[]) GROUP BY grain ORDER BY grain`;
  return Object.fromEntries(rows.map((r) => [r.grain, r.n]));
}

async function main() {
  const cat = await listSystemFoundations();
  const src = cat.find((f) => f.title === 'SBIR Phase I — Technical Volume');
  if (!src) throw new Error('starter not found — seed first');

  const d = await copyFoundationToTenant(src.id, TENANT, { id: ACTOR }, { collection: 'drive_probe' });
  const all = [d.foundationId, ...d.sectionIds, ...d.groupIds, ...d.atomIds];
  const counts = await grainCounts(all);

  // Every copied grain must carry derived_from lineage back to a source atom
  // (the copy is the CHILD; its source is the parent).
  const [{ lineage }] = await sql<Array<{ lineage: number }>>`
    SELECT count(*)::int AS lineage FROM atom_lineage
    WHERE child_atom_id = ANY(${all}::uuid[]) AND relation = 'derived_from'`;
  // Every copied primitive keeps its canvas node (canvas-ready) + full taxonomy.
  // NB: the db client transform.toCamel rewrites snake aliases → camelCase on read.
  const [{ primOk }] = await sql<Array<{ primOk: number }>>`
    SELECT count(*)::int AS prim_ok FROM library_atoms
    WHERE id = ANY(${d.atomIds}::uuid[]) AND jsonb_array_length(canvas_nodes) >= 1`;
  const [{ tagMin }] = await sql<Array<{ tagMin: number }>>`
    SELECT COALESCE(min(c),0)::int AS tag_min FROM (
      SELECT count(*) c FROM atom_tags WHERE atom_id = ANY(${d.atomIds}::uuid[]) GROUP BY atom_id) q`;

  console.log('copied grain tree :', JSON.stringify(counts));
  console.log('lineage rows      :', lineage, '/', all.length, '(every grain derived_from a source)');
  console.log('primitives canvas :', primOk, '/', d.atomIds.length, 'keep a canvas_node');
  console.log('min tags/primitive:', tagMin, '(taxonomy incl. vehicle propagated)');

  const pass = counts.foundation === 1 && (counts.section ?? 0) >= 1 && (counts.group ?? 0) >= 1
    && (counts.primitive ?? 0) >= 1 && lineage === all.length
    && primOk === d.atomIds.length && tagMin >= 7;
  console.log(pass ? '✅ COPY-ON-USE PROOF PASS' : '❌ FAIL');

  // Clean up the probe copies (leave the tenant library as we found it).
  await sql`DELETE FROM library_atoms WHERE id = ANY(${all}::uuid[]) AND tenant_id = ${TENANT}::uuid`;
  console.log(`cleaned up ${all.length} probe atoms`);
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
