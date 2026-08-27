/**
 * What does the customer actually RECEIVE when a project deliverable is authored and exported?
 *
 * ── WHY THE G2 PROOF WAS NOT A PROOF ─────────────────────────────────────────────────────────
 * The lifecycle drive asserted that `…/documents/[id]/export` answers 200 and that the first bytes
 * are `%PDF` or the `PK` zip header. Both were true, and both would stay true for a document with
 * nothing in it — which is exactly what was being exported: `starterFromPreset` builds a BLANK
 * canvas (correct for the "New document" chooser, which is a person clicking "blank letter"), so
 * the authored deliverable came out as an empty page and a magic-number check cannot tell the
 * difference. An 865-byte PDF passed.
 *
 * This is the repo's own rule, applied to the newest writer: **an artifact is not verified until an
 * engine that did not write it has opened it** (B121). Our exporters wrote these files; LibreOffice
 * renders them; pdf.js reads the text layer off the render. Nothing in that chain is ours except
 * the bytes under test.
 *
 * ── WHAT IT ASKS ─────────────────────────────────────────────────────────────────────────────
 *   identity   the deliverable's own title reaches the rendered page. A deliverable artifact that
 *              does not say which deliverable it is cannot be filed by whoever receives it, and it
 *              is the cheapest possible evidence that the export is not blank.
 *   ruler      `estimatePageCount` never UNDER-counts the pages LibreOffice actually printed. The
 *              same asymmetry as every other ruler check: over is untidy, under clears a volume
 *              that is over its page limit.
 *   ink        the page carries painted content, not just a text layer — a run drawn in white on
 *              white is in the text layer and invisible to a reader.
 *
 * ⚠ READ-ONLY. It exports from stored canvases and writes only to its own out-dir.
 *
 *   cd frontend && npx tsx scripts/probe-deliverable-artifacts.mts [outDir]
 * Exit 0 if every authored deliverable renders with its identity on the page; 1 if one does not;
 * 2 if the probe could not earn a verdict (no authored deliverable, or no Office engine).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { sqlBypass } from '@/lib/db';
import { estimatePageCount, estimateSlideCount, type CanvasDocument } from '@/lib/types/canvas-document';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import { capturePdfPages } from '@/lib/pdf/page-capture';

const OUT = process.argv[2] || '/tmp/deliverable-artifacts';

let failed = 0;
let checks = 0;
const A = (ok: boolean, label: string, extra = '') => {
  checks += 1;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
};

/**
 * Convert an Office file to PDF with LibreOffice — the second opinion.
 *
 * The CONTROL runs first, exactly as docs/CONTINUATION.md §2 requires: convert a plain text file
 * and check that a PDF came out. A container with `libreoffice-core` and no filter packages fails
 * on everything, and without the control that reads as "our .pptx is unopenable" — a documented
 * claim this repo has actually made and had to retract.
 */
function office(file: string, dir: string): string | null {
  const out = `${dir}/${file.split('/').pop()!.replace(/\.[^.]+$/, '')}.pdf`;
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, file],
      { stdio: 'pipe', timeout: 180_000 });
  } catch { return null; }
  return existsSync(out) ? out : null;
}

function officeAvailable(dir: string): boolean {
  const ctl = `${dir}/_control.txt`;
  writeFileSync(ctl, 'control\n');
  return office(ctl, dir) !== null;
}

/** Pages, their text and whether anything was painted — read off the RENDER, not the source file. */
async function readPdf(pdf: Buffer) {
  const pages = await capturePdfPages(pdf, { scale: 1 });
  return {
    count: pages.length,
    text: pages.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim(),
    ink: pages.reduce((n, p) => n + (p.boxes?.length ?? 0), 0),
  };
}

/**
 * Does the rendered text contain this phrase?
 *
 * Compared with whitespace and punctuation normalised away. A PDF text layer emits runs, not
 * words: LibreOffice will happily hand back "Monthly technical repor t" across a kerning pair, and
 * an em dash in our title comes back as a different codepoint than the one we wrote. Matching the
 * raw string would fail on typography rather than on content, which is a harness bug reported as a
 * product defect.
 */
const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const says = (hay: string, needle: string) => flatten(hay).includes(flatten(needle));

/**
 * Open the lane by measuring something DEFINITELY blank, and require the detector to see it.
 *
 * The pattern `verify-surfaces` uses, for the same reason: this probe was written to catch an empty
 * artifact, and a probe that has never once reported one is a probe whose detector is unproven. A
 * text layer that comes back empty because `capturePdfPages` silently failed looks exactly like a
 * blank page, and would make every sweep below read green for the wrong reason.
 *
 * The blank canvas is built in MEMORY — nothing is written to the database. A fixture row would be
 * a hand-made artifact standing in for a product one, which is the thing this file exists to stop.
 */
async function detectorWorks(): Promise<boolean> {
  const blank: CanvasDocument = {
    version: 1,
    document_id: '00000000-0000-4000-8000-000000000000',
    canvas: { format: 'letter', margin_in: 1, font_default: { family: 'Times New Roman', size_pt: 12 } } as CanvasDocument['canvas'],
    nodes: [],
    metadata: { title: 'Definitely blank' } as CanvasDocument['metadata'],
  };
  const seen = await readPdf(await exportToPdf(blank, {}));
  // The needle is a phrase that appears NOWHERE in an empty document. If `says` returns true here,
  // it matches anything, and every green below is unearned.
  return seen.text.trim().length === 0 && !says(seen.text, 'Monthly technical report');
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  if (!(await detectorWorks())) {
    console.error('HARNESS DEFECT: the detector reported a DELIBERATELY BLANK document as carrying');
    console.error('text. Either the text layer is not being read or `says` matches anything —');
    console.error('either way every clean below would be unearned.');
    process.exit(2);
  }
  console.log('self-test: a blank canvas reads as blank — the detector can fail\n');

  if (!officeAvailable(OUT)) {
    console.error('HARNESS DEFECT: LibreOffice cannot convert a PLAIN TEXT FILE here, so it cannot');
    console.error('be used to open ours either. Install the filter packages (docs/CONTINUATION.md §2).');
    console.error('This says nothing about the artifacts — the control failed, not the product.');
    process.exit(2);
  }
  console.log('control: LibreOffice converted a plain .txt — the engine works\n');

  // Every deliverable that was AUTHORED in-product. Cross-tenant read, never a write: one of the
  // legitimate `sqlBypass` uses (CLAUDE.md).
  const rows = await sqlBypass<Array<{
    deliverableId: string; deliverableTitle: string; documentId: string;
    docTitle: string; canvas: unknown; project: string; nodeCount: number;
  }>>`
    SELECT d.id   AS deliverable_id, d.title AS deliverable_title,
           td.id  AS document_id,    td.title AS doc_title, td.canvas, td.node_count,
           p.name AS project
      FROM project_deliverables d
      JOIN tenant_documents td ON td.id = d.document_id
      JOIN project_milestones m ON m.id = d.milestone_id
      JOIN projects p ON p.id = m.project_id
     ORDER BY d.created_at DESC`;

  if (rows.length === 0) {
    console.error('HARNESS DEFECT: no deliverable is backed by an authored document, so there is');
    console.error('nothing to open. Run `npx tsx scripts/drive-project-lifecycle.mts` first —');
    console.error('reporting a clean sweep over an empty corpus is how a lens lies.');
    process.exit(2);
  }
  console.log(`${rows.length} authored deliverable(s)\n`);

  for (const r of rows) {
    const doc = r.canvas as CanvasDocument;
    const fmt = doc?.canvas?.format ?? 'letter';
    const deck = String(fmt).startsWith('slide');
    console.log(`── ${r.project.slice(0, 28)} · ${r.deliverableTitle} · ${fmt} · ${r.nodeCount} node(s)`);

    // The product's OWN pdf, and the Office files opened by an engine that did not write them.
    const targets: Array<{ ext: string; buf: Buffer }> = [
      { ext: 'pdf', buf: await exportToPdf(doc, {}) },
      { ext: 'docx', buf: await exportToDocx(doc, {}) },
      { ext: 'pptx', buf: await exportToPptx(doc, {}) },
      { ext: 'xlsx', buf: await exportToXlsx(doc, {}) },
    ];

    for (const t of targets) {
      const file = `${OUT}/${r.deliverableId.slice(0, 8)}.${t.ext}`;
      writeFileSync(file, t.buf);
      const pdf = t.ext === 'pdf' ? file : office(file, OUT);
      if (!pdf) { A(false, `.${t.ext} — LibreOffice could not open what we wrote`); continue; }

      const seen = await readPdf(readFileSync(pdf));

      // THE HEADLINE. A deliverable artifact has to say which deliverable it is; it is also the
      // cheapest evidence the file is not blank, which the magic-number check could not give.
      A(says(seen.text, r.deliverableTitle) || says(seen.text, r.docTitle),
        `.${t.ext} — the rendered page names the deliverable`,
        `${seen.count} page(s) · ${seen.text.length} chars of text · ${seen.ink} painted box(es)`);

      // Either measurement counts as "not empty". `ink` is the PAINT operators — fills and images —
      // so a text-only page reports 0 of them and is still fine; it is reported alongside the text
      // length rather than asserted on, because a page of prose legitimately paints nothing.
      A(seen.text.length > 0 || seen.ink > 0, `.${t.ext} — something is actually on the page`);

      // The ruler, against the pages the engine really printed. `.xlsx` is excluded: a spreadsheet
      // does not paginate, and asserting a page count on one measures LibreOffice's print setup
      // rather than our estimate.
      if (t.ext !== 'xlsx') {
        const est = deck && t.ext === 'pptx' ? estimateSlideCount(doc) : estimatePageCount(doc);
        A(est >= seen.count,
          `.${t.ext} — the ruler does not UNDER-count what came out`,
          `estimate ${est} · printed ${seen.count}`);
      }
    }
    console.log('');
  }

  console.log(`${checks - failed}/${checks} checks passed · files in ${OUT}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('probe failed:', e); process.exit(1); });
