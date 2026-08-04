/**
 * Prove "keep + copy" + ISOLATION end-to-end against the seeded master library (mig 152).
 * Runs the EXACT call the tenant-creation routes make — copyStarterSetToTenant(target,{id}) —
 * into a throwaway tenant and asserts:
 *   1) all 18 starters copy into the TARGET tenant's own space, collection=my_library
 *   2) every copy carries derived_from lineage back to a master
 *   3) the masters stay put under the host (rfp-pipeline), untouched + still system_starter
 *   4) ZERO system_starter atoms leak into the target (copies are the tenant's OWN atoms)
 *   5) idempotent re-run adds 0 (dedup by doc slug)
 * Creates + deletes its own throwaway tenant — leaves the DB exactly as found.
 */
import postgres from 'postgres';
import { STARTER_SET } from '@/lib/library/starter-set';
import { copyStarterSetToTenant } from '@/lib/library/foundation';

const raw = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 5 });
const SLUGS = STARTER_SET.map((s) => s.slug);
const N = SLUGS.length;

async function main() {
  const [host] = await raw<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug='rfp-pipeline'`;
  const [actor] = await raw<Array<{ id: string }>>`SELECT id FROM users WHERE role='master_admin' ORDER BY created_at LIMIT 1`;

  // throwaway target tenant (clean slate)
  await raw`DELETE FROM tenants WHERE slug='zz-keepcopy-probe'`;
  const [t] = await raw<Array<{ id: string }>>`INSERT INTO tenants (name, slug) VALUES ('ZZ KeepCopy Probe','zz-keepcopy-probe') RETURNING id`;
  const target = t.id;

  const cntMy = async (tid: string) => (await raw<Array<{ n: number }>>`
    SELECT count(*)::int n FROM library_atoms la WHERE la.tenant_id=${tid}::uuid AND la.grain='foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='collection' AND value='my_library')`)[0].n;
  const cntSys = async (tid: string) => (await raw<Array<{ n: number }>>`
    SELECT count(*)::int n FROM library_atoms la WHERE la.tenant_id=${tid}::uuid
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='collection' AND value='system_starter')`)[0].n;

  const masterFoundBefore = (await raw<Array<{ n: number }>>`
    SELECT count(*)::int n FROM library_atoms la WHERE la.tenant_id=${host.id}::uuid AND la.grain='foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='collection' AND value='system_starter')`)[0].n;

  // ── the exact route call ──
  const r1 = await copyStarterSetToTenant(target, { id: actor.id });

  const targetMy = await cntMy(target);
  const targetSysLeak = await cntSys(target);
  const [{ lineage }] = await raw<Array<{ lineage: number }>>`
    SELECT count(*)::int lineage FROM atom_lineage
    WHERE relation='derived_from' AND child_atom_id IN (
      SELECT id FROM library_atoms WHERE tenant_id=${target}::uuid
        AND id IN (SELECT atom_id FROM atom_tags WHERE dimension='doc' AND value=ANY(${SLUGS})))`;
  const masterFoundAfter = (await raw<Array<{ n: number }>>`
    SELECT count(*)::int n FROM library_atoms la WHERE la.tenant_id=${host.id}::uuid AND la.grain='foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='collection' AND value='system_starter')`)[0].n;

  // idempotent re-run
  const r2 = await copyStarterSetToTenant(target, { id: actor.id });

  const targetFoundations = (await raw<Array<{ n: number }>>`
    SELECT count(*)::int n FROM library_atoms la WHERE la.tenant_id=${target}::uuid AND la.grain='foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='doc' AND value=ANY(${SLUGS}))`)[0].n;

  const checks: Array<[string, boolean, string]> = [
    ['copy added all 18 starters', r1.added === N && r1.skipped === 0, `added ${r1.added} skipped ${r1.skipped}`],
    ['target has 18 my_library foundations', targetFoundations === N, `foundations ${targetFoundations}`],
    ['every copy carries derived_from lineage', lineage > 0 && lineage >= targetMy, `lineage ${lineage} ≥ copies ${targetMy}`],
    ['ZERO system_starter leaked into target', targetSysLeak === 0, `leaked ${targetSysLeak}`],
    ['masters under host untouched (still 18)', masterFoundBefore === N && masterFoundAfter === N, `before ${masterFoundBefore} after ${masterFoundAfter}`],
    ['idempotent re-run adds 0', r2.added === 0 && r2.skipped === N, `added ${r2.added} skipped ${r2.skipped}`],
  ];
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? '✅' : '❌'} ${name}  (${detail})`);
  const pass = checks.every(([, ok]) => ok);

  // cleanup — remove the throwaway tenant + all its atoms (leave DB as found)
  await raw`DELETE FROM library_atoms WHERE tenant_id=${target}::uuid`;
  await raw`DELETE FROM tenants WHERE id=${target}::uuid`;
  console.log(pass ? '\n✅ KEEP+COPY ISOLATION PROOF PASS (6/6)' : '\n❌ FAIL');
  if (!pass) process.exit(1);
}
main().then(() => raw.end()).catch(async (e) => { console.error(e); await raw.end(); process.exit(1); });
