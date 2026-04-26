import JSZip from 'jszip';
import {
  createNode,
  type CanvasNode,
  type HeadingContent,
  type TextBlockContent,
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

  for (let i = 0; i < slideEntries.length; i++) {
    const slidePath = slideEntries[i];
    const slideXml = await zip.file(slidePath)?.async('text');
    if (!slideXml) continue;

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
  }

  const metadata = await extractPptxMetadata(zip, slideEntries.length);

  return {
    atoms,
    sourceFilename: filename,
    sourceFormat: 'pptx',
    totalChars,
    metadata,
  };
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
      textRuns.push(textMatch[1]);
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
    default: return '';
  }
}
