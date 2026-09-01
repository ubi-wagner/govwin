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

  // ── REFUSE A MODEL WITH NO RELATIONSHIPS ────────────────────────────────────────────────────
  // `information_schema.constraint_column_usage` shows only constraints on tables the CURRENT ROLE
  // owns or holds a privilege on. Run as the scoped `govtech_app` role, every column and primary
  // key still comes back and the FK join returns EMPTY — so this wrote a 139-table model with 0
  // foreign keys, printed a success line, and the generator built a 187 KB explorer (vs 232) whose
  // entire subject, the relationships, was missing. Nothing failed. Nothing looked wrong.
  //
  // A schema with tables and no foreign keys is not a schema anybody ships, so treat it as what it
  // is: the extractor could not see what it exists to extract. Exit 2 — cannot earn a verdict —
  // rather than overwrite a good model with a silent one.
  const tableCount = Object.keys(tables).length;
  if (tableCount > 0 && fks.length === 0) {
    console.error(
      `extract: CANNOT EARN A VERDICT — ${tableCount} tables and 0 foreign keys. Almost certainly a\n`
      + `  PRIVILEGE problem, not a schema without relationships: information_schema hides\n`
      + `  constraints on tables the connected role has no privilege on. Re-run against the OWNER:\n`
      + `    ARCH_DB_URL="$DATABASE_URL_OWNER" node frontend/scripts/architecture/extract.mjs\n`
      + `  The existing model has been left alone.`);
    process.exitCode = 2;
  } else {
    const model = { tables, fks };
    const out = join(HERE, 'model', 'schema.json');
    writeFileSync(out, JSON.stringify(model));
    console.error(`extract: ${tableCount} tables · ${fks.length} FKs → ${out}`);
  }
} catch (e) {
  console.error('extract failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
