import JSZip from 'jszip';
import {
  createNode,
  type CanvasNode,
  type HeadingContent,
  type TextBlockContent,
  type TableContent,
} from '@/lib/types/canvas-document';
import type { ImportResult, ImportedAtom, DocumentMetadata } from './types';
import { inferCategory, inferCategoryFromFilename } from './types';

const SYSTEM_ACTOR = { id: 'system:import', name: 'Document Import' };

/**
 * Parse a .pptx buffer into structured ImportedAtoms.
 *
 * A .pptx is a ZIP containing XML slides at ppt/slides/slideN.xml.
 * Each slide becomes one ImportedAtom. The title shape provides the
 * heading node and remaining shapes provide text_block nodes.
 */
export async function readPptx(
  buffer: Buffer,
  filename: string,
): Promise<ImportResult> {
  try {
    const zip = await JSZip.loadAsync(buffer);

    // Discover slide files and sort numerically
    const slideEntries = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
        return numA - numB;
      });

    const fileCat = inferCategoryFromFilename(filename);
    const atoms: ImportedAtom[] = [];
    let totalChars = 0;
    let charOffset = 0;
    let picCount = 0; // <p:pic> slide images — dropped by the text pass; flagged for the box tool

    for (let i = 0; i < slideEntries.length; i++) {
      try {
        const slidePath = slideEntries[i];
        const slideXml = await zip.file(slidePath)?.async('text');
        if (!slideXml) continue;
        picCount += (slideXml.match(/<p:pic\b/g) || []).length; // count images the text pass can't read

        // Extract title and body text from the slide
        const { title, bodyParagraphs } = parseSlideXml(slideXml);

        // Try to read speaker notes
        const slideNum = slidePath.match(/slide(\d+)/)?.[1];
        const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
        const notesXml = await zip.file(notesPath)?.async('text');
        const noteText = notesXml ? extractNotesText(notesXml) : null;

        // Build nodes for this slide
        const nodes: CanvasNode[] = [];

        // Heading from title shape (or fallback to "Slide N")
        const headingText = title?.trim() || null;
        const headingDisplay = headingText ?? `Slide ${i + 1}`;

        nodes.push(createNode({
          type: 'heading',
          content: { level: 2, text: headingDisplay } satisfies HeadingContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));

        // Body text blocks — each non-empty paragraph becomes a text_block
        for (const para of bodyParagraphs) {
          const trimmed = para.trim();
          if (!trimmed) continue;
          nodes.push(createNode({
            type: 'text_block',
            content: { text: trimmed } satisfies TextBlockContent,
            source: 'imported',
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
          }));
        }

        // Tables — a deck's data/cost tables (in <p:graphicFrame><a:tbl>) were dropped before;
        // only <p:sp> text shapes were read. Extract each as a real table node so it atomizes.
        for (const t of parseSlideTables(slideXml)) {
          nodes.push(createNode({
            type: 'table',
            content: { headers: t.headers, rows: t.rows } satisfies TableContent,
            source: 'imported',
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
          }));
        }

        // Speaker notes as a separate text_block (if present)
        if (noteText) {
          nodes.push(createNode({
            type: 'text_block',
            content: { text: `[Speaker Notes] ${noteText}` } satisfies TextBlockContent,
            source: 'imported',
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
          }));
        }

        // Skip entirely empty slides (no body content at all)
        const contentText = nodes.map((n) => getNodeText(n)).join(' ');
        const charLength = contentText.length;
        totalChars += charLength;

        // Infer category from heading, then content, then filename
        const headingCat = headingText ? inferCategory(headingText) : { category: 'general', confidence: 0 };
        const contentCat = inferCategory(contentText.slice(0, 500));
        let finalCat = headingCat.confidence >= contentCat.confidence ? headingCat : contentCat;
        if (finalCat.confidence < fileCat.confidence) {
          finalCat = fileCat;
        }

        const tags: string[] = [finalCat.category];
        if (headingText) tags.push(`heading:${headingText.slice(0, 80)}`);
        tags.push(`source:${filename.slice(0, 50)}`);
        tags.push(`slide:${i + 1}`);

        atoms.push({
          nodes,
          suggestedCategory: finalCat.category,
          suggestedTags: tags,
          headingText,
          charOffset,
          charLength,
          confidence: finalCat.confidence,
        });

        charOffset += charLength;
      } catch (slideErr) {
        console.error(`[pptx-reader] Error parsing slide ${i + 1} of ${filename}:`, slideErr);
        // Continue with remaining slides
      }
    }

    const metadata = await extractPptxMetadata(zip, slideEntries.length);

    return {
      atoms,
      sourceFilename: filename,
      sourceFormat: 'pptx',
      totalChars,
      metadata,
      unextractable: picCount > 0 ? {
        count: picCount,
        kind: 'slide_image',
        hint: `${picCount} slide image(s) can’t be read as text. Export the slide(s) as PNG and use the Capture tab → “Box an uploaded image”, or screen-capture them to grab as image atoms.`,
      } : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error reading PPTX';
    return {
      atoms: [],
      sourceFilename: filename,
      sourceFormat: 'pptx',
      totalChars: 0,
      metadata: { title: `(Error: ${message})` },
    };
  }
}

// ---------------------------------------------------------------------------
// Slide XML parsing (regex-based)
// ---------------------------------------------------------------------------

interface SlideContent {
  title: string | null;
  bodyParagraphs: string[];
}

/**
 * Parse a single slide XML to extract the title and body text.
 *
 * Title shapes are identified by `<p:ph type="title"/>` or
 * `<p:ph type="ctrTitle"/>` inside `<p:nvSpPr>`. All other shapes
 * contribute body paragraphs.
 */
function parseSlideXml(xml: string): SlideContent {
  // Split out individual shapes (<p:sp>...</p:sp>)
  const shapeRegex = /<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g;
  const shapes = xml.match(shapeRegex) ?? [];

  let title: string | null = null;
  const bodyParagraphs: string[] = [];

  for (const shape of shapes) {
    const isTitle = isTitleShape(shape);
    const paragraphs = extractParagraphs(shape);

    if (isTitle && title === null) {
      // Combine all paragraphs from the title shape into one string
      title = paragraphs.join(' ').trim() || null;
    } else {
      // Body shape — each paragraph is separate
      for (const p of paragraphs) {
        if (p.trim()) {
          bodyParagraphs.push(p);
        }
      }
    }
  }

  return { title, bodyParagraphs };
}

/**
 * Decode the five XML predefined entities.
 *
 * PPTX text lives in XML, so a slide reading "Core Technology & IP" is stored as
 * "Core Technology &amp; IP". This was applied to table cells only, so every slide TITLE and BODY
 * paragraph kept its raw entities — measured on a real deck: atoms titled
 * "Slide 4 Core Technology &amp; IP", "Slide 7 Facilities &amp; Capabilities". Those are library
 * content: they get ranked, inserted into a section, and exported into a customer's proposal with
 * the "&amp;" intact. Decoding belongs at the run level, where ALL slide text passes through.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" doesn't double-decode
}

/**
 * Extract every table on a slide. Tables live in
 * <p:graphicFrame>…<a:graphicData …table><a:tbl> — NOT in <p:sp> — so the text pass misses
 * them. Rows are <a:tr>, cells <a:tc>, cell text the <a:t> runs. First row → headers, rest →
 * rows (merged-cell continuations read as empty cells). Exported for unit testing.
 */
export function parseSlideTables(xml: string): Array<{ headers: string[]; rows: string[][] }> {
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  const tblRegex = /<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/g;
  let tblMatch: RegExpExecArray | null;
  while ((tblMatch = tblRegex.exec(xml)) !== null) {
    const tblXml = tblMatch[0];
    const allRows: string[][] = [];
    const trRegex = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRegex.exec(tblXml)) !== null) {
      const cells: string[] = [];
      const tcRegex = /<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g;
      let tcMatch: RegExpExecArray | null;
      while ((tcMatch = tcRegex.exec(trMatch[0])) !== null) {
        const runs: string[] = [];
        const textRegex = /<a:t>([\s\S]*?)<\/a:t>/g;
        let tMatch: RegExpExecArray | null;
        while ((tMatch = textRegex.exec(tcMatch[0])) !== null) runs.push(tMatch[1]);
        cells.push(decodeXmlEntities(runs.join('').trim()));
      }
      if (cells.length) allRows.push(cells);
    }
    if (allRows.length) {
      const [headers, ...rows] = allRows;
      tables.push({ headers, rows });
    }
  }
  return tables;
}

/**
 * Check if a shape XML fragment is a title placeholder.
 * Looks for `<p:ph` with type="title" or type="ctrTitle" inside `<p:nvSpPr>`.
 */
function isTitleShape(shapeXml: string): boolean {
  // Find the non-visual shape properties section
  const nvSpPr = shapeXml.match(/<p:nvSpPr>[\s\S]*?<\/p:nvSpPr>/);
  if (!nvSpPr) return false;

  // Look for placeholder with title type
  return /<p:ph[^>]*type\s*=\s*["'](title|ctrTitle)["']/.test(nvSpPr[0]);
}

/**
 * Extract paragraphs from a shape. Each `<a:p>` becomes a paragraph
 * composed of its `<a:t>` text runs.
 */
function extractParagraphs(shapeXml: string): string[] {
  const paragraphs: string[] = [];
  const paraRegex = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
  let paraMatch;

  while ((paraMatch = paraRegex.exec(shapeXml)) !== null) {
    const paraXml = paraMatch[0];
    const textRuns: string[] = [];
    const textRegex = /<a:t>([\s\S]*?)<\/a:t>/g;
    let textMatch;

    while ((textMatch = textRegex.exec(paraXml)) !== null) {
      // Decode per RUN, before joining: a run boundary can fall inside an entity's own text in
      // pathological files, and decoding after the join would then mis-read it.
      textRuns.push(decodeXmlEntities(textMatch[1]));
    }

    const paragraph = textRuns.join('').trim();
    if (paragraph) {
      paragraphs.push(paragraph);
    }
  }

  return paragraphs;
}

/**
 * Extract speaker notes text from a notesSlide XML.
 * Notes body text is in `<a:t>` tags within `<p:sp>` shapes,
 * but we skip the slide-number placeholder.
 */
function extractNotesText(notesXml: string): string | null {
  const shapeRegex = /<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g;
  const shapes = notesXml.match(shapeRegex) ?? [];
  const textParts: string[] = [];

  for (const shape of shapes) {
    // Skip placeholder shapes that are just slide number / slide image
    const nvSpPr = shape.match(/<p:nvSpPr>[\s\S]*?<\/p:nvSpPr>/);
    if (nvSpPr) {
      // type="sldNum" is the slide-number placeholder
      // type="sldImg" is the slide-image placeholder
      if (/<p:ph[^>]*type\s*=\s*["'](sldNum|sldImg)["']/.test(nvSpPr[0])) {
        continue;
      }
    }

    const paragraphs = extractParagraphs(shape);
    for (const p of paragraphs) {
      if (p.trim()) {
        textParts.push(p.trim());
      }
    }
  }

  const combined = textParts.join('\n').trim();
  return combined || null;
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

async function extractPptxMetadata(
  zip: JSZip,
  slideCount: number,
): Promise<DocumentMetadata> {
  const meta: DocumentMetadata = { slideCount };

  try {
    const coreXml = await zip.file('docProps/core.xml')?.async('text');
    if (coreXml) {
      const titleMatch = coreXml.match(/<dc:title>([\s\S]*?)<\/dc:title>/);
      if (titleMatch) meta.title = titleMatch[1].trim();

      const authorMatch = coreXml.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/);
      if (authorMatch) meta.author = authorMatch[1].trim();

      const subjectMatch = coreXml.match(/<dc:subject>([\s\S]*?)<\/dc:subject>/);
      if (subjectMatch) meta.subject = subjectMatch[1].trim();

      const keywordsMatch = coreXml.match(/<cp:keywords>([\s\S]*?)<\/cp:keywords>/);
      if (keywordsMatch) {
        meta.keywords = keywordsMatch[1].split(/[,;]/).map((k) => k.trim()).filter(Boolean);
      }

      const createdMatch = coreXml.match(/<dcterms:created[^>]*>([\s\S]*?)<\/dcterms:created>/);
      if (createdMatch) meta.created = createdMatch[1].trim();

      const modifiedMatch = coreXml.match(/<dcterms:modified[^>]*>([\s\S]*?)<\/dcterms:modified>/);
      if (modifiedMatch) meta.modified = modifiedMatch[1].trim();
    }
  } catch {
    // Metadata extraction is best-effort
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNodeText(node: CanvasNode): string {
  if (!node.content) return '';
  switch (node.type) {
    case 'heading': return (node.content as HeadingContent).text;
    case 'text_block': return (node.content as TextBlockContent).text;
    case 'table': {
      const t = node.content as TableContent;
      const cell = (c: string | { text?: string }) => (typeof c === 'string' ? c : c?.text ?? '');
      return [...(t.headers ?? []).map(cell), ...(t.rows ?? []).flat().map(cell)].join(' ');
    }
    default: return '';
  }
}
