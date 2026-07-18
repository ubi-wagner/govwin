/**
 * Template extraction (docs/CANVAS_GEOMETRY_REDESIGN.md §5d) — turn an ingested
 * proposal into a reusable SKELETON template in one pass, when the admin declares
 * it "a sound template."
 *
 * Extraction keeps the FRAME + the SECTION SKELETON and strips the specific
 * content: the floorplan (`CanvasRules`), the ordered section titles/headings
 * (with their styling), each section's layout intent (flow / keep_together /
 * break_before) and page budget — but not the prose, figures, or tables. The
 * result is a v2 CanvasDocument of headings + muted placeholders that
 * "new document from template + library" drafts into.
 *
 * Pure — the endpoint persists the result to `document_templates`.
 */
import { toSections } from '@/lib/types/canvas-document';
import type { CanvasDocument, CanvasNode, CanvasGroup, CanvasSection, HeadingContent } from '@/lib/types/canvas-document';

const mk = (type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  content: content as CanvasNode['content'],
  style: style as CanvasNode['style'],
  provenance: { source: 'template' },
  history: [],
  library_eligible: false,
});
const clone = (n: CanvasNode): CanvasNode => ({ ...n, id: crypto.randomUUID(), provenance: { source: 'template' }, history: [] });

/** The muscle's content class — what kind of atom fills this group slot. */
type SlotKind = 'figure' | 'table' | 'list' | 'narrative';
const slotKindOf = (g: CanvasGroup): SlotKind => {
  const types = new Set((g.nodes ?? []).map((n) => n.type));
  if (types.has('image')) return 'figure';
  if (types.has('table')) return 'table';
  if (types.has('bulleted_list') || types.has('numbered_list')) return 'list';
  return 'narrative';
};
const SLOT: Record<SlotKind, { label: string; placeholder: string }> = {
  figure: { label: 'Figure', placeholder: '[Figure slot — insert an image atom]' },
  table: { label: 'Table', placeholder: '[Table slot — insert a table atom]' },
  list: { label: 'List', placeholder: '[List slot — insert list items]' },
  narrative: { label: 'Narrative', placeholder: '[Draft prose — ground on the library atoms tagged for this section]' },
};

export interface SkeletonSlot { label: string; kind: SlotKind; keepTogether: boolean }
export interface SkeletonSection {
  title: string;
  sectionType?: string;
  pageBudget?: number;
  mode: 'flow' | 'keep_together' | 'pinned';
  /** the muscles — the ordered group slots this organ carries. */
  slots: SkeletonSlot[];
}

export interface ExtractOptions {
  /** Per-section page budgets (by ordinal) the admin sets while confirming the template. */
  sectionBudgets?: Record<number, number>;
}

/**
 * Extract a skeleton template from a (v1 or v2) CanvasDocument. The result keeps
 * the ANATOMY — frame (skeleton) → sections (organs) → group slots (muscles) →
 * heading/style (skin) — and strips the specific content (prose/figures/tables).
 * Returns the skeleton doc plus a per-section summary (with its muscle slots) for
 * the admin to review/name.
 */
export function extractTemplateSkeleton(
  doc: CanvasDocument,
  opts: ExtractOptions = {},
): { skeleton: CanvasDocument; sections: SkeletonSection[] } {
  const src = toSections(doc);
  const summary: SkeletonSection[] = [];

  const sections: CanvasSection[] = src.map((s, i) => {
    const firstHeading = s.groups.flatMap((g) => g.nodes).find((n) => n.type === 'heading');
    const title = s.title ?? (firstHeading ? (firstHeading.content as HeadingContent).text : `Section ${i + 1}`);
    const budget = opts.sectionBudgets?.[i] ?? s.layout.page_budget;
    const mode = s.layout.mode;
    const slots: SkeletonSlot[] = [];

    // Preserve each GROUP (muscle): keep its headings (skin/label) + a single
    // typed slot placeholder for the stripped body; keep_together + label ride along.
    const groups: CanvasGroup[] = [];
    for (const g of s.groups ?? []) {
      const headings = (g.nodes ?? []).filter((n) => n.type === 'heading').map(clone);
      const body = (g.nodes ?? []).filter((n) => n.type !== 'heading');
      const nodes: CanvasNode[] = [...headings];
      if (body.length > 0) {
        const kind = slotKindOf(g);
        nodes.push(mk('text_block', { text: SLOT[kind].placeholder }, { color: '#94a3b8', style: 'italic' }));
        slots.push({ label: g.label ?? SLOT[kind].label, kind, keepTogether: !!g.keep_together });
      }
      if (nodes.length === 0) continue; // fully empty group → drop
      groups.push({
        id: crypto.randomUUID(),
        ...(g.label ? { label: g.label } : {}),
        ...(g.keep_together ? { keep_together: true } : {}),
        nodes,
      });
    }
    // Guarantee the organ has its heading (label) even if the source had none.
    if (!groups.some((g) => g.nodes.some((n) => n.type === 'heading'))) {
      groups.unshift({ id: crypto.randomUUID(), nodes: [mk('heading', { level: 2, text: title })] });
    }

    summary.push({ title, sectionType: s.section_type, pageBudget: budget, mode, slots });
    return {
      id: crypto.randomUUID(),
      title,
      ...(s.section_type ? { section_type: s.section_type } : {}),
      layout: {
        mode,
        ...(s.layout.break_before ? { break_before: true } : {}),
        ...(budget ? { page_budget: budget } : {}),
      },
      groups,
    };
  });

  const skeleton: CanvasDocument = {
    version: 2,
    document_id: crypto.randomUUID(),
    canvas: doc.canvas,
    nodes: [],
    sections,
    metadata: {
      title: doc.metadata?.title ?? 'Template',
      volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'empty',
    },
  };

  return { skeleton, sections: summary };
}
