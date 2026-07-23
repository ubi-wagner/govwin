/**
 * Eat our own cooking — seed the RFP-Pipeline house tenant's library with the
 * documents we produce (ops runbooks), as canvas-backed atoms via the real
 * createAtom path. Idempotent: clears the prior house_library set first.
 *
 * Run:  DATABASE_URL=… npx tsx scripts/seed-house-library.mts
 * Point it at prod the same way you run any other one-off seed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from '@/lib/db';
import { ingestHouseDoc, clearHouseDocs } from '@/lib/library/house-docs';

// RFP-Pipeline "our-org-as-a-tenant" workspace + its master admin (created_by).
const TENANT = process.env.HOUSE_TENANT_ID ?? 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';
const ACTOR = process.env.HOUSE_ACTOR_ID ?? '72c0739e-c637-46b9-bfe9-59b05e24bcf9';

const DOCS = [
  { slug: 'pre-launch-checklist', title: 'Pre-Launch Ops/Config Checklist', file: 'PRE_LAUNCH_CHECKLIST.md' },
  { slug: 'secrets-inventory', title: 'Secrets & Config Inventory', file: 'SECRETS_INVENTORY.md' },
  { slug: 'gmail-setup', title: 'Gmail Setup — service-account delegation', file: 'GMAIL_SETUP.md' },
];

async function main() {
  const cleared = await clearHouseDocs(TENANT);
  console.log(`cleared ${cleared} prior house atoms`);
  let total = 0;
  for (const d of DOCS) {
    // cwd is the frontend dir when run via npx tsx; docs live at repo-root/docs.
    const md = readFileSync(resolve(process.cwd(), '..', 'docs', d.file), 'utf8');
    const r = await ingestHouseDoc(TENANT, { title: d.title, slug: d.slug, markdown: md, kind: 'runbook' }, { id: ACTOR });
    total += r.sectionCount + 1;
    console.log(`  ${d.slug}: group ${r.groupId.slice(0, 8)} + ${r.sectionCount} section atoms`);
  }
  console.log(`done — ${total} atoms across ${DOCS.length} house documents`);
}

main().then(() => sql.end()).catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
