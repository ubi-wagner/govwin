/** Seed a few "messy" atoms (duplicates + tiny + untagged + unconfirmed-tags) for the
 *  Foundation tenant so the Library Review panel has real findings to show + clean up. */
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel');

const DUP = 'The Foundation 3DCP system prints residential foundation walls directly from a downloaded plan using locally sourced concrete, cutting formwork cost by roughly forty-seven percent and eleven days per home.';
const wc = (s) => s.trim().split(/\s+/).length;

async function ins(content, status, grain = 'primitive', title = null) {
  const [r] = await sql`
    INSERT INTO library_atoms (tenant_id, grain, title, content, word_count, char_count, status, source, creator_kind)
    VALUES ((SELECT id FROM tenants WHERE slug='foundation'), ${grain}, ${title}, ${content}, ${wc(content)}, ${content.length}, ${status}, 'upload', 'import')
    RETURNING id`;
  return r.id;
}
async function tag(atomId, dimension, value, confirmed) {
  await sql`INSERT INTO atom_tags (atom_id, dimension, value, confirmed, tag_source) VALUES (${atomId}::uuid, ${dimension}, ${value}, ${confirmed}, 'auto') ON CONFLICT DO NOTHING`;
}

async function main() {
  // three identical copies (a duplicate group of 3 → 2 extras); tag them so they only flag as dups
  for (let i = 0; i < 3; i++) { const id = await ins(DUP, i === 0 ? 'approved' : 'draft', 'primitive', `3DCP formwork savings (copy ${i + 1})`); await tag(id, 'vol', 'technical', true); }
  // tiny
  await ins('TBD cost figure.', 'draft', 'primitive', 'Placeholder');
  // untagged (real content, no tags)
  await ins('Ohio faces a persistent skilled-labor shortage in residential construction, a chronic source of schedule slip for production homebuilders across the Dayton region.', 'draft', 'primitive', 'Ohio labor shortage');
  // unconfirmed tags
  const u = await ins('Budget narrative covering direct labor, fringe, and materials for the Navy expeditionary additive-construction effort under the SBIR Phase I ceiling.', 'draft', 'primitive', 'Budget narrative (Navy)');
  await tag(u, 'kind', 'budget_data', false); await tag(u, 'vol', 'cost', false);
  console.log('SEEDED review junk for foundation');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
