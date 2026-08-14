// Proves lib/export/pdf-exporter.ts produces a real PDF under the sandbox chromium
// (validates the prod fix: resolveExecutable path-detection + --no-sandbox launch).
import { exportToPdf } from '@/lib/export/pdf-exporter';

const doc: any = {
  id: 'pdf-proof', title: 'PDF Export Proof', status: 'draft', version: 2,
  canvas: {
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: null, footer: null,
  },
  sections: [{
    id: 's1', title: 'Section One', layout: { mode: 'flow' },
    groups: [{ id: 'g1', nodes: [
      { id: 'n1', type: 'heading', content: { level: 1, text: 'PDF Export Proof' } },
      { id: 'n2', type: 'paragraph', content: { text: 'This validates the production Chromium fix (system-path detection + --no-sandbox) end-to-end: the exporter launches a browser and renders a real PDF.' } },
    ] }],
    nodes: [],
  }],
  nodes: [],
};

const buf = await exportToPdf(doc, {});
const magic = buf.subarray(0, 5).toString('latin1');
console.log(`PDF bytes: ${buf.length} · magic: ${JSON.stringify(magic)} · valid: ${magic === '%PDF-' && buf.length > 1000}`);
if (magic !== '%PDF-' || buf.length <= 1000) { console.error('❌ not a valid PDF'); process.exit(1); }
console.log('✅ PDF EXPORT PROOF PASS');
process.exit(0);
