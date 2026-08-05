import fs from 'node:fs';
const SP = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const TS = '2026-08-04T00:00:00.000Z';
const letter = { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, header: null, footer: null, font_default: { family: 'Calibri', size: 11 }, line_spacing: 1.15, max_pages: null, max_slides: null };
const slide = { format: 'slide_16_9', width: 960, height: 540, margins: { top: 40, right: 40, bottom: 40, left: 40 }, header: null, footer: null, font_default: { family: 'Arial', size: 18 }, line_spacing: 1.2, max_pages: null, max_slides: 25 };
let seq = 0;
const mk = (pfx, type, content, style = {}) => ({ id: `tpl-${pfx}-${String(++seq).padStart(2, '0')}`, type, content, style, provenance: { source: 'template', drafted_at: TS }, history: [], library_eligible: !['divider', 'spacer', 'page_break'].includes(type) });
const H = (p, l, t) => mk(p, 'heading', { level: l, text: t });
const T = (p, t) => mk(p, 'text_block', { text: t });
const BL = (p, i) => mk(p, 'bulleted_list', { items: i.map((x) => ({ text: x })) });
const NL = (p, i) => mk(p, 'numbered_list', { items: i.map((x) => ({ text: x })) });
const TBL = (p, h, r) => mk(p, 'table', { headers: h, rows: r, header_style: { bold: true }, border_style: 'single' });
const PB = (p) => mk(p, 'page_break', null);
const doc = (id, nodes, canvas) => ({ version: 1, document_id: id, canvas: canvas || letter, nodes, metadata: { title: '', created_at: TS, last_modified_at: TS, version_number: 1, status: 'empty' } });

// ── 3) Pitch Deck (slide_16_9) — one heading+bullets per slide, page_break between ──
seq = 0;
const deckSlides = [
  ['[Company] — [One-line value proposition]', ['[Your name · title · contact]', '[Federal focus: SBIR · STTR · BAA · OTA]']],
  ['The Problem', ['[The agency / mission problem, in their terms]', '[Why it matters now]', '[Cost of the status quo]']],
  ['Our Solution', ['[What you deliver]', '[How it works, at a glance]', '[Key innovation / differentiator]']],
  ['Why Us', ['[Relevant past performance]', '[Team & facilities]', '[Certifications / credentials]']],
  ['Traction & Proof', ['[Milestones to date]', '[Pilots / customers / results]', '[Technical readiness (TRL)]']],
  ['Market & Transition', ['[Target customers / programs]', '[Commercialization / transition path]', '[Dual-use / scale]']],
  ['The Ask', ['[Phase / vehicle you are pursuing]', '[Budget & period of performance]', '[Next step]']],
];
const deckNodes = [];
deckSlides.forEach((s, i) => { if (i > 0) deckNodes.push(PB('dk')); deckNodes.push(H('dk', 1, s[0])); deckNodes.push(BL('dk', s[1])); });
const deck = doc('dk', deckNodes, slide);

// ── 4) Past Performance write-up (letter) ──
seq = 0;
const pp = doc('pp', [
  H('pp', 1, '[Contract / Program Name]'),
  TBL('pp', ['Field', 'Detail'], [['Customer / Agency', '[Agency · contracting office]'], ['Contract / Award No.', '[No.]'], ['Period of Performance', '[Start – End]'], ['Value', '[$ amount]'], ['Your Role', '[Prime / Sub]'], ['Vehicle', '[SBIR / STTR / BAA / OTA / IDIQ / …]']]),
  H('pp', 2, 'Scope & Objectives'),
  T('pp', '[What the agency needed and what you were tasked to deliver.]'),
  H('pp', 2, 'Approach'),
  T('pp', '[How you executed — technical approach, methods, and key personnel.]'),
  H('pp', 2, 'Outcomes & Results'),
  BL('pp', ['[Quantified result / deliverable 1]', '[Result 2]', '[Award, follow-on, or transition]']),
  H('pp', 2, 'Relevance to This Opportunity'),
  T('pp', '[Why this past performance directly de-risks the current pursuit.]'),
]);

// ── 1) Platform Overview & Capabilities (reuse the seeded overview canvas nodes) ──
const overviewNodes = JSON.parse(fs.readFileSync(`${SP}/canvas-seed.json`, 'utf8')).nodes;
const overview = doc('pov', overviewNodes, letter);

// ── 2) Platform Cut Sheet (2-page) — canvas version of the cut sheet content ──
seq = 0;
const cut = doc('cut', [
  H('cut', 1, 'RFP Pipeline — Platform Cut Sheet'),
  T('cut', 'AI + Expert · From Application to Submission. A proposal engine, not a proposal gamble.'),
  T('cut', 'Win non-dilutive federal R&D funding — without burning a month of payroll on every submission. 25 years of hands-on expertise + isolated, company-specific AI. SBIR · STTR · BAA · OTA · CSO · Grants.'),
  TBL('cut', ['Federal Sources', 'Expert-Review SLA', 'Years Fed R&D', 'Human-Gated AI'], [['4+', '72 hours', '25+', '100%']]),
  H('cut', 2, 'The economics'),
  TBL('cut', ['The status quo', 'What it costs you', 'RFP Pipeline'], [['Opportunity monitoring', '~$5,000 / month for a feed you still triage', 'Included'], ['Proposal consultant', 'Commonly ~10% of the award as a success fee', 'Flat fee, no success fee'], ['Your team’s time', 'A month of payroll per submission, from scratch', 'Draft from your library']]),
  T('cut', 'The math: replaces a $5,000/mo monitoring service and a 10%-of-award consultant — for $499/mo and a flat per-proposal fee. No success fee, ever.'),
  H('cut', 2, 'The platform at a glance'),
  BL('cut', [
    'Discovery & ranked pipeline — daily ingestion across SAM.gov, SBIR.gov, Grants.gov & agency portals, ranked to your tech areas.',
    'Scoring buckets — rank the whole pipeline by your own keywords, agencies, program types & NAICS.',
    'Expert curation (72h SLA) — a real expert provisions your compliance matrix, volumes & section molds.',
    'Isolated, company-specific AI — walled to your company; no model training on your data; injection-fenced.',
    'Reusable content library — upload → atomize → reuse; copied forward into every proposal.',
    'Workspace & compliance matrix — stage-gated build, per-section lock, live requirement coverage.',
    'Proposal Studio — Draft → Refine → Compliance, gated; you approve at each step.',
    'AI review & compliance check — color-team recommendations + pass/fail requirement scoring.',
    'Submission-ready exports — Word, PDF, Excel & per-volume ZIP + a packaging-completeness review.',
    'Outcome → contract — a win starts your contract + kickoff; every result sharpens your library.',
  ]),
  H('cut', 2, 'Pricing'),
  TBL('cut', ['Plan', 'Price', 'Included'], [['Spotlight Subscription (monthly)', '$499 / mo', 'Daily ingestion, AI ranking, expert-curated compliance matrix, deadline alerts. Required to buy any portal.'], ['Phase I — Like Effort', '$1,999 ea', 'SBIR/STTR Phase I, smaller BAA, OTA/CSO short-form. 72-hour expert curation.'], ['Phase II — Like Effort', '$4,999 ea', 'SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. $3,999 with a linked Phase I.']]),
  T('cut', 'Trust & control: multi-tenant isolation · no model training · full audit trail · AI advisory & human-gated · injection-fenced · governed AI (budget/rate caps). Book a walkthrough, or apply for the Founding Cohort. Platform launches August 2026.'),
]);

const rows = [
  { id: 'e11a7e00-0000-4000-8000-000000000003', name: 'Pitch Deck', type: 'slide_deck', cat: 'proposal', d: 'A 7-slide pitch/capability deck skeleton (16:9) — problem, solution, why-us, traction, market/transition, and the ask.', doc: deck },
  { id: 'e11a7e00-0000-4000-8000-000000000004', name: 'Past Performance', type: 'past_performance', cat: 'proposal', d: 'A past-performance write-up skeleton — contract facts (agency, value, PoP, role, vehicle), scope, approach, outcomes, and relevance.', doc: pp },
  { id: 'e11a7e00-0000-4000-8000-000000000005', name: 'Platform Overview & Capabilities', type: 'custom', cat: 'reference', d: 'The RFP Pipeline platform overview — capabilities, lifecycle, trust, and pricing. A reference/example canvas you can copy and adapt.', doc: overview },
  { id: 'e11a7e00-0000-4000-8000-000000000006', name: 'Platform Cut Sheet (2-page)', type: 'custom', cat: 'reference', d: 'The RFP Pipeline two-page cut sheet — hook, economics, capabilities-at-a-glance, and pricing. A reference/example canvas.', doc: cut },
];
for (const r of rows) { if (JSON.stringify(r.doc).includes('$tpl$')) throw new Error('delim ' + r.name); }
const esc = (s) => s.replace(/'/g, "''");
const values = rows.map((r) => `  ('${r.id}'::uuid,
   '${esc(r.name)}',
   '${esc(r.d)}',
   '${r.type}', '{}'::jsonb, ${r.doc.nodes.length}, true, NULL,
   '{"category":"${r.cat}","source":"rfp_pipeline_system"}'::jsonb,
   $tpl$${JSON.stringify(r.doc)}$tpl$::jsonb)`).join(',\n');
const sql = `-- 151_seed_system_templates_more.sql
-- Idempotent seed: four more SYSTEM document_templates (tenant_id NULL, is_system = true), joining
-- the two from mig 150. System templates are SHARED — they surface in every tenant's "New document
-- -> Start from a template" chooser AND on the RFP-admin platform tenant (the portal /templates GET
-- returns tenant + is_system rows), so a single is_system seed covers BOTH the RFP-admin and every
-- tenant-admin. starterFromTemplate copies the skeleton into a fresh editable canvas on use.
--   3. Pitch Deck (slide_16_9)      4. Past Performance
--   5. Platform Overview & Capabilities (reference)   6. Platform Cut Sheet 2-page (reference)
-- Safe to re-run: ON CONFLICT (id) DO UPDATE refreshes each skeleton.

INSERT INTO document_templates (id, name, description, template_type, canvas_preset, node_count, is_system, tenant_id, metadata, canvas_document)
VALUES
${values}
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, template_type = EXCLUDED.template_type,
      node_count = EXCLUDED.node_count, canvas_document = EXCLUDED.canvas_document,
      metadata = EXCLUDED.metadata, updated_at = now();
`;
fs.writeFileSync('/home/user/govwin/db/migrations/151_seed_system_templates_more.sql', sql);
console.log('migration 151:', rows.map((r) => `${r.name}(${r.doc.nodes.length})`).join(', '), '|', sql.length, 'bytes');
