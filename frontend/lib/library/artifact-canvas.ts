/**
 * Pure builders that turn our house content into native-format CanvasDocuments —
 * doc (letter), sheet (spreadsheet), etc. IO-free so they're unit-testable;
 * house-artifacts.ts (which does the createAtom writes) re-exports them.
 *
 *     doc → .docx · sheet → .xlsx · deck → .pptx · pdf → .pdf   (ARTIFACT_FORMAT)
 */
import {
  CANVAS_PRESETS,
  type CanvasDocument, type CanvasNode, type CanvasSection, type TableContent,
} from '@/lib/types/canvas-document';
import type { ExportFormat } from '@/lib/export/artifact-export';

/** The FORM axis of the taxonomy (docs/LIBRARY_AND_VAULTS_DESIGN.md §3). */
export type ArtifactForm = 'doc' | 'ppt' | 'pdf' | 'sheet';

/** Native file FORMAT per form: form → exported file. */
export const ARTIFACT_FORMAT: Record<ArtifactForm, ExportFormat> = {
  doc: 'docx',
  ppt: 'pptx',
  pdf: 'pdf',
  sheet: 'xlsx',
};

export interface Section { title: string; body: string; }

const node = (type: CanvasNode['type'], content: unknown): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  content: content as CanvasNode['content'],
  style: {} as CanvasNode['style'],
  provenance: { source: 'template' },
  history: [],
  library_eligible: false,
});

function baseDoc(title: string, preset: string, sections: CanvasSection[]): CanvasDocument {
  const canvas = CANVAS_PRESETS[preset] ?? CANVAS_PRESETS.custom;
  return {
    version: 2,
    document_id: crypto.randomUUID(),
    canvas,
    nodes: [],
    sections,
    metadata: {
      title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted',
    },
  } as CanvasDocument;
}

/** A prose document (Terms, email template) → a letter-format CanvasDocument. */
export function sectionsToCanvasDoc(title: string, sections: Section[]): CanvasDocument {
  const canvasSections: CanvasSection[] = sections.map((s) => {
    const nodes: CanvasNode[] = [node('heading', { level: 2, text: s.title })];
    if (s.body) nodes.push(node('text_block', { text: s.body }));
    return { id: crypto.randomUUID(), title: s.title, layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes }] };
  });
  return baseDoc(title, 'custom', canvasSections);
}

/** A tabular artifact (the expert-time calendar) → a spreadsheet CanvasDocument with
 *  one table node (which the xlsx exporter turns into a worksheet). */
export function tableToCanvasSheet(title: string, headers: string[], rows: string[][], sheetName?: string): CanvasDocument {
  const table: TableContent = { headers, rows, sheet_name: sheetName ?? title.slice(0, 28) };
  const section: CanvasSection = {
    id: crypto.randomUUID(), title, layout: { mode: 'flow' },
    groups: [{ id: crypto.randomUUID(), nodes: [node('heading', { level: 2, text: title }), node('table', table)] }],
  };
  return baseDoc(title, 'spreadsheet', [section]);
}

/** Flatten a CanvasDocument's section nodes into the flat node list an atom stores. */
export function flattenNodes(doc: CanvasDocument): CanvasNode[] {
  const out: CanvasNode[] = [...(doc.nodes ?? [])];
  for (const s of doc.sections ?? []) for (const g of s.groups ?? []) out.push(...(g.nodes ?? []));
  return out;
}
