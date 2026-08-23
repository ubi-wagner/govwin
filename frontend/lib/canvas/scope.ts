/**
 * SCOPE — the ladder a selection sits on, and the one answer two surfaces share.
 *
 * THE GROUNDING. The canvas already paints structure as overlays (`components/canvas/
 * canvas-overlays.tsx`), but those are CSS chips keyed off `data-node-id`: they SHOW boundaries and
 * compute nothing. Nothing in the product could answer "what encloses this node", so two features
 * were stuck at fixed granularity:
 *
 *   · the right-hand assist bar acts on whatever it was handed, with no notion of level
 *   · color-team review is hard-wired to SECTION — `agent_task_queue` carries `proposal_id` +
 *     `section_id`, one task per section. A reviewer cannot be pointed at one figure, one group,
 *     or a page range, because there is no way to say what those are.
 *
 * This computes the ladder: given a selection, what contains it at every level, and what content,
 * span and provenance each level holds. One resolver, so the assist bar and the review request can
 * never disagree about what "this section" means.
 *
 * THE LEVELS, and why each earns a place:
 *
 *   node      one primitive. The unit of an inline edit.
 *   group     a run from one library atom (`atom_ref`) — the unit of PROVENANCE and of cohesion
 *             (`keep_together`). Invisible in the overlay bar today, which is its own finding.
 *   section   the unit the compliance matrix and the mold address (`section_type`).
 *   pages     the unit the AGENCY addresses. Page ranges come from `paginate()`, which is the same
 *             ruler the compliance gate enforces — so a page-scoped review and a page-limit
 *             violation are talking about the same page.
 *   document  the whole artifact.
 *
 * Pure and framework-free: no React, no DB. The UI reads it to decide what the right bar offers;
 * the review request reads it to decide what to send. Nothing here renders or persists.
 */
import {
  paginate, countCharacters, sectionPageSpan, docNodes,
  type CanvasDocument, type CanvasGroup, type CanvasNode, type CanvasSection,
} from '@/lib/types/canvas-document';

export type ScopeLevel = 'node' | 'group' | 'section' | 'pages' | 'document';

export interface Scope {
  level: ScopeLevel;
  /** Stable identifier at this level — a node/group/section id, a page range, or the document id. */
  id: string;
  /** What a person should see in the bar's breadcrumb. */
  label: string;
  /** The content this scope covers, in document order. */
  nodes: CanvasNode[];
  /** Inclusive page range, by the same ruler the compliance gate uses. Null when unpaginated. */
  pages: { start: number; end: number } | null;
  characters: number;
  /** Library atoms this scope was assembled from — the provenance the harvest loop needs. */
  atomRefs: string[];
}

/** What a caller selected. Exactly one field is meaningful; the resolver works out the rest. */
export interface Selection {
  nodeId?: string;
  groupId?: string;
  sectionId?: string;
  /** A page range the reader dragged out, 1-based and inclusive. */
  pageRange?: { start: number; end: number };
}

interface Located {
  node?: CanvasNode;
  group?: CanvasGroup;
  section?: CanvasSection;
}

const sectionsOf = (doc: CanvasDocument): CanvasSection[] => (doc.sections ?? []) as CanvasSection[];

/** Walk the containment tree once, finding whichever of node/group/section the selection names. */
function locate(doc: CanvasDocument, sel: Selection): Located {
  for (const section of sectionsOf(doc)) {
    for (const group of section.groups ?? []) {
      if (sel.groupId && group.id === sel.groupId) return { group, section };
      for (const node of group.nodes ?? []) {
        if (sel.nodeId && node.id === sel.nodeId) return { node, group, section };
      }
    }
    if (sel.sectionId && section.id === sel.sectionId) return { section };
  }
  // A flat document (no sections) still has nodes.
  if (sel.nodeId) {
    const node = (doc.nodes ?? []).find((n) => n.id === sel.nodeId);
    if (node) return { node };
  }
  return {};
}

const scopeOf = (
  level: ScopeLevel, id: string, label: string, nodes: CanvasNode[],
  pages: Scope['pages'], atomRefs: string[],
): Scope => ({ level, id, label, nodes, pages, characters: countCharacters(nodes), atomRefs });

/**
 * Resolve a selection into the full ladder, innermost first.
 *
 * Always ends at `document`, so a caller can offer "widen to the whole volume" without a special
 * case. Levels that do not apply are simply absent — a node in a flat document has no group or
 * section above it, and saying so honestly is better than synthesising an empty one.
 */
export function resolveScope(doc: CanvasDocument, sel: Selection): Scope[] {
  const layout = paginate(doc);
  const canvas = doc.canvas;
  const { node, group, section } = locate(doc, sel);
  const ladder: Scope[] = [];

  // Page range for a section, from the SAME pagination the compliance gate reads.
  const pagesForSection = (s: CanvasSection): Scope['pages'] => {
    const info = layout.perSection.find((p) => p.id === s.id);
    return info ? { start: info.startPage, end: info.endPage } : null;
  };

  if (node) {
    ladder.push(scopeOf('node', node.id, node.type, [node],
      section ? pagesForSection(section) : null,
      group?.atom_ref ? [group.atom_ref] : []));
  }

  if (group) {
    ladder.push(scopeOf('group', group.id, group.label ?? 'Group', group.nodes ?? [],
      section ? pagesForSection(section) : null,
      group.atom_ref ? [group.atom_ref] : []));
  }

  if (section) {
    const nodes = (section.groups ?? []).flatMap((g) => g.nodes ?? []);
    ladder.push(scopeOf('section', section.id, section.title ?? 'Section', nodes,
      pagesForSection(section), section.source_atom_ids ?? []));
  }

  // An explicit page range resolves to whatever falls inside it — the unit the AGENCY addresses.
  if (sel.pageRange) {
    const { start, end } = sel.pageRange;
    const inRange = layout.perSection.filter((p) => p.endPage >= start && p.startPage <= end);
    const ids = new Set(inRange.map((p) => p.id));
    const covered = sectionsOf(doc).filter((s) => ids.has(s.id));
    ladder.push(scopeOf('pages', `p${start}-${end}`,
      start === end ? `Page ${start}` : `Pages ${start}–${end}`,
      covered.flatMap((s) => (s.groups ?? []).flatMap((g) => g.nodes ?? [])),
      { start, end },
      covered.flatMap((s) => s.source_atom_ids ?? [])));
  }

  ladder.push(scopeOf('document', String(doc.document_id ?? 'document'), 'Whole document',
    docNodes(doc), layout.totalPages ? { start: 1, end: layout.totalPages } : null,
    sectionsOf(doc).flatMap((s) => s.source_atom_ids ?? [])));

  return ladder;
}

/** The innermost scope — what the right bar acts on by default. */
export const focusOf = (ladder: Scope[]): Scope => ladder[0];

/**
 * Which review scopes this document supports.
 *
 * Colour-team review is queued per section today. This reports what COULD be addressed, so a caller
 * can offer the wider or narrower target rather than assuming section is the only unit. A document
 * with no sections supports only `document`, and saying so prevents offering a control that would
 * queue nothing.
 */
export function reviewableScopes(doc: CanvasDocument): ScopeLevel[] {
  const out: ScopeLevel[] = ['document'];
  const sections = sectionsOf(doc);
  if (sections.length) out.unshift('section');
  if (sections.some((s) => (s.groups ?? []).length)) out.unshift('group');
  if (paginate(doc).totalPages > 1) out.push('pages');
  return out;
}

/**
 * Page span of an arbitrary node run, for a scope the pagination does not name directly (a group,
 * or a selection spanning groups). Uses the intra-segment ruler, so it is bounded by — and
 * consistent with — the document fold.
 */
export function spanOfNodes(nodes: CanvasNode[], canvas: CanvasDocument['canvas']): number {
  return nodes.length ? sectionPageSpan(nodes, canvas) : 0;
}
