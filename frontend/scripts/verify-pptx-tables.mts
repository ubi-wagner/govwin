/** Integration proof: a real .pptx zip with a slide table → readPptx yields a table node.
 *  (unit test covers the parser; this proves the whole reader on an actual OOXML zip.)
 *  cd frontend && node --import tsx scripts/verify-pptx-tables.mts */
import JSZip from 'jszip';
import { readPptx } from '@/lib/import/pptx-reader';
import { textOfNodes } from '@/lib/atom-size';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const cell = (t: string) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`;
const trow = (...c: string[]) => `<a:tr h="370840">${c.map(cell).join('')}</a:tr>`;
const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A}" xmlns:p="${P}"><p:cSld><p:spTree>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
    <p:txBody><a:bodyPr/><a:p><a:r><a:t>Phase I Cost Summary</a:t></a:r></a:p></p:txBody></p:sp>
  <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
      ${trow('Cost Element', 'Amount')}
      ${trow('Direct Labor', '$59,200')}
      ${trow('Materials &amp; Supplies', '$12,400')}
    </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`;

const zip = new JSZip();
zip.file('ppt/slides/slide1.xml', slide1);
const buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));

const res = await readPptx(buf, 'phase1-costs.pptx');
const nodes = res.atoms[0]?.nodes ?? [];
const table = nodes.find((n) => n.type === 'table');

let ok = true;
const assert = (label: string, cond: boolean) => { console.log(`${cond ? '✓' : '✗'} ${label}`); ok = ok && cond; };

assert('one atom produced', res.atoms.length === 1);
assert('heading node present', nodes.some((n) => n.type === 'heading'));
assert('TABLE node present (was dropped before)', !!table);
if (table) {
  const c = table.content as { headers: string[]; rows: string[][] };
  assert('headers = [Cost Element, Amount]', JSON.stringify(c.headers) === JSON.stringify(['Cost Element', 'Amount']));
  assert('2 data rows', c.rows.length === 2);
  assert('entity decoded (Materials & Supplies)', c.rows[1]?.[0] === 'Materials & Supplies');
}
const body = textOfNodes(nodes);
assert('table text flows into atom body (word-count safe)', body.includes('Direct Labor') && body.includes('$59,200'));
console.log(`\natom body preview:\n${body}\n`);
console.log(ok ? 'PASS — pptx tables survive ingest' : 'FAIL');
process.exit(ok ? 0 : 1);
