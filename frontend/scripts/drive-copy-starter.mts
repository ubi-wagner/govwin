/**
 * Drive-test: copy a system_starter foundation into a tenant (the P5 copy-on-use path) and prove
 * the FULL grain tree — foundation ⊃ section ⊃ group ⊃ primitive — arrives as the tenant's OWN,
 * canvas-ready, fully-tagged atoms. Throwaway; cleans up its own copies at the end.
 *
 * IT USED TO ASSERT `derived_from` LINEAGE, WHICH THIS PATH CANNOT PRODUCE.
 *
 * `copyFoundationToTenant` passes `parentAtomIds: [srcId]`, but `createAtom` accepts a parent only
 * when it belongs to the same tenant as the child — a deliberate guard, because `atom_lineage` has
 * no RLS and a forged foreign parent would otherwise inflate a victim atom's child_count. The
 * source is in another tenant by definition, so every edge is dropped: measured 0 of 31.
 *
 * The old assertion was therefore permanently red for a reason that is CORRECT behaviour. Worse,
 * it was red for the wrong reason: on a rebuilt database this drive could not even reach that
 * check, because it pinned a tenant and an actor that no longer exist.
 *
 * So the check is inverted into the property actually worth guarding: NO cross-tenant lineage edge
 * is created by copy-inward. That is the guardrail (task #118 — copy-inward only, no cross-tenant
 * shared objects), and asserting it means this drive now fails if someone relaxes the guard.
 *
 * What it does NOT assert, because it is unresolved: the eager system_starter copy (task #71)
 * writes house→tenant `derived_from` edges — 303 on this box, all cross-tenant. The two copy paths
 * disagree. Recorded as B85 rather than silently normalised in either direction.
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

  // THE GUARDRAIL: copy-inward must not leave a lineage edge pointing at another tenant's atom.
  // Counted across every relation, not just derived_from — the property is "no cross-tenant edge",
  // and narrowing it to one relation would let a differently-labelled edge through.
  const [{ crossTenant }] = await sql<Array<{ crossTenant: number }>>`
    SELECT count(*)::int AS cross_tenant
    FROM atom_lineage l
    JOIN library_atoms p ON p.id = l.parent_atom_id
    JOIN library_atoms c ON c.id = l.child_atom_id
    WHERE l.child_atom_id = ANY(${all}::uuid[])
      AND p.tenant_id IS DISTINCT FROM c.tenant_id`;
  // And the copies really are the target tenant's own rows — the other half of copy-inward.
  const [{ owned }] = await sql<Array<{ owned: number }>>`
    SELECT count(*)::int AS owned FROM library_atoms
    WHERE id = ANY(${all}::uuid[]) AND tenant_id = ${TENANT}::uuid`;
  // Every copied primitive keeps its canvas node (canvas-ready) + full taxonomy.
  // NB: the db client transform.toCamel rewrites snake aliases → camelCase on read.
  const [{ primOk }] = await sql<Array<{ primOk: number }>>`
    SELECT count(*)::int AS prim_ok FROM library_atoms
    WHERE id = ANY(${d.atomIds}::uuid[]) AND jsonb_array_length(canvas_nodes) >= 1`;
  const [{ tagMin }] = await sql<Array<{ tagMin: number }>>`
    SELECT COALESCE(min(c),0)::int AS tag_min FROM (
      SELECT count(*) c FROM atom_tags WHERE atom_id = ANY(${d.atomIds}::uuid[]) GROUP BY atom_id) q`;

  console.log('copied grain tree :', JSON.stringify(counts));
  console.log('cross-tenant edges:', crossTenant, '(must be 0 — copy-inward leaves no edge to another tenant)');
  console.log('tenant-owned rows :', owned, '/', all.length);
  console.log('primitives canvas :', primOk, '/', d.atomIds.length, 'keep a canvas_node');
  console.log('min tags/primitive:', tagMin, '(taxonomy incl. vehicle propagated)');

  const pass = counts.foundation === 1 && (counts.section ?? 0) >= 1 && (counts.group ?? 0) >= 1
    && (counts.primitive ?? 0) >= 1
    && crossTenant === 0 && owned === all.length
    && primOk === d.atomIds.length && tagMin >= 7;
  console.log(pass ? '✅ COPY-ON-USE PROOF PASS' : '❌ FAIL');

  // Clean up the probe copies (leave the tenant library as we found it).
  await sql`DELETE FROM library_atoms WHERE id = ANY(${all}::uuid[]) AND tenant_id = ${TENANT}::uuid`;
  console.log(`cleaned up ${all.length} probe atoms`);
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
