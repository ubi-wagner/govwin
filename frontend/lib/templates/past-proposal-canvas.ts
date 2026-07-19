/**
 * pastProposalToCanvas (#18) — build a v2 CanvasDocument from a past proposal's ordered
 * section atoms: ONE section per atom (its title → a heading, its prose → a body block).
 *
 * Why not reuse assembleArtifactCanvas? That path runs each section's content through
 * moldNodes(), which parses markdown/structured content and returns NOTHING for bare
 * prose — so a plain-text uploaded proposal collapses to a single empty section and its
 * structure is lost. Cocoon atoms are plain-text chunks, so we lay them out directly.
 * extractTemplateSkeleton() then strips the content and keeps the section skeleton.
 */
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';
import type { CanvasDocument, CanvasNode, CanvasSection } from '@/lib/types/canvas-document';

const node = (type: CanvasNode['type'], content: unknown): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  content: content as CanvasNode['content'],
  style: {} as CanvasNode['style'],
  provenance: { source: 'template' },
  history: [],
  library_eligible: false,
});

export function pastProposalToCanvas(
  atoms: Array<{ title: string | null; content: string | null }>,
  templateType?: string,
): CanvasDocument {
  const preset =
    (templateType === 'slide_deck' ? CANVAS_PRESETS.slide_cso
      : templateType === 'cost_volume' ? CANVAS_PRESETS.spreadsheet
      : CANVAS_PRESETS.custom) ?? CANVAS_PRESETS.custom;

  const sections: CanvasSection[] = atoms.map((a, i) => {
    const title = (a.title?.trim() || `Section ${i + 1}`).slice(0, 200);
    const nodes: CanvasNode[] = [node('heading', { level: 2, text: title })];
    if (a.content && a.content.trim()) nodes.push(node('text_block', { text: a.content.trim() }));
    return {
      id: crypto.randomUUID(),
      title,
      layout: { mode: 'flow' },
      groups: [{ id: crypto.randomUUID(), nodes }],
    };
  });

  return {
    version: 2,
    document_id: crypto.randomUUID(),
    canvas: preset,
    nodes: [],
    sections,
    metadata: {
      title: 'Past proposal', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted',
    },
  };
}
