/** Byte-level export check for the ppt/xls media+style work. Shapes rasterize via sharp (no S3),
 *  so this exercises the pptx shape/position/border path + the xlsx shape-drawing + cell border. */
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

const meta = { title: '', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' } as CanvasDocument['metadata'];
const shapeNode = (): CanvasNode => ({
  id: 'sh1', type: 'shape',
  content: { shape: 'rounded_rectangle', text: 'Badge' } as unknown as CanvasNode['content'],
  style: { fill: { color: '#1F4E79', opacity: 0.8 }, border: { color: '#0F172A', width: 2, style: 'solid' }, rotation: 10 } as unknown as CanvasNode['style'],
  position: { x: 1, y: 1, w: 3, h: 1.2, wrap: 'front' } as unknown as CanvasNode['position'],
  provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);

const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
let ok = true;
const check = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name} ${extra}`); if (!cond) ok = false; };

// ── PPTX: a slide with a positioned, bordered, semi-transparent, rotated shape ──
const slideDoc: CanvasDocument = {
  version: 1, document_id: 'd', canvas: { ...CANVAS_PRESETS.slide_cso, background: '#0F172A' },
  nodes: [
    { id: 'h', type: 'heading', content: { level: 1, text: 'Cover' }, style: { color: 'FFFFFF' }, provenance: { source: 'manual' }, history: [], library_eligible: false } as unknown as CanvasNode,
    shapeNode(),
  ],
  metadata: meta,
};
const pptx = await exportToPptx(slideDoc, {});
writeFileSync(`${OUT}/verify-slide.pptx`, pptx);
check('pptx is a PK zip', pptx[0] === 0x50 && pptx[1] === 0x4b, `${pptx.length} bytes`);
const pptxList = execSync(`unzip -l ${OUT}/verify-slide.pptx`).toString();
check('pptx has a slide', /ppt\/slides\/slide1\.xml/.test(pptxList));
const slideXml = execSync(`unzip -p ${OUT}/verify-slide.pptx ppt/slides/slide1.xml`).toString();
check('slide has a shape (<p:sp>)', slideXml.includes('<p:sp>'));
check('slide background is dark (0F172A)', /0F172A/i.test(slideXml) || /bg/i.test(slideXml));
check('shape has rotation (rot attr)', /rot=/.test(slideXml));

// ── XLSX: a table (styled cells) + a shape ──
const sheetDoc: CanvasDocument = {
  version: 1, document_id: 'd', canvas: { ...CANVAS_PRESETS.spreadsheet },
  nodes: [
    { id: 't', type: 'table', content: { sheet_name: 'Budget', headers: ['Item', 'Cost'], rows: [
      [{ text: 'PI' }, { text: '59200', value: 59200, number_format: '$#,##0' }],
      [{ text: 'TOTAL', style: { bold: true, border: 'thick', fg: '#B91C1C' } }, { text: '59200', value: 59200, number_format: '$#,##0', style: { border: 'thick' } }],
    ] } as unknown as CanvasNode['content'], style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false } as unknown as CanvasNode,
    shapeNode(),
  ],
  metadata: meta,
};
const xlsx = await exportToXlsx(sheetDoc, {});
writeFileSync(`${OUT}/verify-sheet.xlsx`, xlsx);
check('xlsx is a PK zip', xlsx[0] === 0x50 && xlsx[1] === 0x4b, `${xlsx.length} bytes`);
const xlsxList = execSync(`unzip -l ${OUT}/verify-sheet.xlsx`).toString();
check('xlsx has a worksheet', /xl\/worksheets\/sheet1\.xml/.test(xlsxList));
check('xlsx embeds the shape (drawing + media image)', /xl\/drawings\//.test(xlsxList) && /xl\/media\//.test(xlsxList), '(shape → floating PNG)');
const styles = execSync(`unzip -p ${OUT}/verify-sheet.xlsx xl/styles.xml`).toString();
check('xlsx styles carry a thick border', /thick/.test(styles));
check('xlsx styles carry a font color (B91C1C)', /B91C1C/i.test(styles));

console.log(ok ? '\nALL EXPORT CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
