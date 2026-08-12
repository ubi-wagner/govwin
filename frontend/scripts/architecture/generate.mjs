#!/usr/bin/env node
/**
 * generate.mjs — merge the extracted schema (model/schema.json) with the curated overlay
 * (overlay.json) into the enriched model, and inject it into template.html to produce the
 * self-contained interactive explorer at docs/architecture/explorer.html.
 *
 *   node scripts/architecture/generate.mjs
 *
 * No database needed here — it consumes what extract.mjs already wrote. Re-run extract first
 * when the schema changed; re-run this whenever schema.json OR overlay.json changes.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const read = (p) => readFileSync(p, 'utf8');

const schema  = JSON.parse(read(join(HERE, 'model', 'schema.json')));
const overlay = JSON.parse(read(join(HERE, 'overlay.json')));
const template = read(join(HERE, 'template.html'));

// migration head — highest NNN_ prefix in db/migrations (accurate "as of")
let migrationHead = 0;
try {
  for (const f of readdirSync(join(ROOT, 'db', 'migrations'))) {
    const m = /^(\d{3})_/.exec(f);
    if (m) migrationHead = Math.max(migrationHead, parseInt(m[1], 10));
  }
} catch { /* leave 0 */ }

const assign = (name) => {
  for (const s of overlay.subsystems) {
    if (s.id === 'other') continue;
    if (s.exact?.includes(name)) return s.id;
    if (s.match?.some((p) => name.startsWith(p))) return s.id;
  }
  return 'other';
};

// index FK edges both directions
const outBy = {}, inBy = {};
for (const f of schema.fks) {
  (outBy[f.table] ??= []).push(f);
  (inBy[f.refTable] ??= []).push({ fromTable: f.table, col: f.col });
}

const tables = {};
for (const [name, t] of Object.entries(schema.tables)) {
  const outs = outBy[name] || [];
  const byCol = new Map(outs.map((f) => [f.col, f]));
  tables[name] = {
    subsystem: assign(name),
    isView: name.startsWith('v_'),
    pk: t.pk,
    columns: t.columns.map((c) => ({
      name: c.name, type: c.type, nullable: c.nullable,
      pk: t.pk.includes(c.name),
      fk: byCol.has(c.name) ? { refTable: byCol.get(c.name).refTable, refCol: byCol.get(c.name).refCol } : null,
    })),
    out: outs.map((f) => ({ col: f.col, refTable: f.refTable, refCol: f.refCol })),
    in: (inBy[name] || []).map((e) => ({ fromTable: e.fromTable, col: e.col })),
  };
}

const model = {
  meta: { source: 'govtech_intel', migrationHead, tableCount: Object.keys(tables).length, fkCount: schema.fks.length },
  subsystems: overlay.subsystems.map(({ id, label, hue, match, exact }) => ({ id, label, hue, match: match || [], exact: exact || [] })),
  tables, traces: overlay.traces, uis: overlay.uis,
};

const marker = '/*__ARCH_MODEL__*/';
if (!template.includes(marker)) { console.error('generate: template.html is missing the ' + marker + ' marker'); process.exit(1); }
// embed as JSON inside a <script type="application/json"> block; escape < to keep the parser safe
const payload = JSON.stringify(model).replace(/</g, '\\u003c');
const html = template.replace(marker, payload);

// Write both the canonical docs copy AND the in-app static asset (served at
// /architecture/explorer.html and embedded on /admin/architecture).
const outputs = [
  join(ROOT, 'docs', 'architecture', 'explorer.html'),
  join(HERE, '..', '..', 'public', 'architecture', 'explorer.html'),
];
for (const out of outputs) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, html); }
console.error(`generate: ${model.meta.tableCount} tables · ${model.meta.fkCount} FKs · mig ${migrationHead} · ${(html.length / 1024).toFixed(0)} KB → ${outputs.length} outputs`);
