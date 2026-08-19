import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readDocx } from '@/lib/import/docx-reader';
import type { CanvasNode } from '@/lib/types/canvas-document';

/**
 * FIGURES ARE CONTENT. mammoth inlines every embedded .docx image as a `data:` URI; the HTML→node
 * parser had no `img` branch, so a figure-rich proposal imported as TEXT ONLY and every figure was
 * silently lost — the atom library then had no image atoms to place back into a proposal. These
 * tests lock the extraction: images become real image nodes carrying the data URI, and the placed
 * box always has a non-zero height (an undecodable format must not collapse to an invisible strip).
 */

// A 1x1 red PNG and a 2x1 JPEG, base64 — real bytes so the intrinsic-size decoder runs for real.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Minimal .docx with one paragraph and one inline image, built as real OOXML bytes. */
async function docxWithImage(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
       <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
       <Default Extension="xml" ContentType="application/xml"/>
       <Default Extension="png" ContentType="image/png"/>
       <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
     </Types>`);
  zip.file('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
     </Relationships>`);
  zip.file('word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
     </Relationships>`);
  zip.file('word/media/image1.png', PNG_1x1);
  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
       <w:body>
         <w:p><w:r><w:t>Figure 1. The threat.</w:t></w:r></w:p>
         <w:p><w:r><w:drawing><wp:inline>
           <wp:extent cx="914400" cy="914400"/>
           <wp:docPr id="1" name="Picture 1" descr="threat photo"/>
           <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
             <pic:pic>
               <pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>
               <pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
               <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
                 <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
             </pic:pic>
           </a:graphicData></a:graphic>
         </wp:inline></w:drawing></w:r></w:p>
       </w:body>
     </w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

function imageNodes(atoms: Array<{ nodes?: CanvasNode[] }>): CanvasNode[] {
  return atoms.flatMap((a) => (a.nodes ?? []).filter((n) => n.type === 'image'));
}

describe('docx import — embedded figures become image nodes', () => {
  it('extracts an embedded image as an image node carrying its data URI', async () => {
    const result = await readDocx(await docxWithImage(), 'figures.docx');
    const imgs = imageNodes(result.atoms as Array<{ nodes?: CanvasNode[] }>);
    expect(imgs.length).toBe(1);
    const content = imgs[0].content as { storage_key: string; width: number; height: number };
    expect(content.storage_key.startsWith('data:image/')).toBe(true);
    // The surrounding prose still imports — figures are added, never a replacement for text.
    expect(JSON.stringify(result.atoms)).toContain('Figure 1. The threat.');
  });

  it('never places a zero-height figure', async () => {
    const result = await readDocx(await docxWithImage(), 'figures.docx');
    for (const n of imageNodes(result.atoms as Array<{ nodes?: CanvasNode[] }>)) {
      const c = n.content as { width: number; height: number };
      expect(c.width).toBeGreaterThan(0);
      expect(c.height).toBeGreaterThan(0);
    }
  });
});
