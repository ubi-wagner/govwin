import { PDFParse } from 'pdf-parse';
import {
  createNode,
  type CanvasNode,
  type HeadingContent,
  type TextBlockContent,
  type ListContent,
} from '@/lib/types/canvas-document';
import type { ImportResult, ImportedAtom, DocumentMetadata } from './types';
import { inferCategory, inferCategoryFromFilename } from './types';

const SYSTEM_ACTOR = { id: 'system:import', name: 'Document Import' };

/** Minimum character count to consider a PDF as having extractable text. */
const MIN_TEXT_LENGTH = 50;

/**
 * Parse a PDF buffer into structured ImportedAtoms.
 *
 * Uses `pdf-parse` to extract raw text, then applies heuristics to detect
 * headings, list items, and paragraph boundaries. Content is grouped by
 * heading hierarchy so each atom is a heading + its children.
 *
 * For scanned PDFs where no text can be extracted, returns zero atoms with
 * a metadata note.
 */
export async function readPdf(
  buffer: Buffer,
  filename: string,
): Promise<ImportResult> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  let rawText = '';
  let pageCount = 0;
  const metadata: DocumentMetadata = {};

  try {
    const textResult = await parser.getText();
    rawText = textResult.text ?? '';
    pageCount = textResult.total;
  } catch {
    // Text extraction failed entirely — treat as scanned PDF
  }

  try {
    const infoResult = await parser.getInfo();
    metadata.pageCount = pageCount || infoResult.total;
    extractInfoMetadata(infoResult, metadata);
  } catch {
    metadata.pageCount = pageCount || undefined;
  }

  // Clean up parser resources
  try {
    await parser.destroy();
  } catch {
    // Ignore cleanup errors
  }

  const totalChars = rawText.length;

  // Handle scanned PDFs / empty text extraction
  if (rawText.trim().length < MIN_TEXT_LENGTH) {
    return {
      atoms: [],
      sourceFilename: filename,
      sourceFormat: 'pdf',
      totalChars,
      metadata: {
        ...metadata,
        title: metadata.title ?? '(scanned PDF - no extractable text)',
      },
    };
  }

  const nodes = textToCanvasNodes(rawText);
  const atoms = groupByHeading(nodes, filename);

  return {
    atoms,
    sourceFilename: filename,
    sourceFormat: 'pdf',
    totalChars,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

function extractInfoMetadata(
  infoResult: { info?: Record<string, unknown>; getDateNode: () => Record<string, Date | null | undefined> },
  meta: DocumentMetadata,
): void {
  const info = infoResult.info;
  if (info) {
    if (typeof info.Title === 'string' && info.Title.trim()) {
      meta.title = info.Title.trim();
    }
    if (typeof info.Author === 'string' && info.Author.trim()) {
      meta.author = info.Author.trim();
    }
    if (typeof info.Subject === 'string' && info.Subject.trim()) {
      meta.subject = info.Subject.trim();
    }
    if (typeof info.Keywords === 'string' && info.Keywords.trim()) {
      meta.keywords = info.Keywords
        .split(/[,;]/)
        .map((k: string) => k.trim())
        .filter(Boolean);
    }
  }

  try {
    const dates = infoResult.getDateNode();
    if (dates.CreationDate instanceof Date) {
      meta.created = dates.CreationDate.toISOString();
    } else if (dates.XmpCreateDate instanceof Date) {
      meta.created = dates.XmpCreateDate.toISOString();
    }
    if (dates.ModDate instanceof Date) {
      meta.modified = dates.ModDate.toISOString();
    } else if (dates.XmpModifyDate instanceof Date) {
      meta.modified = dates.XmpModifyDate.toISOString();
    }
  } catch {
    // Date parsing is best-effort
  }
}

// ---------------------------------------------------------------------------
// Text → CanvasNode[] conversion
// ---------------------------------------------------------------------------

/** Regex patterns for detecting list items */
const BULLETED_LIST_RE = /^[\s]*[-•*]\s+(.+)/;
const NUMBERED_LIST_RE = /^[\s]*(?:\d+[.)]\s+|[a-zA-Z][.)]\s+)(.+)/;

/** Heuristic heading detection */
function isHeadingLine(line: string): { isHeading: boolean; level: 1 | 2 | 3 } {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length >= 100) return { isHeading: false, level: 1 };

  // Markdown-style headings: # Heading, ## Heading, ### Heading
  const mdMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
  if (mdMatch) {
    return { isHeading: true, level: mdMatch[1].length as 1 | 2 | 3 };
  }

  // Numbered section headings: "1. Title", "1.2 Title", "1.2.3 Title"
  const numberedMatch = trimmed.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)/);
  if (numberedMatch) {
    const text = numberedMatch[2];
    // Only treat as heading if the text after the number is short
    if (text.length < 80 && !text.endsWith('.')) {
      const depth = numberedMatch[1].split('.').length;
      const level = Math.min(depth, 3) as 1 | 2 | 3;
      return { isHeading: true, level };
    }
  }

  // ALL CAPS lines that are short (likely section titles)
  if (
    trimmed.length >= 3 &&
    trimmed.length < 80 &&
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]/.test(trimmed) &&
    !/^\d+$/.test(trimmed)
  ) {
    return { isHeading: true, level: 1 };
  }

  return { isHeading: false, level: 1 };
}

function isBulletedListItem(line: string): boolean {
  return BULLETED_LIST_RE.test(line);
}

function isNumberedListItem(line: string): boolean {
  return NUMBERED_LIST_RE.test(line);
}

function extractListItemText(line: string): string {
  const bulletMatch = line.match(BULLETED_LIST_RE);
  if (bulletMatch) return bulletMatch[1].trim();

  const numberedMatch = line.match(NUMBERED_LIST_RE);
  if (numberedMatch) return numberedMatch[1].trim();

  return line.trim();
}

function textToCanvasNodes(text: string): CanvasNode[] {
  const nodes: CanvasNode[] = [];

  // Split into paragraphs by double newlines, preserving structure
  const paragraphs = text.split(/\n\n+/);

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n').map((l) => l.trimEnd());

    // Check if the entire paragraph is a single heading line
    if (lines.length === 1) {
      const { isHeading, level } = isHeadingLine(lines[0]);
      if (isHeading) {
        const headingText = cleanHeadingText(lines[0]);
        nodes.push(createNode({
          type: 'heading',
          content: { level, text: headingText } satisfies HeadingContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));
        continue;
      }
    }

    // Process lines within the paragraph to detect list items
    // Group consecutive list items together, flush text blocks between them
    let textBuffer: string[] = [];
    let bulletItems: string[] = [];
    let numberedItems: string[] = [];

    function flushText() {
      const joined = textBuffer.join('\n').trim();
      if (joined) {
        nodes.push(createNode({
          type: 'text_block',
          content: { text: joined } satisfies TextBlockContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));
      }
      textBuffer = [];
    }

    function flushBulletList() {
      if (bulletItems.length === 0) return;
      nodes.push(createNode({
        type: 'bulleted_list',
        content: {
          items: bulletItems.map((item) => ({ text: item })),
        } satisfies ListContent,
        source: 'imported',
        actorId: SYSTEM_ACTOR.id,
        actorName: SYSTEM_ACTOR.name,
      }));
      bulletItems = [];
    }

    function flushNumberedList() {
      if (numberedItems.length === 0) return;
      nodes.push(createNode({
        type: 'numbered_list',
        content: {
          items: numberedItems.map((item) => ({ text: item })),
        } satisfies ListContent,
        source: 'imported',
        actorId: SYSTEM_ACTOR.id,
        actorName: SYSTEM_ACTOR.name,
      }));
      numberedItems = [];
    }

    for (const line of lines) {
      if (!line.trim()) continue;

      // Check if the first line in a multi-line paragraph is a heading
      if (
        lines.indexOf(line) === 0 &&
        lines.length > 1
      ) {
        const { isHeading, level } = isHeadingLine(line);
        if (isHeading) {
          flushText();
          flushBulletList();
          flushNumberedList();
          const headingText = cleanHeadingText(line);
          nodes.push(createNode({
            type: 'heading',
            content: { level, text: headingText } satisfies HeadingContent,
            source: 'imported',
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
          }));
          continue;
        }
      }

      if (isBulletedListItem(line)) {
        flushText();
        flushNumberedList();
        bulletItems.push(extractListItemText(line));
      } else if (isNumberedListItem(line)) {
        // Only treat as numbered list item if we already have numbered items
        // or if it clearly starts with "1." to avoid false positives with
        // numbered section headings (those are caught by isHeadingLine above)
        const isFirstNumberedItem = numberedItems.length === 0;
        if (isFirstNumberedItem && /^[\s]*1[.)]\s+/.test(line)) {
          flushText();
          flushBulletList();
          numberedItems.push(extractListItemText(line));
        } else if (!isFirstNumberedItem) {
          flushText();
          flushBulletList();
          numberedItems.push(extractListItemText(line));
        } else {
          // Looks like a numbered line but not starting from 1 and no
          // prior context -- treat as regular text
          flushBulletList();
          flushNumberedList();
          textBuffer.push(line.trim());
        }
      } else {
        flushBulletList();
        flushNumberedList();
        textBuffer.push(line.trim());
      }
    }

    flushText();
    flushBulletList();
    flushNumberedList();
  }

  return nodes;
}

/**
 * Strip markdown heading markers and numbering prefixes from heading text.
 */
function cleanHeadingText(line: string): string {
  let text = line.trim();
  // Remove markdown markers
  text = text.replace(/^#{1,3}\s+/, '');
  // Numbering is preserved — it's useful for the atom's headingText
  return text;
}

// ---------------------------------------------------------------------------
// Heading-based atom grouping
// ---------------------------------------------------------------------------

function groupByHeading(nodes: CanvasNode[], filename: string): ImportedAtom[] {
  if (nodes.length === 0) return [];

  const atoms: ImportedAtom[] = [];
  let currentGroup: CanvasNode[] = [];
  let currentHeading: string | null = null;
  let currentLevel = 0;
  let charOffset = 0;

  const fileCat = inferCategoryFromFilename(filename);

  function flushGroup() {
    if (currentGroup.length === 0) return;

    const headingText = currentHeading;
    const contentText = currentGroup.map(getTextContent).join(' ');
    const charLength = contentText.length;

    // Category: try heading text first, fall back to filename
    const catResult = headingText
      ? inferCategory(headingText)
      : fileCat;

    // If heading inference is low-confidence, try the content itself
    const finalCat = catResult.confidence >= 0.5
      ? catResult
      : (() => {
          const contentCat = inferCategory(contentText.slice(0, 500));
          return contentCat.confidence > catResult.confidence ? contentCat : catResult;
        })();

    const tags: string[] = [finalCat.category];
    if (headingText) tags.push(`heading:${headingText.slice(0, 80)}`);
    tags.push(`source:${filename.slice(0, 50)}`);

    atoms.push({
      nodes: [...currentGroup],
      suggestedCategory: finalCat.category,
      suggestedTags: tags,
      headingText,
      charOffset,
      charLength,
      confidence: finalCat.confidence,
    });

    charOffset += charLength;
    currentGroup = [];
    currentHeading = null;
  }

  for (const node of nodes) {
    if (node.type === 'heading') {
      const content = node.content as HeadingContent;
      const level = content.level;

      // New same-or-higher-level heading starts a new atom
      if (currentGroup.length > 0 && level <= currentLevel) {
        flushGroup();
      }

      // If this is the first heading or a higher/same-level heading,
      // it becomes the atom's heading
      if (currentGroup.length === 0) {
        currentHeading = content.text;
        currentLevel = level;
      }

      currentGroup.push(node);
    } else {
      // Non-heading node: add to current group
      // If no group started yet (content before first heading), start one
      if (currentGroup.length === 0) {
        currentHeading = null;
        currentLevel = 0;
      }
      currentGroup.push(node);
    }
  }

  flushGroup();

  // If we got a single atom with everything in it and the document has
  // multiple paragraphs, fall back to paragraph-level splitting
  if (atoms.length === 1 && atoms[0].nodes.length > 8) {
    return splitByParagraphCount(atoms[0].nodes, filename, 4);
  }

  return atoms;
}

/**
 * Fallback for documents with no headings -- group every N text_block
 * nodes into one atom.
 */
function splitByParagraphCount(
  nodes: CanvasNode[],
  filename: string,
  groupSize: number,
): ImportedAtom[] {
  const atoms: ImportedAtom[] = [];
  const fileCat = inferCategoryFromFilename(filename);
  let group: CanvasNode[] = [];
  let paraCount = 0;
  let charOffset = 0;

  for (const node of nodes) {
    group.push(node);
    if (node.type === 'text_block') paraCount++;

    if (paraCount >= groupSize) {
      const contentText = group.map(getTextContent).join(' ');
      const contentCat = inferCategory(contentText.slice(0, 500));
      const cat = contentCat.confidence > fileCat.confidence ? contentCat : fileCat;

      atoms.push({
        nodes: [...group],
        suggestedCategory: cat.category,
        suggestedTags: [cat.category, `source:${filename.slice(0, 50)}`],
        headingText: null,
        charOffset,
        charLength: contentText.length,
        confidence: cat.confidence,
      });

      charOffset += contentText.length;
      group = [];
      paraCount = 0;
    }
  }

  if (group.length > 0) {
    const contentText = group.map(getTextContent).join(' ');
    const contentCat = inferCategory(contentText.slice(0, 500));
    const cat = contentCat.confidence > fileCat.confidence ? contentCat : fileCat;
    atoms.push({
      nodes: [...group],
      suggestedCategory: cat.category,
      suggestedTags: [cat.category, `source:${filename.slice(0, 50)}`],
      headingText: null,
      charOffset,
      charLength: contentText.length,
      confidence: cat.confidence,
    });
  }

  return atoms;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextContent(node: CanvasNode): string {
  if (!node.content) return '';
  switch (node.type) {
    case 'heading': return (node.content as HeadingContent).text;
    case 'text_block': return (node.content as TextBlockContent).text;
    case 'bulleted_list':
    case 'numbered_list':
      return (node.content as ListContent).items.map((i) => i.text).join(' ');
    default: return '';
  }
}
