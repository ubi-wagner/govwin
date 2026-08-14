/**
 * Prose (markdown) → CanvasDocument — the in-system importer that turns an authored markdown
 * draft into a section-structured `CanvasDocument` (the shape a `tenant_documents.canvas` holds).
 *
 * It is built on the SAME block parser the upload→atomize flow uses (`parseMarkdown` in
 * ./text-reader), so a pasted/uploaded markdown draft and a document imported this way produce
 * identical nodes and therefore decompose (decomposeAndIngest) into identical library atoms.
 *
 * Use this instead of hand-rolling a markdown converter: a product route that lets a tenant/admin
 * paste or upload a markdown draft as a new document should call `markdownToCanvasDocument`, and
 * offline seeds/examples (scripts/niloc) import it too — one canonical prose→canvas path.
 */
import { parseMarkdown } from './text-reader';
import type { CanvasDocument, CanvasNode, CanvasSection, CanvasRules, DocumentStatus } from '@/lib/types/canvas-document';

const LETTER: CanvasRules = {
  format: 'letter', width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: null, footer: null,
  font_default: { family: 'Times New Roman', size: 11 },
  line_spacing: 1.15, max_pages: null, max_slides: null,
};

export interface MarkdownImportOpts {
  title: string;
  /** actor id recorded as last_modified_by (defaults to the system import actor). */
  actorId?: string;
  /** override any canvas rule (format, margins, header, …). */
  canvas?: Partial<CanvasRules>;
  /** convenience: set a running footer template (e.g. 'ACME · Proprietary · {n} / {N}'). */
  footerTemplate?: string;
  status?: DocumentStatus;
  /** fixed timestamp (deterministic seeds); defaults to now. */
  createdAt?: string;
}

/** Group a flat node list into sections at each heading (a heading + the body that follows it). */
export function groupNodesIntoSections(nodes: CanvasNode[]): CanvasSection[] {
  const sections: CanvasSection[] = [];
  let cur: CanvasNode[] = [];
  let title: string | undefined;
  const flush = () => {
    if (cur.length) sections.push({ id: crypto.randomUUID(), title, layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes: cur }] });
  };
  for (const n of nodes) {
    if (n.type === 'heading') { flush(); cur = [n]; title = (n.content as { text?: string } | null)?.text; }
    else cur.push(n);
  }
  flush();
  return sections;
}

/** Turn a markdown/prose string into a v2 (section-layered) CanvasDocument. */
export function markdownToCanvasDocument(md: string, opts: MarkdownImportOpts): CanvasDocument {
  const sections = groupNodesIntoSections(parseMarkdown(md));
  const now = opts.createdAt ?? new Date().toISOString();
  const canvas: CanvasRules = {
    ...LETTER,
    ...(opts.canvas ?? {}),
    footer: opts.footerTemplate
      ? { template: opts.footerTemplate, height: 36, font: { family: 'Times New Roman', size: 9 } }
      : (opts.canvas?.footer ?? LETTER.footer),
  };
  return {
    version: 2,
    document_id: crypto.randomUUID(),
    canvas,
    nodes: [],            // v2: flat content lives under sections
    sections,
    metadata: {
      title: opts.title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: now, last_modified_at: now, last_modified_by: opts.actorId ?? 'system:import',
      version_number: 1, status: opts.status ?? 'ai_drafted',
    },
  };
}
