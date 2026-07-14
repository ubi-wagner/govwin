#!/usr/bin/env node
/**
 * Seed the RFP Pipeline marketing collateral into the RFP-admin library.
 *
 * Installs the four canvas-model documents (built in our own CanvasDocument model —
 * "eating our own cooking") as system `document_templates` rows (is_system=true,
 * tenant_id NULL = the admin library, visible to rfp_admin/master_admin):
 *   · EconDev Solution Overview (1-pager)      · Founder's One-Page Solution Overview
 *   · Two-Page Capture Brief (p2 = value + financials)  · Investor Overview (5-slide deck)
 *
 * Source data: scripts/data/collateral_templates.json (canvas-only). Polished, viewable
 * HTML+SVG renders live in docs/collateral/*.html. Idempotent (delete-by-name then insert).
 *
 * Usage: DATABASE_URL=... node scripts/seed_collateral_templates.mjs
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const templates = JSON.parse(readFileSync(join(here, 'data', 'collateral_templates.json'), 'utf8'));
const sql = postgres(DATABASE_URL);

try {
  for (const t of templates) {
    const doc = t.canvasDocument || {};
    const nodeCount = Array.isArray(doc.nodes) ? doc.nodes.length : 0;
    await sql`DELETE FROM document_templates WHERE is_system = true AND name = ${t.name}`;
    await sql`
      INSERT INTO document_templates
        (name, description, template_type, program_type, canvas_preset, canvas_document, node_count, is_system, metadata)
      VALUES (
        ${t.name},
        ${'RFP Pipeline marketing collateral — built in the canvas model (' + t.key + ')'},
        ${t.templateType || 'custom'},
        ${'marketing'},
        ${sql.json({})},
        ${sql.json(doc)},
        ${nodeCount},
        true,
        ${sql.json({ kind: 'marketing_collateral', key: t.key, svgCount: t.svgCount ?? null })}
      )`;
    console.log(`✓ ${String(t.templateType).padEnd(10)} n=${nodeCount}  ${t.name}`);
  }
  console.log(`\nDone — ${templates.length} collateral templates in the RFP-admin library.`);
} finally {
  await sql.end();
}
