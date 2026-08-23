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
  paginate, countCharacters, sectionPageSpan, docNodes, getNodeText, CANVAS_PRESETS,
  type CanvasDocument, type CanvasGroup, type CanvasNode, type CanvasRules, type CanvasSection,
} from '@/lib/types/canvas-document';
import { coerceJsonb } from '@/lib/jsonb';

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

  // A node's own page span, from the ruler's per-node record. Falls back to its section's range
  // only when the ruler has nothing to say — the node's own answer is always the truer one, and on
  // a FLAT document (which is every canvas the product stores) there is no section to fall back to.
  const pagesForNode = (nd: CanvasNode): Scope['pages'] => {
    const info = layout.perNode.find((p) => p.id === nd.id);
    return info ? { start: info.startPage, end: info.endPage } : null;
  };

  if (node) {
    ladder.push(scopeOf('node', node.id, node.type, [node],
      pagesForNode(node) ?? (section ? pagesForSection(section) : null),
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
  //
  // Selected NODE-WISE, not section-wise. Resolving through `perSection` looked right and was
  // wrong on every document the product stores: a flat canvas has no `sections`, so `toSections()`
  // invents them with `crypto.randomUUID()` ids that match nothing and are different on the next
  // call. The lookup found nothing, the range selected nothing, and it failed silently. `perNode`
  // is the same fold measured by the same pass, and it exists for every node on every shape.
  if (sel.pageRange) {
    const { start, end } = sel.pageRange;
    const inRange = new Set(
      layout.perNode.filter((p) => p.endPage >= start && p.startPage <= end).map((p) => p.id),
    );
    const covered = docNodes(doc).filter((nd) => inRange.has(nd.id));
    // Atom provenance for the range: the sections it touches, when the document names any.
    const touched = sectionsOf(doc).filter((s) => {
      const info = layout.perSection.find((p) => p.id === s.id);
      return !!info && info.endPage >= start && info.startPage <= end;
    });
    ladder.push(scopeOf('pages', `p${start}-${end}`,
      start === end ? `Page ${start}` : `Pages ${start}–${end}`,
      covered,
      { start, end },
      touched.flatMap((s) => s.source_atom_ids ?? [])));
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

/* ── THE DOCUMENT A SCOPE RESOLVES AGAINST ──────────────────────────────────────────────────────
 *
 * Not `assembleProposalDocument`, and the reason is a measured one rather than a preference.
 *
 * That function exists to RENDER: it flattens every section's nodes into one continuous list so the
 * proposal reads as one fluid document. Flattening is exactly right for reading and exactly wrong
 * for scoping — it discards the section boundaries and the group layer, so resolving against it,
 * a section scope found no section and a group scope found no group. Both then fell through to
 * `document`, and a request to review one figure queued a review of the entire proposal. Measured
 * live: `{groupId:'g-method'}` and `{sectionId:'sec-c'}` both stored `scope_level='document'`.
 *
 * So scoping gets its own assembly, which preserves what scoping addresses.
 */

/** A stored section, as `proposal_sections` holds it. */
export interface ScopeSectionInput {
  id: string;
  title: string | null;
  content: string | null | Record<string, unknown>;
}

/** Globally unique id for a node/group inside one section — the convention the fluid canvas
 *  already renders (`<sectionId>__<nodeId>`), so an id from that surface works unchanged. */
export const scopedId = (sectionId: string, localId: string) => `${sectionId}__${localId}`;

/**
 * Build the document a scope resolves against: every section preserved as a section, every group
 * preserved as a group, every id made unique.
 *
 * Re-keying is not cosmetic. `paginate()` reports one entry per node id, and `locate()` finds the
 * first match — two sections that both call a node `n-intro` would collide, and the second one
 * would be unreachable. The prefix is the same one assembly already uses, so the fluid surface's
 * ids need no translation and the per-section editor's raw ids need only `scopedId`.
 *
 * A section stored FLAT (which is all of them today) becomes one group holding its nodes: honest —
 * the content genuinely has no internal grouping yet — and it keeps group scoping working the day
 * the assembler starts writing real groups.
 */
export function buildScopeDocument(sections: ScopeSectionInput[]): CanvasDocument {
  let canvas: CanvasRules = CANVAS_PRESETS.letter_standard;
  const out: CanvasSection[] = [];

  for (const s of sections) {
    const parsed = coerceJsonb<CanvasDocument | null>(s.content, null);
    // Adopt a real narrative section's frame (margins/font), the same rule assembly uses — slides
    // and sheets are measured by different rulers and must not set the document's page geometry.
    if (parsed?.canvas && parsed.canvas.format !== 'spreadsheet' && !parsed.canvas.format?.startsWith('slide')) {
      canvas = parsed.canvas;
    }

    const groups: CanvasGroup[] = [];
    const atomIds: string[] = [];
    const stored = (parsed?.sections ?? []) as CanvasSection[];
    if (stored.length) {
      for (const sec of stored) {
        for (const g of sec.groups ?? []) {
          groups.push({
            ...g,
            id: scopedId(s.id, g.id),
            nodes: (g.nodes ?? []).map((n) => ({ ...n, id: scopedId(s.id, n.id) })),
          });
        }
        atomIds.push(...(sec.source_atom_ids ?? []));
      }
    } else {
      const nodes = (parsed?.nodes ?? []).map((n) => ({ ...n, id: scopedId(s.id, n.id) }));
      if (nodes.length) groups.push({ id: scopedId(s.id, 'g0'), nodes });
    }

    out.push({
      id: s.id,
      title: (s.title && s.title.trim()) || 'Untitled section',
      layout: { mode: 'flow' },
      groups,
      source_atom_ids: [...new Set(atomIds)],
    } as CanvasSection);
  }

  return {
    version: 2,
    document_id: 'proposal-scope',
    canvas,
    sections: out,
  } as unknown as CanvasDocument;
}

/* ── PERSISTENCE ────────────────────────────────────────────────────────────────────────────────
 *
 * Everything above is in-memory: a ladder computed from a document a surface is already holding.
 * What follows is the part that has to survive a round-trip through `agent_task_queue` and come
 * back matching, because the reviewer runs in a different process (and a different language) from
 * the surface that asked for it.
 */

/**
 * The scope, reduced to what a jsonb column can hold and a Python worker can read back.
 *
 * Deliberately NOT the whole `Scope` — nodes and character counts are derived, and storing derived
 * state guarantees it goes stale against the document it describes. This is the minimum needed to
 * re-resolve, and re-resolution is what keeps the stored scope honest after an edit.
 *
 * `section` and `document` carry no ref: the level plus the task's own `section_id` says it all.
 */
export interface ScopeRef {
  nodeId?: string;
  groupId?: string;
  pages?: { start: number; end: number };
}

/** The persisted ref for a scope, or null where the level alone is the whole address. */
export function scopeRefOf(scope: Scope): ScopeRef | null {
  switch (scope.level) {
    case 'node': return { nodeId: scope.id };
    case 'group': return { groupId: scope.id };
    case 'pages': return scope.pages ? { pages: { ...scope.pages } } : null;
    default: return null;
  }
}

/**
 * One queued review. The fields divide cleanly by who reads them: `sectionId` is for the
 * write-back, `scopeLevel`/`scopeRef` are for the queue row and the gate, `text`/`label` are for
 * the reviewer's prompt, and `pages`/`atomRefs` are for what the UI says about the finding.
 */
export interface ReviewTarget {
  /**
   * Where the finding LANDS. Never null: `fabric._post_section_recommendation` returns early
   * without one, so a target with no section produces no comment and no error — the worst
   * failure mode there is. A scope wider than one section files against the first it covers,
   * and `scopeRef` records what was really reviewed.
   */
  sectionId: string;
  scopeLevel: ScopeLevel;
  scopeRef: ScopeRef | null;
  label: string;
  /** The scope's OWN text, not its section's. Handing a node-scoped review the whole section
   *  reviews the section and makes the anchor a lie. */
  text: string;
  pages: { start: number; end: number } | null;
  atomRefs: string[];
  /**
   * Exactly which nodes were reviewed, in document order. Not persisted — node ids move when a
   * section is re-edited, and a stored list of them would rot into a claim about content that is
   * no longer there. Held in memory so the caller can map the scope back to its owning section
   * (the assembled document's `sectionOf`) and so a gate can say what a finding actually covers.
   */
  nodeIds: string[];
}

/** The reviewer's context window, mirroring the slice `requestAiReview` has always sent. */
const REVIEW_TEXT_LIMIT = 20000;

const textOf = (nodes: CanvasNode[]): string =>
  nodes.map((n) => getNodeText(n)).filter(Boolean).join('\n\n').trim();

/**
 * Turn a selection into the review tasks it should queue.
 *
 * Returns ONE target — a scope is a single thing to review, whatever its level. That is the change
 * from the section fan-out: `requestAiReview` queues N tasks because it was handed N sections, not
 * because a review is inherently per-section.
 *
 * Returns NOTHING when the scope has no reviewable text. A figure with no alt text gives a text
 * reviewer nothing to read, and queueing it spends the tenant's hourly agent budget to produce an
 * empty comment — the same budget whose exhaustion silently killed 36 of 68 reviews on this
 * database once already.
 *
 * `sectionIdFallback` exists because stored section canvases are FLAT: `proposal_sections.content`
 * holds `nodes` with no section wrapper (verified against the live schema), so a node scope
 * resolved against one has no enclosing `CanvasSection` to name. The caller knows which section it
 * loaded; the document does not.
 */
export function planReviewTargets(
  doc: CanvasDocument,
  sel: Selection,
  opts: {
    sectionIdFallback?: string;
    /**
     * Which section owns a given node — the assembled proposal document's `sectionOf`.
     *
     * This is how a scope resolved against the WHOLE proposal finds the section its finding
     * belongs in. The assembled document is flat (`nodes`, no `sections`), so the ladder cannot
     * name a section itself; but assembly re-keys every node as `<sectionId>__<nodeId>` and keeps
     * the map, which is a truer answer than any guess made from page ranges.
     */
    sectionOfNode?: (nodeId: string) => string | undefined;
  } = {},
): ReviewTarget[] {
  const ladder = resolveScope(doc, sel);
  if (!ladder.length) return [];
  const scope = focusOf(ladder);

  // A SELECTION THAT NAMED SOMETHING MUST RESOLVE TO IT.
  //
  // `resolveScope` always ends the ladder at `document`, so a caller can offer "widen to the whole
  // volume" without a special case. That is right for a UI and dangerous here: when nothing else
  // resolved, `document` is the innermost rung, and a request to review one figure became a request
  // to review the entire proposal. Measured live before this guard — `{groupId:'g-method'}` and
  // `{nodeId:'no-such-node'}` both queued `scope_level='document'` and returned 200. That is the
  // failure the input validation upstream exists to prevent, arriving from underneath it.
  //
  // Only an EMPTY selection means the document.
  const asked = sel.nodeId ? 'node' : sel.groupId ? 'group'
    : sel.sectionId ? 'section' : sel.pageRange ? 'pages' : 'document';
  if (scope.level !== asked) return [];

  const text = textOf(scope.nodes);
  if (!text) return [];

  // The section a finding is filed against, most-authoritative first:
  //   1. the ladder — the document names its own sections
  //   2. the caller's node→section map — the assembled proposal's own record
  //   3. the first section the scope's pages cover
  //   4. the caller's fallback — the section it loaded
  // A wider-than-section scope files against the first section it touches, with `scopeRef`
  // recording what was really reviewed.
  const firstNode = scope.nodes[0]?.id;
  const covered = sectionsOf(doc).find((s) =>
    scope.level === 'document' ? true
      : scope.pages ? overlapsPages(doc, s, scope.pages)
      : false);
  const sectionId = ladder.find((s) => s.level === 'section')?.id
    ?? (firstNode ? opts.sectionOfNode?.(firstNode) : undefined)
    ?? covered?.id
    ?? opts.sectionIdFallback;
  if (!sectionId) return [];

  return [{
    sectionId,
    scopeLevel: scope.level,
    scopeRef: scopeRefOf(scope),
    label: scope.label,
    text: text.slice(0, REVIEW_TEXT_LIMIT),
    pages: scope.pages,
    atomRefs: scope.atomRefs,
    nodeIds: scope.nodes.map((nd) => nd.id),
  }];
}

/** Does this section fall inside the page range, by the same fold the compliance gate reads? */
function overlapsPages(
  doc: CanvasDocument, section: CanvasSection, range: { start: number; end: number },
): boolean {
  const info = paginate(doc).perSection.find((p) => p.id === section.id);
  return !!info && info.endPage >= range.start && info.startPage <= range.end;
}
