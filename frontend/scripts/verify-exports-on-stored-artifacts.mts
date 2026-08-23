/**
 * Can every stored volume actually be DOWNLOADED, in every format the product offers?
 *
 * The ruler harnesses answer "how long is it". This answers the question underneath that one: does
 * the file come out at all. It is the same method that found B73 — point the real machinery at the
 * rows a customer's data actually contains, rather than at documents a preset constructed — applied
 * to the four writers and the compliance floor instead of to the page count.
 *
 * A proposal portal whose Download button throws is worse than one that measures a page wrong, and
 * templates cannot surface it: `CANVAS_PRESETS` builds a complete canvas every time, and stored
 * artifacts do not (three of them carry no `font_default` at all — B73).
 *
 * Reports per artifact: bytes out of each writer, and the compliance violations
 * `validateStandaloneCanvas` finds — the same floor the export gate enforces via the
 * `X-Compliance-Violations` header.
 *
 *   DATABASE_URL=… STORAGE_DRIVER=local npx tsx scripts/verify-exports-on-stored-artifacts.mts
 * Exit 0 if every stored volume exports in every applicable format; 1 otherwise.
 */
import { sqlBypass } from '@/lib/db';
import { assembleArtifactCanvas } from '@/lib/export/artifact-export';
import { validateStandaloneCanvas, type CanvasDocument } from '@/lib/types/canvas-document';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';

type Fmt = 'pdf' | 'docx' | 'pptx' | 'xlsx';
const WRITERS: Record<Fmt, (d: CanvasDocument, v: Record<string, string>) => Promise<Buffer>> = {
  pdf: exportToPdf, docx: exportToDocx, pptx: exportToPptx, xlsx: exportToXlsx,
};

/** Which formats a canvas of this shape is actually offered in (mirrors the package route). */
function formatsFor(fmt: string): Fmt[] {
  if (fmt === 'spreadsheet') return ['xlsx'];
  if (fmt.startsWith('slide')) return ['pptx', 'pdf'];
  return ['pdf', 'docx'];
}

async function main() {
  const rows = await sqlBypass<Array<{
    artifactId: string; proposalId: string; artifactType: string | null; volumeName: string | null; proposal: string;
  }>>`
    SELECT pa.id AS artifact_id, pa.proposal_id, pa.artifact_type, pa.volume_name, p.title AS proposal
    FROM proposal_artifacts pa
    JOIN proposals p ON p.id = pa.proposal_id
    WHERE p.archived_at IS NULL
    ORDER BY p.created_at DESC, pa.volume_number ASC NULLS LAST
  `;

  const failures: string[] = [];
  const violations: string[] = [];
  let volumes = 0, exports = 0;
  console.log('ARTIFACT                                              FORMATS (KB)                VIOLATIONS');
  console.log('─'.repeat(100));

  for (const r of rows) {
    const sections = await sqlBypass<Array<{ id: string; title: string | null; content: string | null }>>`
      SELECT id, title, content FROM proposal_sections
      WHERE proposal_id = ${r.proposalId}::uuid AND artifact_id = ${r.artifactId}::uuid
      ORDER BY volume_number ASC NULLS LAST, sort_index ASC NULLS LAST, section_number ASC
    `;
    if (sections.length === 0) continue;
    const label = `${r.proposal.slice(0, 28)} · ${r.volumeName ?? 'artifact'}`.slice(0, 50);
    let doc: CanvasDocument;
    try {
      doc = assembleArtifactCanvas(sections, r.artifactType, r.volumeName || 'artifact');
    } catch (e) {
      failures.push(`${label}: ASSEMBLY threw — ${String(e).slice(0, 80)}`);
      console.log(`${label.padEnd(50)}  ASSEMBLY FAILED`);
      continue;
    }
    volumes += 1;

    // The compliance floor the export gate enforces. Recorded, not fatal: a real volume may
    // legitimately exceed a soft budget while the customer is still writing.
    // Field names read off the ComplianceViolation type, not guessed. The first version used
    // `v.rule`/`v.detail` — neither exists — so the one real violation in the corpus printed as
    // "undefined:" and the script reported a count with no content. Same class as everything else
    // this session: a shape assumed instead of read.
    let vio: Array<{ code: string; message: string; limit?: number | null; actual?: number }> = [];
    try {
      vio = validateStandaloneCanvas(doc);
    } catch (e) {
      failures.push(`${label}: COMPLIANCE FLOOR threw — ${String(e).slice(0, 80)}`);
    }
    if (vio.length) {
      const codes = vio.map((v) => v.code + (v.limit != null && v.actual != null ? ` (${v.actual}/${v.limit})` : ''));
      violations.push(`${label}: ${codes.join(' · ')} — ${vio.map((v) => v.message).join(' | ').slice(0, 120)}`);
    }

    const cells: string[] = [];
    for (const f of formatsFor(doc.canvas?.format ?? 'letter')) {
      try {
        const buf = await WRITERS[f](doc, {});
        if (!buf?.length) throw new Error('empty buffer');
        exports += 1;
        cells.push(`${f} ${(buf.length / 1024).toFixed(0)}`);
      } catch (e) {
        failures.push(`${label} → ${f}: ${String(e).slice(0, 90)}`);
        cells.push(`${f} FAILED`);
      }
    }
    console.log(`${label.padEnd(50)}  ${cells.join('  ').padEnd(26)}  ${vio.length ? vio.length : '—'}`);
  }

  console.log(`\n${volumes} volume(s) · ${exports} successful export(s) · ${failures.length} failure(s)`);
  if (violations.length) {
    console.log(`\n${violations.length} volume(s) carry compliance violations (recorded, not a failure —`
      + ' a volume in progress may legitimately exceed a soft budget):');
    console.log(violations.slice(0, 10).map((v) => `  · ${v}`).join('\n'));
  }
  if (failures.length) {
    console.log(`\n✗ ${failures.length} export failure(s) — a customer clicking Download would get a 500:`);
    console.log(failures.map((f) => `  · ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('\n✓ every stored volume exports in every format the product offers for its shape.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
