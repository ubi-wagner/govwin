import mammoth from 'mammoth';
import * as htmlparser2 from 'htmlparser2';
import { createNode, type CanvasNode, type HeadingContent, type TextBlockContent, type ListContent, type TableContent, type TableCell } from '@/lib/types/canvas-document';
import type { ImportResult, ImportedAtom, DocumentMetadata } from './types';
import { inferCategory, inferCategoryFromFilename } from './types';

const SYSTEM_ACTOR = { id: 'system:import', name: 'Document Import' };

/**
 * Parse a .docx buffer into structured ImportedAtoms.
 *
 * The OOXML is already structured — headings, paragraphs, lists, tables
 * with styles and formatting. We read that structure via mammoth (which
 * outputs clean HTML), parse the HTML into CanvasNodes, then group by
 * heading hierarchy so each atom is a heading + its children.
 */
export async function readDocx(
  buffer: Buffer,
  filename: string,
): Promise<ImportResult> {
  try {
    const result = await mammoth.convertToHtml({ buffer });
    const html = result.value;

    const nodes = htmlToCanvasNodes(html);
    const atoms = groupByHeading(nodes, filename);
    const totalChars = nodes.reduce((sum, n) => sum + getTextLength(n), 0);

    const metadata = await extractDocxMetadata(buffer);

    return {
      atoms,
      sourceFilename: filename,
      sourceFormat: 'docx',
      totalChars,
      metadata,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error reading DOCX';
    return {
      atoms: [],
      sourceFilename: filename,
      sourceFormat: 'docx',
      totalChars: 0,
      metadata: { title: `(Error: ${message})` },
    };
  }
}

// ---------------------------------------------------------------------------
// HTML → CanvasNode[] conversion
// ---------------------------------------------------------------------------

interface ParseState {
  nodes: CanvasNode[];
  currentListItems: Array<{ text: string; indent_level: number }>;
  currentListType: 'bulleted_list' | 'numbered_list' | null;
  listDepth: number;
  currentTableRows: Array<(string | TableCell)[]>;
  currentTableHeaders: (string | TableCell)[];
  currentRow: (string | TableCell)[];
  currentCellText: string;
  inTable: boolean;
  inThead: boolean;
  inCell: boolean;
  inlineStack: Array<'bold' | 'italic' | 'underline' | 'superscript' | 'subscript'>;
  pendingText: string;
  pendingFormats: Array<{ start: number; length: number; format: 'bold' | 'italic' | 'underline' | 'superscript' | 'subscript' }>;
}

function htmlToCanvasNodes(html: string): CanvasNode[] {
  const state: ParseState = {
    nodes: [],
    currentListItems: [],
    currentListType: null,
    listDepth: 0,
    currentTableRows: [],
    currentTableHeaders: [],
    currentRow: [],
    currentCellText: '',
    inTable: false,
    inThead: false,
    inCell: false,
    inlineStack: [],
    pendingText: '',
    pendingFormats: [],
  };

  const parser = new htmlparser2.Parser({
    onopentag(name, attribs) {
      const tag = name.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        flushPendingText(state);
        state.pendingText = '';
        state.pendingFormats = [];
      }

      if (tag === 'ul') {
        if (state.listDepth === 0) flushList(state);
        state.currentListType = state.currentListType ?? 'bulleted_list';
        state.listDepth++;
      } else if (tag === 'ol') {
        if (state.listDepth === 0) flushList(state);
        state.currentListType = state.currentListType ?? 'numbered_list';
        state.listDepth++;
      } else if (tag === 'li') {
        // will capture text in ontext
      } else if (tag === 'table') {
        flushPendingText(state);
        flushList(state);
        state.inTable = true;
        state.currentTableHeaders = [];
        state.currentTableRows = [];
      } else if (tag === 'thead') {
        state.inThead = true;
      } else if (tag === 'tbody') {
        state.inThead = false;
      } else if (tag === 'tr') {
        state.currentRow = [];
      } else if (tag === 'td' || tag === 'th') {
        state.inCell = true;
        state.currentCellText = '';
      } else if (tag === 'strong' || tag === 'b') {
        state.inlineStack.push('bold');
        markFormatStart(state, 'bold');
      } else if (tag === 'em' || tag === 'i') {
        state.inlineStack.push('italic');
        markFormatStart(state, 'italic');
      } else if (tag === 'u') {
        state.inlineStack.push('underline');
        markFormatStart(state, 'underline');
      } else if (tag === 'sup') {
        state.inlineStack.push('superscript');
        markFormatStart(state, 'superscript');
      } else if (tag === 'sub') {
        state.inlineStack.push('subscript');
        markFormatStart(state, 'subscript');
      } else if (tag === 'p') {
        // mammoth wraps everything in <p>. If we're inside a list or
        // table, let the parent handler deal with it.
      }
    },

    ontext(text) {
      if (state.inCell) {
        state.currentCellText += text;
        return;
      }

      if (state.listDepth > 0) {
        // Accumulate list item text (handled in onclosetag for <li>)
        state.pendingText += text;
        return;
      }

      state.pendingText += text;
    },

    onclosetag(name) {
      const tag = name.toLowerCase();

      const headingMatch = tag.match(/^h([1-6])$/);
      if (headingMatch) {
        const level = Math.min(parseInt(headingMatch[1], 10), 3) as 1 | 2 | 3;
        const text = state.pendingText.trim();
        if (text) {
          state.nodes.push(createNode({
            type: 'heading',
            content: { level, text } satisfies HeadingContent,
            source: 'imported',
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
          }));
        }
        state.pendingText = '';
        state.pendingFormats = [];
        return;
      }

      if (tag === 'li') {
        const text = state.pendingText.trim();
        if (text) {
          state.currentListItems.push({
            text,
            indent_level: Math.max(0, state.listDepth - 1),
          });
        }
        state.pendingText = '';
        state.pendingFormats = [];
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        state.listDepth--;
        if (state.listDepth === 0) {
          flushList(state);
        }
        return;
      }

      if (tag === 'td' || tag === 'th') {
        state.inCell = false;
        state.currentRow.push(state.currentCellText.trim());
        state.currentCellText = '';
        return;
      }

      if (tag === 'tr') {
        if (state.inThead || (state.currentTableRows.length === 0 && state.currentTableHeaders.length === 0)) {
          state.currentTableHeaders = [...state.currentRow];
        } else {
          state.currentTableRows.push([...state.currentRow]);
        }
        state.currentRow = [];
        return;
      }

      if (tag === 'thead') {
        state.inThead = false;
        return;
      }

      if (tag === 'table') {
        flushTable(state);
        state.inTable = false;
        return;
      }

      if (tag === 'p' && !state.inTable && state.listDepth === 0) {
        flushPendingText(state);
        return;
      }

      // Close inline format tags
      if (tag === 'strong' || tag === 'b') closeFormat(state, 'bold');
      else if (tag === 'em' || tag === 'i') closeFormat(state, 'italic');
      else if (tag === 'u') closeFormat(state, 'underline');
      else if (tag === 'sup') closeFormat(state, 'superscript');
      else if (tag === 'sub') closeFormat(state, 'subscript');
    },
  });

  parser.write(html);
  parser.end();

  // Flush anything remaining
  flushPendingText(state);
  flushList(state);

  return state.nodes;
}

function markFormatStart(
  state: ParseState,
  format: 'bold' | 'italic' | 'underline' | 'superscript' | 'subscript',
) {
  state.pendingFormats.push({
    start: state.pendingText.length,
    length: 0,
    format,
  });
}

function closeFormat(
  state: ParseState,
  format: 'bold' | 'italic' | 'underline' | 'superscript' | 'subscript',
) {
  const idx = state.inlineStack.lastIndexOf(format);
  if (idx >= 0) state.inlineStack.splice(idx, 1);

  for (let i = state.pendingFormats.length - 1; i >= 0; i--) {
    const f = state.pendingFormats[i];
    if (f.format === format && f.length === 0) {
      f.length = state.pendingText.length - f.start;
      break;
    }
  }
}

function flushPendingText(state: ParseState) {
  const text = state.pendingText.trim();
  if (!text) {
    state.pendingText = '';
    state.pendingFormats = [];
    return;
  }

  const formats = state.pendingFormats
    .filter((f) => f.length > 0)
    .map((f) => ({
      start: f.start,
      length: f.length,
      format: f.format,
    }));

  const content: TextBlockContent = { text };
  if (formats.length > 0) {
    content.inline_formats = formats;
  }

  state.nodes.push(createNode({
    type: 'text_block',
    content,
    source: 'imported',
    actorId: SYSTEM_ACTOR.id,
    actorName: SYSTEM_ACTOR.name,
  }));

  state.pendingText = '';
  state.pendingFormats = [];
}

function flushList(state: ParseState) {
  if (state.currentListItems.length === 0) return;

  const type = state.currentListType ?? 'bulleted_list';
  state.nodes.push(createNode({
    type,
    content: {
      items: state.currentListItems.map((item) => ({
        text: item.text,
        indent_level: item.indent_level,
      })),
    } satisfies ListContent,
    source: 'imported',
    actorId: SYSTEM_ACTOR.id,
    actorName: SYSTEM_ACTOR.name,
  }));

  state.currentListItems = [];
  state.currentListType = null;
}

function flushTable(state: ParseState) {
  const headers = state.currentTableHeaders.length > 0
    ? state.currentTableHeaders
    : (state.currentTableRows.shift() ?? []);

  if (headers.length === 0 && state.currentTableRows.length === 0) return;

  state.nodes.push(createNode({
    type: 'table',
    content: {
      headers,
      rows: state.currentTableRows,
    } satisfies TableContent,
    source: 'imported',
    actorId: SYSTEM_ACTOR.id,
    actorName: SYSTEM_ACTOR.name,
  }));

  state.currentTableHeaders = [];
  state.currentTableRows = [];
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
 * Fallback for documents with no headings — group every N text_block
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
    case 'table': {
      const t = node.content as TableContent;
      const headerTexts = t.headers.map((h) => typeof h === 'string' ? h : h.text);
      const rowTexts = t.rows.map((r) => r.map((c) => typeof c === 'string' ? c : c.text).join(' '));
      return [...headerTexts, ...rowTexts].join(' ');
    }
    default: return '';
  }
}

function getTextLength(node: CanvasNode): number {
  return getTextContent(node).length;
}

async function extractDocxMetadata(buffer: Buffer): Promise<DocumentMetadata> {
  // mammoth doesn't expose metadata directly, so we parse the OOXML
  // core.xml ourselves. The .docx is a zip file.
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const coreXml = await zip.file('docProps/core.xml')?.async('text');
    if (!coreXml) return {};

    const meta: DocumentMetadata = {};

    const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
    if (titleMatch) meta.title = titleMatch[1].trim();

    const authorMatch = coreXml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
    if (authorMatch) meta.author = authorMatch[1].trim();

    const subjectMatch = coreXml.match(/<dc:subject>([^<]*)<\/dc:subject>/);
    if (subjectMatch) meta.subject = subjectMatch[1].trim();

    const keywordsMatch = coreXml.match(/<cp:keywords>([^<]*)<\/cp:keywords>/);
    if (keywordsMatch) {
      meta.keywords = keywordsMatch[1].split(/[,;]/).map((k) => k.trim()).filter(Boolean);
    }

    const createdMatch = coreXml.match(/<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/);
    if (createdMatch) meta.created = createdMatch[1].trim();

    const modifiedMatch = coreXml.match(/<dcterms:modified[^>]*>([^<]*)<\/dcterms:modified>/);
    if (modifiedMatch) meta.modified = modifiedMatch[1].trim();

    // Page count from app.xml
    const appXml = await zip.file('docProps/app.xml')?.async('text');
    if (appXml) {
      const pagesMatch = appXml.match(/<Pages>(\d+)<\/Pages>/);
      if (pagesMatch) meta.pageCount = parseInt(pagesMatch[1], 10);
    }

    return meta;
  } catch {
    return {};
  }
}
