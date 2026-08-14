/**
 * Shared helpers for the NILOC Technologies gold-example set.
 *
 * NILOC is the parent company of RFP Pipeline. These examples are built from real,
 * IP-safe federal technologies offered for license through the DoD tech-transfer
 * ecosystem (TechLink / lab T2 offices) — so they read as genuine SBIR Phase II
 * proposals NILOC could file, with no third-party IP exposure. Eric Wagner (Founder
 * & CEO) is the Principal Investigator. Unverifiable specifics are marked [confirm]
 * or shown as [bracketed] planning estimates in the narratives.
 *
 * The three technologies (base patent honestly cited in each narrative):
 *   · CADENCE™   — Pattern-of-Life / activity-based-intelligence analytics (AFRL, Rome NY)
 *   · AURA™      — Counter-UAS RF sensing / passive electronic support
 *   · PolarHawk™ — Low-SWaP compact-polarimetric monopulse radar for small-UAS
 *
 * Cost volumes are 24-month (Phase II Year 1 + Year 2) burden-waterfall workbooks whose
 * roll-ups mirror the portal cost engine (lib/proposal/cost-model.ts computeBudget) to
 * the cent — verify.mts proves it.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildBurdenCostSheet } from '@/lib/templates/cost/burden-cost-sheet';
import { createNode, type CanvasDocument, type CanvasNode, type CanvasSection } from '@/lib/types/canvas-document';

export const NILOC_TENANT_SLUG = 'niloc';
export const NILOC_TENANT_ID = 'd5386192-2aca-4d77-8d1e-61719ee34cce';
export const ERIC_USER_ID = '1bc09a41-c018-4738-9dcd-9a1b1cf88894';
export const HERE = dirname(fileURLToPath(import.meta.url));

// ── the three technical volumes (markdown → sectioned canvas) ──
export const TECH_VOLUMES: Array<{ key: string; file: string; title: string; tag: string }> = [
  { key: 'cadence', file: 'cadence-technical.md', tag: 'CADENCE', title: 'CADENCE — Pattern-of-Life Analytics (SBIR Phase II Technical Volume)' },
  { key: 'aura', file: 'aura-technical.md', tag: 'AURA', title: 'AURA — Counter-UAS RF Sensing (SBIR Phase II Technical Volume)' },
  { key: 'polarhawk', file: 'polarhawk-technical.md', tag: 'PolarHawk', title: 'PolarHawk — Compact-Polarimetric Radar for sUAS (SBIR Phase II Technical Volume)' },
];

export function readTech(file: string): string {
  return readFileSync(join(HERE, file), 'utf8');
}

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
    const text = para.join(' ').replace(/\*\*/g, '').trim(); if (text) nodes.push(mk('text_block', { text }));
  }
  return nodes;
}
export function toSections(nodes: CanvasNode[]): CanvasSection[] {
  const sections: CanvasSection[] = []; let cur: CanvasNode[] = []; let title: string | undefined;
  const flush = () => { if (cur.length) sections.push({ id: crypto.randomUUID(), title, layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes: cur }] }); };
  for (const n of nodes) { if (n.type === 'heading') { flush(); cur = [n]; title = (n.content as { text?: string })?.text; } else cur.push(n); }
  flush(); return sections;
}
export function techDoc(md: string, title: string): CanvasDocument {
  const now = '2026-01-01T00:00:00Z';
  return {
    version: 2, document_id: crypto.randomUUID(),
    canvas: { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, header: null, footer: { template: 'NILOC Technologies · Proprietary · {n} / {N}', height: 36, font: { family: 'Times New Roman', size: 9 } }, font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1.15, max_pages: null, max_slides: null },
    sections: toSections(mdToNodes(md)),
    metadata: { title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: now, last_modified_at: now, last_modified_by: ERIC_USER_ID, version_number: 1, status: 'ai_drafted' },
  };
}

// ── the three cost volumes (24-month burden waterfall) ──
export type Lab = { rate: number; y1: number; y2: number } | null;
export type Odc = { y1: number; y2: number };
export interface CostSpec {
  key: string; tag: string; title: string; topic: string;
  rates: { fringePct: number; overheadPct: number; gnaPct: number; feePct: number };
  labor: Lab[];                                   // length 9, aligned to LABOR_CODES rows
  materials: Odc; travel: Odc; equipment: Odc; other: Odc; subs: Odc; subOrg: string;
}
export const COST_SPECS: CostSpec[] = [
  { key: 'cadence', tag: 'CADENCE', topic: 'AF SBIR Phase II — Pattern-of-Life Analytics', title: 'NILOC · CADENCE Cost Volume (Phase II, 24 mo)', rates: { fringePct: 0.30, overheadPct: 0.55, gnaPct: 0.12, feePct: 0.07 }, labor: [{ rate: 110, y1: 420, y2: 380 }, { rate: 96, y1: 720, y2: 720 }, { rate: 88, y1: 820, y2: 820 }, { rate: 72, y1: 760, y2: 800 }, { rate: 80, y1: 800, y2: 820 }, null, null, { rate: 82, y1: 240, y2: 240 }, { rate: 46, y1: 140, y2: 140 }], materials: { y1: 22000, y2: 18000 }, travel: { y1: 10000, y2: 12000 }, equipment: { y1: 14000, y2: 0 }, other: { y1: 3000, y2: 3000 }, subs: { y1: 70000, y2: 60000 }, subOrg: 'University ML research partner (STTR-style RI collaboration)' },
  { key: 'aura', tag: 'AURA', topic: 'NAVY SBIR Phase II — Counter-UAS RF Sensing', title: 'NILOC · AURA Cost Volume (Phase II, 24 mo)', rates: { fringePct: 0.30, overheadPct: 0.58, gnaPct: 0.13, feePct: 0.07 }, labor: [{ rate: 110, y1: 330, y2: 300 }, { rate: 98, y1: 500, y2: 500 }, { rate: 92, y1: 720, y2: 720 }, { rate: 74, y1: 560, y2: 580 }, { rate: 80, y1: 500, y2: 520 }, { rate: 84, y1: 380, y2: 360 }, { rate: 54, y1: 420, y2: 440 }, { rate: 82, y1: 180, y2: 180 }, { rate: 46, y1: 110, y2: 110 }], materials: { y1: 35000, y2: 28000 }, travel: { y1: 12000, y2: 14000 }, equipment: { y1: 45000, y2: 15000 }, other: { y1: 5000, y2: 5000 }, subs: { y1: 40000, y2: 35000 }, subOrg: 'RF antenna / range-test subcontractor' },
  { key: 'polarhawk', tag: 'PolarHawk', topic: 'NAVY SBIR Phase II — Compact-Polarimetric Radar for sUAS', title: 'NILOC · PolarHawk Cost Volume (Phase II, 24 mo)', rates: { fringePct: 0.30, overheadPct: 0.60, gnaPct: 0.13, feePct: 0.07 }, labor: [{ rate: 110, y1: 300, y2: 270 }, { rate: 100, y1: 480, y2: 480 }, { rate: 94, y1: 680, y2: 680 }, { rate: 74, y1: 520, y2: 540 }, { rate: 80, y1: 480, y2: 500 }, { rate: 86, y1: 420, y2: 400 }, { rate: 55, y1: 460, y2: 480 }, { rate: 82, y1: 170, y2: 170 }, { rate: 46, y1: 100, y2: 100 }], materials: { y1: 40000, y2: 30000 }, travel: { y1: 12000, y2: 14000 }, equipment: { y1: 70000, y2: 20000 }, other: { y1: 6000, y2: 6000 }, subs: { y1: 55000, y2: 45000 }, subOrg: 'Antenna fabrication / range-test subcontractor' },
];

// ── mini spreadsheet engine over the is_spreadsheet table nodes ──
type Sheets = Map<string, unknown[][]>;
export function loadSheets(doc: CanvasDocument): Sheets {
  const s: Sheets = new Map();
  for (const n of doc.nodes ?? []) { const c = n.content as { is_spreadsheet?: boolean; sheet_name?: string; rows?: unknown[][] }; if (c?.is_spreadsheet && c.sheet_name && c.rows) s.set(c.sheet_name, c.rows); }
  return s;
}
function colIdx(letters: string): number { let x = 0; for (const ch of letters) x = x * 26 + (ch.charCodeAt(0) - 64); return x; }
function colLetters(n: number): string { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
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

/** Build a filled + formula-cached CADENCE/AURA/PolarHawk cost workbook (interpolated for NILOC). */
export function buildFilledCost(spec: CostSpec, opts: { cacheFormulas?: boolean } = {}): CanvasDocument {
  const doc = buildBurdenCostSheet({ documentId: `niloc-cost-${spec.key}`, title: spec.title, program: 'sbir', periods: [{ name: 'Year 1', months: 12 }, { name: 'Year 2', months: 12 }], ceilingNote: 'confirm the Phase II ceiling in your solicitation' });
  const sh = loadSheets(doc);
  setNum(sh, 'Rates', 'B', 2, spec.rates.fringePct); setNum(sh, 'Rates', 'B', 3, spec.rates.overheadPct); setNum(sh, 'Rates', 'B', 4, spec.rates.gnaPct); setNum(sh, 'Rates', 'B', 5, spec.rates.feePct);
  spec.labor.forEach((l, i) => { if (!l) return; const r = 2 + i; setNum(sh, 'Labor', 'C', r, l.rate); setNum(sh, 'Labor', 'D', r, l.y1); setNum(sh, 'Labor', 'F', r, l.y2); });
  const od: Array<[number, Odc]> = [[2, spec.materials], [3, spec.travel], [4, spec.equipment], [5, spec.other], [6, spec.subs]];
  for (const [r, o] of od) { setNum(sh, 'ODC', 'B', r, o.y1); setNum(sh, 'ODC', 'C', r, o.y2); }
  if (opts.cacheFormulas !== false) {
    for (const [name, rows] of sh) for (let ri = 0; ri < rows.length; ri++) for (let ci = 0; ci < (rows[ri] as Cell[]).length; ci++) { const cell = (rows[ri] as Cell[])[ci]; if (cell && typeof cell.formula === 'string') { const v = evalFormula(cell.formula, sh, name); cell.value = Math.round(v * 100) / 100; if (!cell.number_format) cell.text = String(cell.value); } }
  }
  interpolate(doc, { company_name: 'NILOC Technologies', pi_name: 'Eric Wagner', topic_number: spec.topic });
  return doc;
}
/** total proposed price = Summary total-column, price row 14 (P=2 → column D). */
export function costPrice(doc: CanvasDocument): number { return cellAt(loadSheets(doc), 'Summary', 'D', 14); }

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
