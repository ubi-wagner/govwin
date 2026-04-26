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

/**
 * Parse a .txt or .md buffer into structured ImportedAtoms.
 *
 * For .md files: detects headings (# / ## / ###), lists (- / * / 1.),
 * and groups content by heading hierarchy.
 *
 * For .txt files: detects headings heuristically (short lines, all caps,
 * or lines starting with numbers), detects lists, splits on double
 * newlines, and groups by heading.
 */
export async function readText(
  buffer: Buffer,
  filename: string,
): Promise<ImportResult> {
  const text = buffer.toString('utf-8');
  const isMarkdown = /\.md$/i.test(filename);

  const nodes = isMarkdown
    ? parseMarkdown(text)
    : parsePlainText(text);

  const atoms = groupByHeading(nodes, filename);
  const totalChars = text.length;

  const metadata: DocumentMetadata = {};

  return {
    atoms,
    sourceFilename: filename,
    sourceFormat: isMarkdown ? 'md' : 'txt',
    totalChars,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

function parseMarkdown(text: string): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading: # / ## / ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      const headingText = headingMatch[2].trim();
      if (headingText) {
        nodes.push(createNode({
          type: 'heading',
          content: { level, text: headingText } satisfies HeadingContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));
      }
      i++;
      continue;
    }

    // List block: collect consecutive lines starting with - / * / 1.
    if (/^\s*[-*]\s/.test(line) || /^\s*\d+[.)]\s/.test(line)) {
      const items: Array<{ text: string; indent_level: number }> = [];
      const isNumbered = /^\s*\d+[.)]\s/.test(line);

      while (i < lines.length && (/^\s*[-*]\s/.test(lines[i]) || /^\s*\d+[.)]\s/.test(lines[i]))) {
        const itemLine = lines[i];
        const indentMatch = itemLine.match(/^(\s*)/);
        const indentLevel = Math.floor((indentMatch?.[1].length ?? 0) / 2);
        const itemText = itemLine.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim();
        if (itemText) {
          items.push({ text: itemText, indent_level: indentLevel });
        }
        i++;
      }

      if (items.length > 0) {
        nodes.push(createNode({
          type: isNumbered ? 'numbered_list' : 'bulleted_list',
          content: { items } satisfies ListContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));
      }
      continue;
    }

    // Blank line: skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Text block: collect consecutive non-empty, non-heading, non-list lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^\s*[-*]\s/.test(lines[i]) &&
      !/^\s*\d+[.)]\s/.test(lines[i])
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }

    const paraText = paraLines.join(' ').trim();
    if (paraText) {
      nodes.push(createNode({
        type: 'text_block',
        content: { text: paraText } satisfies TextBlockContent,
        source: 'imported',
        actorId: SYSTEM_ACTOR.id,
        actorName: SYSTEM_ACTOR.name,
      }));
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Plain text parsing
// ---------------------------------------------------------------------------

function parsePlainText(text: string): CanvasNode[] {
  const nodes: CanvasNode[] = [];

  // Split on double newlines into blocks
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    const firstLine = lines[0].trim();

    // Heuristic heading detection:
    // - Short line (< 100 chars) that is ALL CAPS
    // - Short line starting with a number followed by a dot/colon
    // - Short line that ends with a colon
    const isHeading = firstLine.length > 0 && firstLine.length < 100 && (
      (firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine) && firstLine.length < 80) ||
      /^\d+[.):]/.test(firstLine) ||
      (firstLine.endsWith(':') && firstLine.length < 80)
    );

    if (isHeading && lines.length === 1) {
      // Standalone heading line
      const headingText = firstLine.replace(/:$/, '').trim();
      if (headingText) {
        // Infer heading level: numbered → 2, all-caps → 1, otherwise → 2
        const level: 1 | 2 | 3 = (firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine))
          ? 1
          : /^\d+[.):]/.test(firstLine) ? 2 : 2;

        nodes.push(createNode({
          type: 'heading',
          content: { level, text: headingText } satisfies HeadingContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));
      }
      continue;
    }

    if (isHeading && lines.length > 1) {
      // First line is heading, rest is body
      const headingText = firstLine.replace(/:$/, '').trim();
      const level: 1 | 2 | 3 = (firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine))
        ? 1
        : /^\d+[.):]/.test(firstLine) ? 2 : 2;

      if (headingText) {
        nodes.push(createNode({
          type: 'heading',
          content: { level, text: headingText } satisfies HeadingContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));
      }

      // Process remaining lines as body
      const bodyLines = lines.slice(1);
      const bodyNodes = parseBodyLines(bodyLines);
      nodes.push(...bodyNodes);
      continue;
    }

    // Check if the block is a list
    const listLines = lines.filter((l) => /^\s*[-•*]\s|^\s*\d+[.)]\s/.test(l));
    if (listLines.length > lines.length * 0.5 && listLines.length >= 2) {
      const items: Array<{ text: string; indent_level: number }> = [];
      const isNumbered = /^\s*\d+[.)]\s/.test(listLines[0]);

      for (const l of lines) {
        if (/^\s*[-•*]\s|^\s*\d+[.)]\s/.test(l)) {
          const indentMatch = l.match(/^(\s*)/);
          const indentLevel = Math.floor((indentMatch?.[1].length ?? 0) / 2);
          const itemText = l.replace(/^\s*[-•*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim();
          if (itemText) {
            items.push({ text: itemText, indent_level: indentLevel });
          }
        }
      }

      if (items.length > 0) {
        nodes.push(createNode({
          type: isNumbered ? 'numbered_list' : 'bulleted_list',
          content: { items } satisfies ListContent,
          source: 'imported',
          actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name,
        }));
      }
      continue;
    }

    // Regular text block
    const paraText = lines.map((l) => l.trim()).join(' ').trim();
    if (paraText) {
      nodes.push(createNode({
        type: 'text_block',
        content: { text: paraText } satisfies TextBlockContent,
        source: 'imported',
        actorId: SYSTEM_ACTOR.id,
        actorName: SYSTEM_ACTOR.name,
      }));
    }
  }

  return nodes;
}

/**
 * Parse body lines within a block (after extracting a heading).
 * Detects lists or collapses into a text block.
 */
function parseBodyLines(lines: string[]): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);

  if (trimmed.length === 0) return nodes;

  // Check if they form a list
  const listLines = trimmed.filter((l) => /^[-•*]\s|^\d+[.)]\s/.test(l));
  if (listLines.length > trimmed.length * 0.5 && listLines.length >= 2) {
    const items: Array<{ text: string; indent_level: number }> = [];
    const isNumbered = /^\d+[.)]\s/.test(listLines[0]);

    for (const l of trimmed) {
      if (/^[-•*]\s|^\d+[.)]\s/.test(l)) {
        const itemText = l.replace(/^[-•*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
        if (itemText) {
          items.push({ text: itemText, indent_level: 0 });
        }
      }
    }

    if (items.length > 0) {
      nodes.push(createNode({
        type: isNumbered ? 'numbered_list' : 'bulleted_list',
        content: { items } satisfies ListContent,
        source: 'imported',
        actorId: SYSTEM_ACTOR.id,
        actorName: SYSTEM_ACTOR.name,
      }));
      return nodes;
    }
  }

  // Otherwise, join as text block
  const text = trimmed.join(' ').trim();
  if (text) {
    nodes.push(createNode({
      type: 'text_block',
      content: { text } satisfies TextBlockContent,
      source: 'imported',
      actorId: SYSTEM_ACTOR.id,
      actorName: SYSTEM_ACTOR.name,
    }));
  }

  return nodes;
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
      if (currentGroup.length === 0) {
        currentHeading = null;
        currentLevel = 0;
      }
      currentGroup.push(node);
    }
  }

  flushGroup();

  // If we got a single atom with everything in it and the document has
  // many nodes, fall back to paragraph-level splitting
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
      return (node.content as ListContent).items.map((item) => item.text).join(' ');
    default: return '';
  }
}
