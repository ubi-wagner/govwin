import fs from 'node:fs';
const TS = '2026-08-04T00:00:00.000Z';
const rules = { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, header: null, footer: null, font_default: { family: 'Calibri', size: 11 }, line_spacing: 1.15, max_pages: null, max_slides: null };
let seq = 0;
const mk = (pfx, type, content, style = {}) => ({ id: `tpl-${pfx}-${String(++seq).padStart(2, '0')}`, type, content, style, provenance: { source: 'template', drafted_at: TS }, history: [], library_eligible: !['divider', 'spacer'].includes(type) });
const H = (p, l, t) => mk(p, 'heading', { level: l, text: t });
const T = (p, t) => mk(p, 'text_block', { text: t });
const BL = (p, i) => mk(p, 'bulleted_list', { items: i.map((x) => ({ text: x })) });
const TBL = (p, h, r) => mk(p, 'table', { headers: h, rows: r, header_style: { bold: true }, border_style: 'single' });
const doc = (id, nodes) => ({ version: 1, document_id: id, canvas: rules, nodes, metadata: { title: '', created_at: TS, last_modified_at: TS, version_number: 1, status: 'empty' } });

seq = 0;
const cap = doc('cap', [
  H('cap', 1, '[Company Name] — Capability Statement'),
  T('cap', '[One-line positioning: who you are, what you build, and the mission you serve.]'),
  H('cap', 2, 'Core Competencies'),
  BL('cap', ['[Core competency / technical capability 1]', '[Core competency 2]', '[Core competency 3]', '[Core competency 4]']),
  H('cap', 2, 'Differentiators'),
  BL('cap', ['[What sets you apart — proprietary tech, credentials, results]', '[Differentiator 2]', '[Differentiator 3]']),
  H('cap', 2, 'Past Performance'),
  T('cap', '[Contract / project — customer agency, scope, period of performance, value, and outcome.]'),
  T('cap', '[Second past-performance reference.]'),
  H('cap', 2, 'Corporate Data'),
  TBL('cap', ['Field', 'Detail'], [['NAICS Codes', '[e.g., 541715, 236220]'], ['Certifications', '[SDVOSB / 8(a) / WOSB / HUBZone / …]'], ['UEI / CAGE', '[UEI] / [CAGE]'], ['Socio-economic status', '[Small business status]']]),
  H('cap', 2, 'Contact'),
  T('cap', '[Name · Title] · [email] · [phone] · [website]'),
]);

seq = 0;
const es = doc('es', [
  H('es', 1, 'Executive Summary'),
  T('es', '[Opening — the opportunity, the agency’s objective, and why your team is the right partner. Two or three sentences.]'),
  H('es', 2, 'The Problem / Need'),
  T('es', '[State the agency’s problem or requirement in their terms — the gap this proposal closes.]'),
  H('es', 2, 'Our Solution'),
  T('es', '[Your technical approach at a glance — what you will deliver and how it meets the requirement.]'),
  H('es', 2, 'Why Us'),
  BL('es', ['[Directly relevant past performance]', '[Key differentiator / proprietary capability]', '[Team, partners, and facilities]']),
  H('es', 2, 'Outcomes & Value'),
  T('es', '[Expected results, milestones/timeline, and the value delivered to the agency — including commercialization or transition where applicable.]'),
]);

const capJson = JSON.stringify(cap), esJson = JSON.stringify(es);
if (capJson.includes('$tpl$') || esJson.includes('$tpl$')) throw new Error('delimiter collision');

const sql = `-- 150_seed_system_templates.sql
-- Idempotent seed: SYSTEM document_templates (tenant_id NULL, is_system = true), available to every
-- tenant in the "New document -> Start from a template" chooser (portal /templates lists tenant +
-- is_system rows). Each carries a canvas_document skeleton that starterFromTemplate flattens into an
-- editable starter (headings + bracketed placeholders). Safe to re-run: ON CONFLICT (id) DO UPDATE
-- refreshes the skeleton.

INSERT INTO document_templates (id, name, description, template_type, canvas_preset, node_count, is_system, tenant_id, metadata, canvas_document)
VALUES
  ('e11a7e00-0000-4000-8000-000000000001'::uuid,
   'Capability Statement',
   'A one-page government capability statement -- core competencies, differentiators, past performance, corporate data (NAICS / certs / UEI / CAGE), and contact.',
   'custom', '{}'::jsonb, ${cap.nodes.length}, true, NULL,
   '{"category":"company","source":"rfp_pipeline_system"}'::jsonb,
   $tpl$${capJson}$tpl$::jsonb),
  ('e11a7e00-0000-4000-8000-000000000002'::uuid,
   'Executive Summary',
   'A proposal executive-summary skeleton -- the opportunity, the problem/need, your solution, why-us, and outcomes & value.',
   'abstract', '{}'::jsonb, ${es.nodes.length}, true, NULL,
   '{"category":"proposal","source":"rfp_pipeline_system"}'::jsonb,
   $tpl$${esJson}$tpl$::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, template_type = EXCLUDED.template_type,
      node_count = EXCLUDED.node_count, canvas_document = EXCLUDED.canvas_document,
      metadata = EXCLUDED.metadata, updated_at = now();
`;
fs.writeFileSync('/home/user/govwin/db/migrations/150_seed_system_templates.sql', sql);
console.log('migration 150 written | cap', cap.nodes.length, 'nodes | es', es.nodes.length, 'nodes |', sql.length, 'bytes');
