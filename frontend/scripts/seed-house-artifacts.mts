/**
 * Native-format house artifacts (eat our own cooking, correctly typed):
 *   Terms    → a canvas DOC   → real .docx  → library atom (kind=doc)
 *   Calendar → a canvas SHEET → real .xlsx  → library atom (kind=sheet)
 * Uses the REAL exporters (renderCanvas) + the real createAtom write path.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from '@/lib/db';
import { TERMS_TEXT } from '@/lib/terms';
import { renderCanvas } from '@/lib/export/artifact-export';
import { listAdminAvailability } from '@/lib/calendar';
import { sectionsToCanvasDoc, tableToCanvasSheet, ingestHouseArtifact } from '@/lib/library/house-artifacts';
import { listAtoms, viewerFromRole } from '@/lib/atoms';

const TENANT = process.env.HOUSE_TENANT_ID ?? 'db20bc0f-6322-4fed-8b99-f45c9b4d7d08';
const ACTOR = process.env.HOUSE_ACTOR_ID ?? '72c0739e-c637-46b9-bfe9-59b05e24bcf9';
const OUT = process.env.OUT_DIR ?? '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b; // docx/xlsx are zip (PK)

function termsDoc() {
  const blocks = TERMS_TEXT.split('\n\n').map((b) => b.trim()).filter(Boolean);
  const title = blocks[0].split('\n')[0];
  const sections = blocks.slice(1).map((b) => {
    const lines = b.split('\n');
    return { title: lines[0], body: lines.slice(1).join('\n') };
  });
  return { title, doc: sectionsToCanvasDoc(title, sections), sectionCount: sections.length };
}

function fmtWhen(iso: string): string {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

async function calendarSheet() {
  const blocks = await listAdminAvailability();
  const headers = ['When', 'Duration (min)', 'Status', 'Booked by'];
  let rows = blocks.map((b) => [fmtWhen(b.startAt), String(b.minutes), b.status, b.bookedByEmail ?? '']);
  if (rows.length === 0) {
    // No live availability — ship an illustrative snapshot so the sheet shows the shape.
    rows = [
      ['Jul 28, 10:00 AM', '15', 'open', ''],
      ['Jul 28, 10:30 AM', '30', 'booked', 'jane@immobileyes.com'],
      ['Jul 29, 2:00 PM', '15', 'open', ''],
    ];
  }
  return { doc: tableToCanvasSheet('Expert-Time Schedule', headers, rows, 'Schedule'), rowCount: rows.length };
}

async function main() {
  let pass = 0, fail = 0;
  const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  PASS ${n} ${d}`)) : (fail++, console.log(`  FAIL ${n} ${d}`)); };

  // Idempotent re-seed: drop this script's prior artifacts (by their doc slugs).
  const cleared = await sql<Array<{ id: string }>>`
    DELETE FROM library_atoms WHERE tenant_id = ${TENANT}::uuid AND id IN (
      SELECT atom_id FROM atom_tags WHERE dimension = 'doc' AND value = ANY(${['terms', 'calendar-schedule']})
    ) RETURNING id`;
  console.log(`cleared ${cleared.length} prior native-format artifacts`);

  // Terms → doc → .docx
  const t = termsDoc();
  const docx = await renderCanvas('docx', t.doc, {});
  ok('terms.docx-bytes', isZip(docx), `${docx.length}b, ${t.sectionCount} sections`);
  writeFileSync(resolve(OUT, 'RFP-Pipeline-Terms.docx'), docx);
  const ta = await ingestHouseArtifact(TENANT, { title: 'Terms & Conditions', slug: 'terms', form: 'doc', kind: 'document', context: 'legal' }, t.doc, { id: ACTOR });
  ok('terms.foundation', !!ta.atomId && ta.format === 'docx' && ta.sections > 0,
    `foundation + ${ta.sections} sections / ${ta.groups} groups / ${ta.atoms} atoms`);

  // Calendar → sheet → .xlsx
  const c = await calendarSheet();
  const xlsx = await renderCanvas('xlsx', c.doc, {});
  ok('calendar.xlsx-bytes', isZip(xlsx), `${xlsx.length}b, ${c.rowCount} rows`);
  writeFileSync(resolve(OUT, 'RFP-Pipeline-Expert-Time-Schedule.xlsx'), xlsx);
  const ca = await ingestHouseArtifact(TENANT, { title: 'Expert-Time Schedule', slug: 'calendar-schedule', form: 'sheet', kind: 'document', context: 'proposal' }, c.doc, { id: ACTOR });
  ok('calendar.foundation', !!ca.atomId && ca.format === 'xlsx' && ca.sections > 0,
    `foundation + ${ca.sections} sections / ${ca.groups} groups / ${ca.atoms} atoms`);

  // Prove the FOUNDATION atoms surface via the real read path, filtered by grain+format.
  const viewer = viewerFromRole(ACTOR, 'master_admin');
  const docFnd = await listAtoms(TENANT, { grain: 'foundation', dimension: 'format', value: 'docx', limit: 20 }, viewer);
  const sheetFnd = await listAtoms(TENANT, { grain: 'foundation', dimension: 'format', value: 'xlsx', limit: 20 }, viewer);
  ok('listAtoms.doc-foundation', docFnd.some((a) => a.id === ta.atomId), `${docFnd.length} docx foundations`);
  ok('listAtoms.sheet-foundation', sheetFnd.some((a) => a.id === ca.atomId), `${sheetFnd.length} xlsx foundations`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'} — ${pass} pass / ${fail} fail`);
  if (fail) process.exit(1);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
