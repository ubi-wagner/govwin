/** Seed the template stable: materialize the lib/templates code catalog into master_templates,
 *  then publish v1 of each to the template bridge and fan out to all tenants.
 *  Idempotent (ON CONFLICT template_key). Run:
 *    cd frontend && DATABASE_URL=… node --import tsx scripts/seed-template-masters.mts
 */
import { sql } from '@/lib/db';
import { TEMPLATE_CATALOG, getTemplate } from '@/lib/templates';
import { publishAndFanOutTemplate } from '@/lib/template-bridge';

// Catalog category → (master category, agency label). Categories the picker already uses.
const AGENCY: Record<string, string | null> = {
  dod_dow: 'DoD/DoW', nsf: 'NSF', doe: 'DOE',
  marketing: null, commercialization: null, investment: null,
};

async function main() {
  let masters = 0, published = 0, fanned = 0;
  for (const entry of TEMPLATE_CATALOG) {
    const doc = getTemplate(entry.key);
    if (!doc) { console.error('  ! no template for', entry.key); continue; }
    const [row] = await sql<Array<{ id: string }>>`
      INSERT INTO master_templates (template_key, title, category, agency, format, canvas_document, version, status)
      VALUES (${entry.key}, ${entry.title}, ${entry.category}, ${AGENCY[entry.category] ?? null},
              ${entry.format}, ${sql.json(doc as never)}, 1, 'active')
      ON CONFLICT (template_key) DO UPDATE SET
        title = EXCLUDED.title, category = EXCLUDED.category, agency = EXCLUDED.agency,
        format = EXCLUDED.format, canvas_document = EXCLUDED.canvas_document,
        version = master_templates.version + 1, updated_at = now()
      RETURNING id
    `;
    masters++;
    const res = await publishAndFanOutTemplate(row.id, 'published', null);
    if (res) { published++; fanned = res.tenantsApplied; }
    console.log(`  ✓ ${entry.key.padEnd(38)} master + bridge v (fanned ${res?.tenantsApplied ?? 0})`);
  }
  const [{ mc }] = await sql<Array<{ mc: number }>>`SELECT count(*)::int mc FROM master_templates`;
  const [{ bc }] = await sql<Array<{ bc: number }>>`SELECT count(*)::int bc FROM template_bridge`;
  console.log(`\nmasters=${masters} published=${published} tenants-fanned=${fanned} | master_templates=${mc} template_bridge=${bc}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
