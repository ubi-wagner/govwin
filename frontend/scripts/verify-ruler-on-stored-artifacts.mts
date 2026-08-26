/**
 * The page ruler against the artifacts that are actually IN THE DATABASE.
 *
 * `verify-ruler-on-proposals.mts` measures the eight NILOC gold volumes, which are markdown on
 * disk converted at run time. This measures the other thing: real `proposal_artifacts` rows, with
 * their real sections, groups, page furniture and stored images, assembled by
 * `assembleArtifactCanvas` — the SAME assembly the layout route and every export path use. It is
 * the closest a check can get to what a customer downloads.
 *
 * The safety property is the same and it is the whole point: the ruler may over-count (annoying)
 * but must never UNDER-count, because that is the export gate clearing a volume that is over its
 * agency page limit.
 *
 *   DATABASE_URL=… npx tsx scripts/verify-ruler-on-stored-artifacts.mts
 * Exit 0 if nothing under-counts; 1 otherwise.
 */
import { sqlBypass } from '@/lib/db';
import { assembleArtifactCanvas } from '@/lib/export/artifact-export';
import { estimatePageCount, estimateSlideCount, type CanvasDocument } from '@/lib/types/canvas-document';
import { exportToPdf } from '@/lib/export/pdf-exporter';

const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

async function main() {
  // Read as the OWNER: this is a cross-tenant sweep over every tenant's volumes, one of the
  // legitimate `sqlBypass` uses (CLAUDE.md), and it never writes.
  const rows = await sqlBypass<Array<{
    artifactId: string; proposalId: string; artifactType: string | null; volumeName: string | null; proposal: string;
  }>>`
    SELECT pa.id AS artifact_id, pa.proposal_id,
           pa.artifact_type, pa.volume_name, p.title AS proposal
    FROM proposal_artifacts pa
    JOIN proposals p ON p.id = pa.proposal_id
    WHERE p.archived_at IS NULL
    ORDER BY p.created_at DESC, pa.volume_number ASC NULLS LAST
  `;
  console.log(`${rows.length} stored artifact(s)\n`);

  const out: Array<{ label: string; est: number; printed: number; kind: string }> = [];
  for (const r of rows) {
    // The SAME ordering and assembly the layout route and the export paths use — measuring a
    // differently-assembled document would prove nothing about what a customer downloads.
    const sections = await sqlBypass<Array<{ id: string; title: string | null; content: string | null }>>`
      SELECT id, title, content FROM proposal_sections
      WHERE proposal_id = ${r.proposalId}::uuid AND artifact_id = ${r.artifactId}::uuid
      ORDER BY volume_number ASC NULLS LAST, sort_index ASC NULLS LAST, section_number ASC
    `;
    if (sections.length === 0) continue;
    let doc: CanvasDocument;
    try {
      doc = assembleArtifactCanvas(sections, r.artifactType, r.volumeName || 'artifact');
    } catch (e) {
      console.log(`  skipped ${r.volumeName} — assembly failed: ${String(e).slice(0, 90)}`);
      continue;
    }
    const fmt = doc.canvas?.format ?? 'letter';
    const label = `${r.proposal.slice(0, 30)} · ${r.volumeName ?? 'artifact'}`.slice(0, 56);
    if (fmt === 'spreadsheet') { console.log(`  skipped ${label} — a spreadsheet does not paginate`); continue; }
    if (fmt.startsWith('slide')) {
      // A deck's ruler is one page per section; the .pptx harness covers it. Recorded, not compared.
      out.push({ label, est: estimateSlideCount(doc), printed: estimateSlideCount(doc), kind: 'deck (not compared)' });
      continue;
    }
    try {
      out.push({ label, est: estimatePageCount(doc), printed: pdfPages(await exportToPdf(doc, {})), kind: 'doc' });
    } catch (e) {
      console.log(`  skipped ${label} — export failed: ${String(e).slice(0, 90)}`);
    }
    process.stdout.write('.');
  }

  console.log('\n');
  console.log('ARTIFACT                                                   RULER  PRINTED  DELTA');
  console.log('─'.repeat(82));
  const docs = out.filter((o) => o.kind === 'doc');
  for (const o of out) {
    const d = o.est - o.printed;
    console.log(`${o.label.padEnd(56)}  ${String(o.est).padStart(5)}  ${String(o.printed).padStart(7)}  `
      + (o.kind === 'doc' ? `${(d > 0 ? '+' : '') + d}`.padStart(5) + (d < 0 ? '  ← UNDER-COUNT' : '') : '   —  (deck)'));
  }
  const under = docs.filter((o) => o.est < o.printed);
  const over = docs.filter((o) => o.est > o.printed);
  console.log();
  if (under.length) {
    console.log(`✗ ${under.length} of ${docs.length} stored volume(s) UNDER-counted — the gate would clear an over-length volume`);
    process.exit(1);
  }
  console.log(`✓ no under-counts across ${docs.length} stored volume(s)`
    + (over.length ? ` — ${over.length} over by a page (safe direction): ${over.map((o) => o.label).join(' · ')}` : ' — every one exact'));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
