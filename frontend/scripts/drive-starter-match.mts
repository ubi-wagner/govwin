/**
 * Drive-test P6.1 — matchStarterFoundation (mold → starter-template link) on the real DB.
 * Scenarios against the house tenant's seeded starter set:
 *   1) title match           — a section title resolves its foundation + section grain
 *   2) vehicle narrows        — the same title under a specific vehicle returns that
 *                               vehicle's foundation; a bogus vehicle returns null
 *   3) no-match / isolation   — unknown title → null; another tenant → null
 */
import { sql } from '@/lib/db';
import { matchStarterFoundation } from '@/lib/library/starter-match';

const HOUSE = process.env.HOUSE_TENANT_ID ?? 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';
const NOBODY = '00000000-0000-0000-0000-0000000000ff';

async function main() {
  // A section title whose foundation carries a vehicle tag (a proposal starter).
  const [seed] = await sql<Array<{ title: string; vehicle: string }>>`
    SELECT s.title, v.value AS vehicle
    FROM library_atoms s
    JOIN atom_members fs ON fs.member_atom_id = s.id
    JOIN library_atoms f ON f.id = fs.group_atom_id AND f.grain = 'foundation'
    JOIN atom_tags v ON v.atom_id = f.id AND v.dimension = 'vehicle'
    WHERE s.tenant_id = ${HOUSE}::uuid AND s.grain = 'section'
    ORDER BY s.title LIMIT 1`;
  if (!seed) throw new Error('no vehicle-tagged starter section in the house tenant — seed first');

  // 1) title match (no vehicle)
  const m1 = await matchStarterFoundation(HOUSE, { title: seed.title });
  const s1 = !!m1 && !!m1.foundationId && !!m1.sectionAtomId && (m1.sectionTitle ?? '').includes(seed.title.split(' ')[0]);

  // 2) vehicle narrows — correct vehicle matches, bogus vehicle excludes
  const m2 = await matchStarterFoundation(HOUSE, { title: seed.title, vehicle: seed.vehicle });
  const m2bad = await matchStarterFoundation(HOUSE, { title: seed.title, vehicle: 'not-a-real-vehicle-xyz' });
  const s2 = !!m2 && m2.vehicle === seed.vehicle && m2bad === null;

  // 3) no-match + tenant isolation
  const m3 = await matchStarterFoundation(HOUSE, { title: 'Zzz Nonexistent Section 9137' });
  const m3iso = await matchStarterFoundation(NOBODY, { title: seed.title });
  const s3 = m3 === null && m3iso === null;

  console.log(`1 title match : "${seed.title}" → foundation=${m1?.foundationTitle ?? 'null'}  ${s1 ? '✅' : '❌'}`);
  console.log(`2 vehicle     : [${seed.vehicle}]→${m2?.vehicle ?? 'null'} · bogus→${m2bad === null ? 'null' : 'HIT'}  ${s2 ? '✅' : '❌'}`);
  console.log(`3 none/iso    : unknown→${m3 === null ? 'null' : 'HIT'} · other-tenant→${m3iso === null ? 'null' : 'HIT'}  ${s3 ? '✅' : '❌'}`);
  const pass = s1 && s2 && s3;
  console.log(pass ? '✅ STARTER-MATCH PROOF PASS (3/3)' : '❌ FAIL');
  if (!pass) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
