/**
 * Seed the dogfooded STARTER SET into the house library (system_starter) — P4.3.
 * Run against the platform/house tenant; every new tenant then copies-on-use from
 * this shared catalog (P5). Idempotent — safe to re-run to refresh the templates.
 *
 *   HOUSE_TENANT_ID=<uuid> HOUSE_ACTOR_ID=<uuid> npx tsx scripts/seed-starter-set.mts
 */
import { sql } from '@/lib/db';
import { seedStarterSet } from '@/lib/library/starter-seed';
import { listSystemFoundations } from '@/lib/library/foundation';

const TENANT = process.env.HOUSE_TENANT_ID ?? 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';
const ACTOR = process.env.HOUSE_ACTOR_ID ?? '72c0739e-c637-46b9-bfe9-59b05e24bcf9';

async function main() {
  const r = await seedStarterSet(TENANT, { id: ACTOR });
  const catalog = await listSystemFoundations();
  console.log(`cleared ${r.cleared} prior grains · seeded ${r.seeded} starter foundations`);
  console.log(`system_starter catalog now lists ${catalog.length} foundations`);
  for (const f of catalog) console.log(`  • ${f.title}  [${f.form}/${f.context}]`);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
