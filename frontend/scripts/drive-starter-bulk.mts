/**
 * Drive-test P5.2 — copyStarterSetToTenant bulk copy-on-use, idempotent.
 * 3 real-DB scenarios against the immobileyes test tenant:
 *   1) fresh empty  → adds the whole catalog (skipped 0)
 *   2) idempotent   → re-run adds nothing (all skipped)
 *   3) partial      → drop 3 starters, re-run refills exactly those 3
 * Cleans up after itself (every starter grain carries doc=<slug>, so a slug-scoped
 * delete removes the whole subtree).
 */
import { sql } from '@/lib/db';
import { STARTER_SET } from '@/lib/library/starter-set';
import { copyStarterSetToTenant } from '@/lib/library/foundation';

const TENANT = process.env.TEST_TENANT_ID ?? 'dd831b77-2d6b-4b53-bb18-4d48569a2258'; // immobileyes
const ACTOR = process.env.TEST_ACTOR_ID ?? 'c9703126-dbb4-42f6-8e13-88b3333bc35d';   // eric
const SLUGS = STARTER_SET.map((s) => s.slug);

const delBySlugs = (slugs: string[]) => sql`
  DELETE FROM library_atoms WHERE tenant_id = ${TENANT}::uuid
    AND id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'doc' AND value = ANY(${slugs}))`;

async function tenantFoundationCount(): Promise<number> {
  const [{ n }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM library_atoms la
    WHERE la.tenant_id = ${TENANT}::uuid AND la.grain = 'foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'doc' AND value = ANY(${SLUGS}))`;
  return n;
}

async function main() {
  const N = SLUGS.length;
  await delBySlugs(SLUGS); // clean baseline

  // 1) fresh
  const r1 = await copyStarterSetToTenant(TENANT, { id: ACTOR }, { collection: 'my_library' });
  const c1 = await tenantFoundationCount();
  const s1 = r1.added === N && r1.skipped === 0 && c1 === N;
  console.log(`1 fresh    : added ${r1.added} skipped ${r1.skipped} · tenant foundations ${c1}  ${s1 ? '✅' : '❌'}`);

  // 2) idempotent re-run
  const r2 = await copyStarterSetToTenant(TENANT, { id: ACTOR }, { collection: 'my_library' });
  const c2 = await tenantFoundationCount();
  const s2 = r2.added === 0 && r2.skipped === N && c2 === N;
  console.log(`2 idempotent: added ${r2.added} skipped ${r2.skipped} · tenant foundations ${c2}  ${s2 ? '✅' : '❌'}`);

  // 3) partial — drop 3 starters, refill exactly those
  const drop = SLUGS.slice(0, 3);
  await delBySlugs(drop);
  const r3 = await copyStarterSetToTenant(TENANT, { id: ACTOR }, { collection: 'my_library' });
  const c3 = await tenantFoundationCount();
  const s3 = r3.added === 3 && r3.skipped === N - 3 && c3 === N;
  console.log(`3 partial  : added ${r3.added} skipped ${r3.skipped} · tenant foundations ${c3}  ${s3 ? '✅' : '❌'}`);

  await delBySlugs(SLUGS); // cleanup
  const pass = s1 && s2 && s3;
  console.log(pass ? '✅ BULK COPY-ON-USE PROOF PASS (3/3)' : '❌ FAIL');
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
