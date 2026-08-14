/**
 * Shared helpers for the NILOC Technologies gold-example set.
 *
 * NILOC is the parent company of RFP Pipeline. These examples are built from real,
 * IP-safe federal technologies offered for license through the DoD tech-transfer
 * ecosystem (TechLink / lab T2 offices) — so they read as genuine proposals NILOC could
 * file, with no third-party IP exposure. Eric Wagner (Founder & CEO) is the Principal
 * Investigator. Unverifiable specifics are marked [confirm] or shown as [bracketed]
 * planning estimates in the narratives.
 *
 * The technologies (base patent honestly cited in each narrative):
 *   · CADENCE™   — Pattern-of-Life / activity-based-intelligence analytics (AFRL, Rome NY)
 *   · AURA™      — Counter-UAS RF sensing / passive electronic support (NSWC Crane)
 *   · PolarHawk™ — Low-SWaP compact-polarimetric monopulse radar for small-UAS (NRL)
 *
 * Coverage spans the proposal FORMS the platform handles: SBIR Phase I & Phase II
 * technical volumes, a CSO solution brief, an NSF Project Pitch, and a NASA SBIR Phase I —
 * plus 24-month / base+option / single-period burden-waterfall cost workbooks whose
 * roll-ups mirror the portal cost engine (lib/proposal/cost-model.ts) to the cent.
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildBurdenCostSheet } from '@/lib/templates/cost/burden-cost-sheet';
import { createNode, type CanvasDocument, type CanvasNode, type CanvasSection } from '@/lib/types/canvas-document';

export const NILOC_TENANT_SLUG = 'niloc';
export const NILOC_TENANT_ID = 'd5386192-2aca-4d77-8d1e-61719ee34cce';
export const ERIC_USER_ID = '1bc09a41-c018-4738-9dcd-9a1b1cf88894';
export const HERE = dirname(fileURLToPath(import.meta.url));

// ── the prose proposals (markdown → sectioned canvas), one per (technology × form) ──
export interface ProseDoc { file: string; tag: string; title: string; docType: string }
export const PROSE_DOCS: ProseDoc[] = [
  // SBIR Phase II technical volumes (the flagship three)
  { file: 'cadence-technical.md', tag: 'CADENCE', docType: 'technical_volume', title: 'CADENCE — Pattern-of-Life Analytics (SBIR Phase II Technical Volume)' },
  { file: 'aura-technical.md', tag: 'AURA', docType: 'technical_volume', title: 'AURA — Counter-UAS RF Sensing (SBIR Phase II Technical Volume)' },
  { file: 'polarhawk-technical.md', tag: 'PolarHawk', docType: 'technical_volume', title: 'PolarHawk — Compact-Polarimetric Radar for sUAS (SBIR Phase II Technical Volume)' },
  // other forms across the same technologies
  { file: 'aura-phase1.md', tag: 'AURA-PhaseI', docType: 'technical_volume', title: 'AURA — Counter-UAS RF Sensing (Navy SBIR Phase I Technical Volume)' },
  { file: 'cadence-cso.md', tag: 'CADENCE-CSO', docType: 'custom', title: 'CADENCE — Pattern-of-Life Analytics (CSO Solution Brief)' },
  { file: 'polarhawk-nsf.md', tag: 'PolarHawk-NSF', docType: 'custom', title: 'PolarHawk — Compact-Polarimetric Radar (NSF Project Pitch)' },
  { file: 'cadence-nasa.md', tag: 'CADENCE-NASA', docType: 'technical_volume', title: 'CADENCE-ISHM — Spacecraft Anomaly Detection (NASA SBIR Phase I)' },
  // Ohio Third Frontier TVSF — NILOC licenses Battelle "OATS" (US 12,430,376), the RFP-Pipeline-adjacent tech
  { file: 'tvsf-application.md', tag: 'TVSF-OATS', docType: 'custom', title: 'NILOC — Document Intelligence via Battelle OATS (Ohio Third Frontier TVSF Application)' },
];
/** Back-compat alias — the first three are the SBIR Phase II technical volumes. */
export const TECH_VOLUMES = PROSE_DOCS.slice(0, 3);

export function readProse(file: string): string { return readFileSync(join(HERE, file), 'utf8'); }
export function proseExistsOnDisk(file: string): boolean { return existsSync(join(HERE, file)); }
export const readTech = readProse;                    // legacy name

// markdown → flat canvas nodes (headings / lists / paragraphs)
export function mdToNodes(md: string): CanvasNode[] {
  const nodes: CanvasNode[] = []; const lines = md.split('\n'); let i = 0;
  const mk = (type: CanvasNode['type'], content: CanvasNode['content']) => createNode({ type, content, source: 'imported', actorId: ERIC_USER_ID, actorName: 'Eric Wagner' });
  while (i < lines.length) {
    const line = lines[i]; const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) { const lvl = Math.min(hm[1].length, 3) as 1 | 2 | 3; nodes.push(mk('heading', { level: lvl, text: hm[2].trim() })); i++; continue; }
    if (/^\s*[-*]\s/.test(line) || /^\s*\d+[.)]\s/.test(line)) {
      const numbered = /^\s*\d+[.)]\s/.test(line); const items: Array<{ text: string }> = [];
      while (i < lines.length && (/^\s*[-*]\s/.test(lines[i]) || /^\s*\d+[.)]\s/.test(lines[i]))) { const t = lines[i].replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim(); if (t) items.push({ text: t.replace(/\*\*/g, '') }); i++; }
      if (items.length) nodes.push(mk(numbered ? 'numbered_list' : 'bulleted_list', { items })); continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,3}\s/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+[.)]\s/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    const text = para.join(' ').replace(/\*\*/g, '').replace(/`/g, '').trim(); if (text) nodes.push(mk('text_block', { text }));
  }
  return nodes;
}
export function toSections(nodes: CanvasNode[]): CanvasSection[] {
  const sections: CanvasSection[] = []; let cur: CanvasNode[] = []; let title: string | undefined;
  const flush = () => { if (cur.length) sections.push({ id: crypto.randomUUID(), title, layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes: cur }] }); };
  for (const n of nodes) { if (n.type === 'heading') { flush(); cur = [n]; title = (n.content as { text?: string })?.text; } else cur.push(n); }
  flush(); return sections;
}
export function proseDoc(md: string, title: string): CanvasDocument {
  const now = '2026-01-01T00:00:00Z';
  return {
    version: 2, document_id: crypto.randomUUID(),
    canvas: { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, header: null, footer: { template: 'NILOC Technologies · Proprietary · {n} / {N}', height: 36, font: { family: 'Times New Roman', size: 9 } }, font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1.15, max_pages: null, max_slides: null },
    sections: toSections(mdToNodes(md)),
    metadata: { title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: now, last_modified_at: now, last_modified_by: ERIC_USER_ID, version_number: 1, status: 'ai_drafted' },
  };
}
export const techDoc = proseDoc;                      // legacy name

// ── cost volumes (period-generic burden waterfall) ──
export type LaborLineSpec = { rate: number; hours: number[] } | null;   // hours length = periods
export interface CostSpec {
  key: string; tag: string; title: string; topic: string;
  program?: 'sbir' | 'sttr' | 'grant';
  periods: { name: string; months: number }[];
  ceilingNote?: string;
  rates: { fringePct: number; overheadPct: number; gnaPct: number; feePct: number };
  labor: LaborLineSpec[];                              // length 9, aligned to LABOR_CODES rows
  materials: number[]; travel: number[]; equipment: number[]; other: number[]; subs: number[]; // each length = periods
  subOrg: string;
}
const Y2 = [{ name: 'Year 1', months: 12 }, { name: 'Year 2', months: 12 }];
const P1BO = [{ name: 'Base', months: 6 }, { name: 'Option', months: 6 }];
const P1S = [{ name: 'Period of Performance', months: 6 }];
export const COST_SPECS: CostSpec[] = [
  { key: 'cadence', tag: 'CADENCE', topic: 'AF SBIR Phase II — Pattern-of-Life Analytics', title: 'NILOC · CADENCE Cost Volume (Phase II, 24 mo)', periods: Y2, ceilingNote: 'confirm the Phase II ceiling in your solicitation', rates: { fringePct: 0.30, overheadPct: 0.55, gnaPct: 0.12, feePct: 0.07 }, labor: [{ rate: 110, hours: [420, 380] }, { rate: 96, hours: [720, 720] }, { rate: 88, hours: [820, 820] }, { rate: 72, hours: [760, 800] }, { rate: 80, hours: [800, 820] }, null, null, { rate: 82, hours: [240, 240] }, { rate: 46, hours: [140, 140] }], materials: [22000, 18000], travel: [10000, 12000], equipment: [14000, 0], other: [3000, 3000], subs: [70000, 60000], subOrg: 'University ML research partner (STTR-style RI collaboration)' },
  { key: 'aura', tag: 'AURA', topic: 'NAVY SBIR Phase II — Counter-UAS RF Sensing', title: 'NILOC · AURA Cost Volume (Phase II, 24 mo)', periods: Y2, ceilingNote: 'confirm the Phase II ceiling in your solicitation', rates: { fringePct: 0.30, overheadPct: 0.58, gnaPct: 0.13, feePct: 0.07 }, labor: [{ rate: 110, hours: [330, 300] }, { rate: 98, hours: [500, 500] }, { rate: 92, hours: [720, 720] }, { rate: 74, hours: [560, 580] }, { rate: 80, hours: [500, 520] }, { rate: 84, hours: [380, 360] }, { rate: 54, hours: [420, 440] }, { rate: 82, hours: [180, 180] }, { rate: 46, hours: [110, 110] }], materials: [35000, 28000], travel: [12000, 14000], equipment: [45000, 15000], other: [5000, 5000], subs: [40000, 35000], subOrg: 'RF antenna / range-test subcontractor' },
  { key: 'polarhawk', tag: 'PolarHawk', topic: 'NAVY SBIR Phase II — Compact-Polarimetric Radar for sUAS', title: 'NILOC · PolarHawk Cost Volume (Phase II, 24 mo)', periods: Y2, ceilingNote: 'confirm the Phase II ceiling in your solicitation', rates: { fringePct: 0.30, overheadPct: 0.60, gnaPct: 0.13, feePct: 0.07 }, labor: [{ rate: 110, hours: [300, 270] }, { rate: 100, hours: [480, 480] }, { rate: 94, hours: [680, 680] }, { rate: 74, hours: [520, 540] }, { rate: 80, hours: [480, 500] }, { rate: 86, hours: [420, 400] }, { rate: 55, hours: [460, 480] }, { rate: 82, hours: [170, 170] }, { rate: 46, hours: [100, 100] }], materials: [40000, 30000], travel: [12000, 14000], equipment: [70000, 20000], other: [6000, 6000], subs: [55000, 45000], subOrg: 'Antenna fabrication / range-test subcontractor' },
  // AURA — Navy SBIR Phase I feasibility (Base 6 mo + Option 6 mo, ≈ $150K base ceiling)
  { key: 'aura-p1', tag: 'AURA-PhaseI', topic: 'NAVY SBIR Phase I — Counter-UAS RF Sensing (feasibility)', title: 'NILOC · AURA Cost Volume (Navy Phase I, Base 6 mo + Option 6 mo)', periods: P1BO, program: 'sbir', ceilingNote: 'confirm the Phase I base + option ceiling (~$150K base)', rates: { fringePct: 0.30, overheadPct: 0.58, gnaPct: 0.13, feePct: 0.07 }, labor: [{ rate: 110, hours: [120, 90] }, null, { rate: 92, hours: [240, 170] }, { rate: 74, hours: [200, 150] }, null, null, { rate: 54, hours: [60, 40] }, null, null], materials: [8000, 6000], travel: [3000, 3000], equipment: [0, 0], other: [1000, 1000], subs: [3000, 2000], subOrg: 'RF test support' },
  // CADENCE-ISHM — NASA SBIR Phase I (single 6-mo period, ≈ $150K)
  { key: 'cadence-nasa-p1', tag: 'CADENCE-NASA', topic: 'NASA SBIR Phase I — Spacecraft ISHM / Anomaly Detection', title: 'NILOC · CADENCE-ISHM Cost Volume (NASA Phase I, 6 mo)', periods: P1S, program: 'sbir', ceilingNote: 'confirm the NASA Phase I ceiling (~$150K)', rates: { fringePct: 0.30, overheadPct: 0.55, gnaPct: 0.12, feePct: 0.07 }, labor: [{ rate: 110, hours: [120] }, { rate: 96, hours: [260] }, null, null, { rate: 80, hours: [220] }, null, null, null, null], materials: [8000], travel: [2000], equipment: [0], other: [2000], subs: [0], subOrg: 'n/a' },
];

// ── mini spreadsheet engine over the is_spreadsheet table nodes ──
type Sheets = Map<string, unknown[][]>;
export function loadSheets(doc: CanvasDocument): Sheets {
  const s: Sheets = new Map();
  for (const n of doc.nodes ?? []) { const c = n.content as { is_spreadsheet?: boolean; sheet_name?: string; rows?: unknown[][] }; if (c?.is_spreadsheet && c.sheet_name && c.rows) s.set(c.sheet_name, c.rows); }
  return s;
}
function colIdx(letters: string): number { let x = 0; for (const ch of letters) x = x * 26 + (ch.charCodeAt(0) - 64); return x; }
export function colLetters(n: number): string { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
type Cell = { formula?: string; value?: number; text?: string; number_format?: string };
function cellObj(sh: Sheets, sheet: string, col: string, row: number): Cell | undefined { return (sh.get(sheet)![row - 2] as Cell[] | undefined)?.[colIdx(col) - 1]; }
export function cellAt(sh: Sheets, sheet: string, col: string, row: number): number {
  const cell = cellObj(sh, sheet, col, row); if (cell == null) return 0;
  if (typeof cell.formula === 'string') return evalFormula(cell.formula, sh, sheet);
  if (typeof cell.value === 'number') return cell.value;
  const t = String(cell.text ?? '').replace(/[$,%\s]/g, ''); const num = parseFloat(t); return Number.isFinite(num) ? num : 0;
}
export function evalFormula(formula: string, sh: Sheets, cur: string): number {
  let e = formula.replace(/^=/, '');
  e = e.replace(/SUM\(([^)]+)\)/gi, (_m, rng: string) => { let sheet = cur, r = rng; const sm = rng.match(/^([A-Za-z0-9_]+)!(.+)$/); if (sm) { sheet = sm[1]; r = sm[2]; } const [a, b] = r.split(':'); const pa = a.match(/\$?([A-Z]+)\$?(\d+)/)!, pb = b.match(/\$?([A-Z]+)\$?(\d+)/)!; const c1 = colIdx(pa[1]), c2 = colIdx(pb[1]), r1 = +pa[2], r2 = +pb[2]; let sum = 0; for (let ci = Math.min(c1, c2); ci <= Math.max(c1, c2); ci++) for (let ri = Math.min(r1, r2); ri <= Math.max(r1, r2); ri++) sum += cellAt(sh, sheet, colLetters(ci), ri); return `(${sum})`; });
  e = e.replace(/([A-Za-z_][A-Za-z0-9_]*!)?\$?([A-Z]+)\$?(\d+)/g, (_m, s: string | undefined, col: string, row: string) => `(${cellAt(sh, s ? s.slice(0, -1) : cur, col, +row)})`);
  if (!/^[-+*/().\d\s]*$/.test(e)) throw new Error(`unsafe formula residue: ${e}`);
  return Function(`"use strict";return (${e || 0})`)() as number;
}
function setNum(sh: Sheets, sheet: string, col: string, row: number, v: number) { const cell = cellObj(sh, sheet, col, row); if (!cell) throw new Error(`no cell ${sheet}!${col}${row}`); cell.value = v; cell.text = String(v); }

/** Build a filled + formula-cached NILOC cost workbook for any period count (interpolated). */
export function buildFilledCost(spec: CostSpec, opts: { cacheFormulas?: boolean } = {}): CanvasDocument {
  const P = spec.periods.length;
  const doc = buildBurdenCostSheet({ documentId: `niloc-cost-${spec.key}`, title: spec.title, program: spec.program ?? 'sbir', periods: spec.periods, ceilingNote: spec.ceilingNote ?? '' });
  const sh = loadSheets(doc);
  setNum(sh, 'Rates', 'B', 2, spec.rates.fringePct); setNum(sh, 'Rates', 'B', 3, spec.rates.overheadPct); setNum(sh, 'Rates', 'B', 4, spec.rates.gnaPct); setNum(sh, 'Rates', 'B', 5, spec.rates.feePct);
  const laborHrsCol = (p: number) => colLetters(4 + 2 * p);   // D, F, H, ...
  spec.labor.forEach((l, i) => { if (!l) return; const r = 2 + i; setNum(sh, 'Labor', 'C', r, l.rate); for (let p = 0; p < P; p++) setNum(sh, 'Labor', laborHrsCol(p), r, l.hours[p] ?? 0); });
  const periodCol = (p: number) => colLetters(2 + p);        // B, C, D, ...
  const odRows: Array<[number, number[]]> = [[2, spec.materials], [3, spec.travel], [4, spec.equipment], [5, spec.other], [6, spec.subs]];
  for (const [r, arr] of odRows) for (let p = 0; p < P; p++) setNum(sh, 'ODC', periodCol(p), r, arr[p] ?? 0);
  if (opts.cacheFormulas !== false) {
    for (const [name, rows] of sh) for (let ri = 0; ri < rows.length; ri++) for (let ci = 0; ci < (rows[ri] as Cell[]).length; ci++) { const cell = (rows[ri] as Cell[])[ci]; if (cell && typeof cell.formula === 'string') { const v = evalFormula(cell.formula, sh, name); cell.value = Math.round(v * 100) / 100; if (!cell.number_format) cell.text = String(cell.value); } }
  }
  interpolate(doc, { company_name: 'NILOC Technologies', pi_name: 'Eric Wagner', topic_number: spec.topic });
  return doc;
}
/** Total proposed price: Summary row 14 — total column for P>1, else the single period column B. */
export function costPrice(doc: CanvasDocument, periodCount: number): number {
  const priceCol = periodCount > 1 ? colLetters(2 + periodCount) : 'B';
  return cellAt(loadSheets(doc), 'Summary', priceCol, 14);
}

function interpolate(doc: CanvasDocument, vars: Record<string, string>) {
  const re = /\{([a-z_]+)\}/g;
  const walk = (o: unknown) => {
    if (o == null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => { if (typeof v === 'string') o[i] = v.replace(re, (m, k) => vars[k] ?? m); else walk(v); }); return; }
    const rec = o as Record<string, unknown>;
    for (const k of Object.keys(rec)) { const v = rec[k]; if (typeof v === 'string') rec[k] = v.replace(re, (mm, kk) => vars[kk] ?? mm); else walk(v); }
  };
  walk(doc.canvas); walk(doc.nodes);
}
