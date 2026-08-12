#!/usr/bin/env node
/**
 * extract.mjs — introspect a migrated govtech_intel database into model/schema.json.
 *
 * The "seed" for the Architecture Explorer is the schema itself, in its applied form
 * (the cumulative result of db/migrations/*.sql). Run this whenever the schema changes:
 *
 *   ARCH_DB_URL=postgresql://user@host:5432/govtech_intel node scripts/architecture/extract.mjs
 *   # (falls back to DATABASE_URL if ARCH_DB_URL is unset)
 *
 * Then `node scripts/architecture/generate.mjs` re-renders docs/architecture/explorer.html.
 * Introspection-only — reads information_schema, writes nothing to the database.
 */
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const url = process.env.ARCH_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('extract: set ARCH_DB_URL (or DATABASE_URL) to a migrated govtech_intel database.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connection: { application_name: 'arch-extract' } });

const TYPE = `CASE
  WHEN data_type='USER-DEFINED' THEN udt_name
  WHEN data_type='character varying' THEN 'varchar'
  WHEN data_type='timestamp with time zone' THEN 'timestamptz'
  WHEN data_type='timestamp without time zone' THEN 'timestamp'
  WHEN data_type='double precision' THEN 'float8'
  ELSE data_type END`;

try {
  const cols = await sql.unsafe(`
    SELECT table_name, column_name, ${TYPE} AS type, (is_nullable='YES') AS nullable, ordinal_position
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name, ordinal_position`);

  const pks = await sql.unsafe(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
    WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'`);

  const fkRows = await sql.unsafe(`
    SELECT DISTINCT tc.table_name AS "table", kcu.column_name AS col,
           ccu.table_name AS "refTable", ccu.column_name AS "refCol"
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`);

  const tables = {};
  for (const c of cols) {
    (tables[c.table_name] ??= { columns: [], pk: [] }).columns.push({ name: c.column_name, type: c.type, nullable: c.nullable });
  }
  for (const p of pks) tables[p.table_name]?.pk.push(p.column_name);
  const fks = fkRows.map((f) => ({ table: f.table, col: f.col, refTable: f.refTable, refCol: f.refCol }));

  const model = { tables, fks };
  const out = join(HERE, 'model', 'schema.json');
  writeFileSync(out, JSON.stringify(model));
  console.error(`extract: ${Object.keys(tables).length} tables · ${fks.length} FKs → ${out}`);
} catch (e) {
  console.error('extract failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
