/**
 * Generate db/migrations/152_seed_system_starter_library.sql — the SHARED system-starter
 * master library (the "master tables" new tenants copy their starter content from).
 *
 * There was no committed seed for the `system_starter` library_atoms catalog, so on a fresh
 * deploy the copy-on-use OFFER and the new eager copy-on-creation both had nothing to copy.
 * This materializes the dogfooded STARTER_SET (18 foundations) into the rfp-pipeline platform
 * tenant via the REAL builders (decomposeAndIngest → foundation ⊃ section ⊃ group ⊃ primitive,
 * each grain tagged collection=system_starter · doc=<slug> · form/kind/context[/vehicle]), then
 * DUMPS that subtree as an idempotent SQL migration.
 *
 * The migration is self-guarding + re-runnable: fixed ids + ON CONFLICT DO NOTHING, tenant_id +
 * created_by/owner_user_id resolved via subqueries (no committed user/tenant UUIDs), and every
 * INSERT is `... SELECT <vals> WHERE EXISTS (…)` so it no-ops cleanly when the host tenant is
 * absent (mirrors mig 149). Masters carry NO atom_lineage (only per-tenant COPIES do), so only
 * library_atoms + atom_tags + atom_members are dumped.
 *
 * Run (from frontend/, sandbox DATABASE_URL set):
 *   DATABASE_URL=postgresql://claude@127.0.0.1:5433/govtech_intel node_modules/.bin/tsx scripts/gen-starter-set-seed.mts
 */
import postgres from 'postgres';
import { writeFile } from 'node:fs/promises';
import { STARTER_SET } from '@/lib/library/starter-set';
import { decomposeAndIngest } from '@/lib/library/foundation';

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('set DATABASE_URL'); process.exit(1); }
// Raw client, transform OFF → snake_case column keys for the dump (the app sql camelCases).
const raw = postgres(CONN, { max: 1, idle_timeout: 5 });
const OUT = '../../db/migrations/152_seed_system_starter_library.sql';
const HOST_SLUG = 'rfp-pipeline';
const HOST = `(SELECT id FROM tenants WHERE slug='${HOST_SLUG}')`;
const MADM = `(SELECT id FROM users WHERE role='master_admin' ORDER BY created_at LIMIT 1)`;
const USER_FK = new Set(['library_atoms.created_by', 'library_atoms.owner_user_id', 'atom_tags.confirmed_by']);

const q = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`;
async function colMeta(t: string) {
  const rows = await raw`SELECT column_name, data_type, is_generated FROM information_schema.columns WHERE table_name=${t} AND table_schema='public' ORDER BY ordinal_position`;
  const types: Record<string, string> = {}; const generated = new Set<string>(); const order: string[] = [];
  for (const r of rows) { types[r.column_name] = r.data_type; order.push(r.column_name); if (r.is_generated === 'ALWAYS') generated.add(r.column_name); }
  return { types, generated, order };
}
function lit(val: unknown, type: string): string {
  if (val === null || val === undefined) return 'NULL';
  switch (type) {
    case 'jsonb': case 'json': return `${q(JSON.stringify(val))}::jsonb`;
    case 'ARRAY': { const arr = Array.isArray(val) ? val : []; return arr.length ? `'{${arr.map((e) => `"${String(e).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}'` : `'{}'`; }
    case 'boolean': return val ? 'true' : 'false';
    case 'integer': case 'bigint': case 'smallint': case 'numeric': case 'real': case 'double precision': return String(val);
    case 'timestamp with time zone': case 'timestamp without time zone': case 'date':
      return `${q(val instanceof Date ? val.toISOString() : String(val))}::timestamptz`;
    default: return q(val);
  }
}

async function main() {
  const [host] = await raw<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug=${HOST_SLUG}`;
  if (!host) { console.error(`host tenant ${HOST_SLUG} absent — cannot generate`); process.exit(1); }
  const [actor] = await raw<Array<{ id: string }>>`SELECT id FROM users WHERE role='master_admin' ORDER BY created_at LIMIT 1`;
  if (!actor) { console.error('no master_admin actor'); process.exit(1); }

  // 1) Decompose each starter into the host tenant (idempotent: skip if its system_starter
  //    foundation already exists by doc slug). Uses the real builders → real atom hierarchy.
  for (const def of STARTER_SET) {
    const present = await raw`
      SELECT 1 FROM library_atoms la
      WHERE la.tenant_id=${host.id}::uuid AND la.grain='foundation'
        AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='doc' AND value=${def.slug})
        AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='collection' AND value='system_starter')
      LIMIT 1`;
    if (present.length) { console.log(`  skip  ${def.slug} (already seeded)`); continue; }
    await decomposeAndIngest(host.id, def.build(), {
      title: def.title, slug: def.slug, form: def.form, kind: def.kind, context: def.context,
      vehicle: def.vehicle, collection: 'system_starter',
    }, { id: actor.id });
    console.log(`  seed  ${def.slug}`);
  }

  // 2) Gather the whole system_starter subtree under the host (every grain carries the tag).
  const ids = (await raw<Array<{ id: string }>>`
    SELECT la.id FROM library_atoms la
    WHERE la.tenant_id=${host.id}::uuid
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension='collection' AND value='system_starter')
    ORDER BY la.grain, la.created_at`).map((r) => r.id);
  console.log(`\n  subtree atoms: ${ids.length}`);

  const laMeta = await colMeta('library_atoms');
  const tgMeta = await colMeta('atom_tags');
  const mbMeta = await colMeta('atom_members');
  const laCols = laMeta.order.filter((c) => !laMeta.generated.has(c));
  const tgCols = tgMeta.order.filter((c) => !tgMeta.generated.has(c));
  const mbCols = mbMeta.order.filter((c) => !mbMeta.generated.has(c));

  const laRows = await raw.unsafe(`SELECT * FROM library_atoms WHERE id = ANY($1::uuid[]) ORDER BY (grain='foundation'), created_at`, [ids]);
  const tgRows = await raw.unsafe(`SELECT * FROM atom_tags WHERE atom_id = ANY($1::uuid[]) ORDER BY atom_id, dimension, value`, [ids]);
  const mbRows = await raw.unsafe(`SELECT * FROM atom_members WHERE group_atom_id = ANY($1::uuid[]) ORDER BY group_atom_id, ordinal`, [ids]);

  const out: string[] = [
    '-- 152_seed_system_starter_library.sql',
    '-- Idempotent seed: the SHARED system-starter MASTER LIBRARY — the dogfooded STARTER_SET',
    '-- (lib/library/starter-set.ts) decomposed into the rfp-pipeline platform tenant as',
    '-- `collection=system_starter` foundation ⊃ section ⊃ group ⊃ primitive atoms. This is the',
    '-- "master tables" that new tenants copy their starter content FROM: copyStarterSetToTenant',
    '-- (eager copy-on-creation) + the copy-on-use OFFER both read this catalog cross-tenant and',
    '-- materialize a per-tenant, isolated copy (collection=my_library, derived_from lineage).',
    '-- Generated by frontend/scripts/gen-starter-set-seed.mts from the real builders.',
    '--',
    '-- Self-guarding + re-runnable: fixed ids + ON CONFLICT DO NOTHING; tenant_id + user FKs via',
    "-- subqueries (no committed UUIDs); every INSERT is `SELECT <vals> WHERE EXISTS (…)` so it",
    '-- no-ops when the host tenant / a parent atom is absent. Masters carry no atom_lineage.',
    '',
  ];

  out.push(`-- library_atoms (${laRows.length}) — foundations + section/group/primitive grains`);
  for (const r of laRows) {
    const vals = laCols.map((c) => {
      if (c === 'tenant_id') return HOST;
      if (USER_FK.has(`library_atoms.${c}`)) return r[c] == null ? 'NULL' : MADM;
      return lit(r[c], laMeta.types[c]);
    });
    out.push(`INSERT INTO library_atoms (${laCols.join(', ')}) SELECT ${vals.join(', ')} WHERE EXISTS ${HOST} ON CONFLICT (id) DO NOTHING;`);
  }
  out.push('');

  out.push(`-- atom_tags (${tgRows.length}) — taxonomy on every grain (collection/doc/kind/form/format/context[/vehicle])`);
  for (const r of tgRows) {
    const vals = tgCols.map((c) => {
      if (USER_FK.has(`atom_tags.${c}`)) return r[c] == null ? 'NULL' : MADM;
      return lit(r[c], tgMeta.types[c]);
    });
    out.push(`INSERT INTO atom_tags (${tgCols.join(', ')}) SELECT ${vals.join(', ')} WHERE EXISTS (SELECT 1 FROM library_atoms WHERE id=${q(r.atom_id)}::uuid) ON CONFLICT (atom_id, dimension, value) DO NOTHING;`);
  }
  out.push('');

  out.push(`-- atom_members (${mbRows.length}) — foundation→section→group→primitive containment`);
  for (const r of mbRows) {
    const vals = mbCols.map((c) => lit(r[c], mbMeta.types[c]));
    out.push(`INSERT INTO atom_members (${mbCols.join(', ')}) SELECT ${vals.join(', ')} WHERE EXISTS (SELECT 1 FROM library_atoms WHERE id=${q(r.group_atom_id)}::uuid) AND EXISTS (SELECT 1 FROM library_atoms WHERE id=${q(r.member_atom_id)}::uuid) ON CONFLICT (group_atom_id, member_atom_id) DO NOTHING;`);
  }
  out.push('');

  await writeFile(new URL(OUT, import.meta.url), out.join('\n') + '\n');
  console.log(`\n✓ wrote ${OUT} — library_atoms ${laRows.length}, atom_tags ${tgRows.length}, atom_members ${mbRows.length}`);
}
main().then(() => raw.end()).catch(async (e) => { console.error(e); await raw.end(); process.exit(1); });
