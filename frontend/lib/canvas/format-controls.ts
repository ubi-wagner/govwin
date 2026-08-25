/**
 * Which formatting controls apply to a given node type — the model behind the
 * canvas editor's context-aware "ribbon" drawer (NodeFormatControls). Pure so it
 * can be unit-tested and shared by the toolbar + the side drawer.
 *
 * Four control groups, mirroring Word/PowerPoint's ribbon tabs:
 *   text    — run styling (font/size/B/I/U/S/highlight/color/align)
 *   box     — the Shape-Format tab: fill(+opacity), border(color/width/style/radius), opacity, rotation, shadow
 *   arrange — free placement: position x/y/w/h + text wrap (does NOT snap to margins)
 *   element — the one type-specific control (shape kind, callout variant, chart type, …)
 */
import type { NodeType, ShapeKind } from '@/lib/types/canvas-document';

export type ElementKind =
  | 'shape' | 'callout' | 'chart' | 'divider' | 'code' | 'signature' | 'equation' | 'video'
  | 'textbox' | 'blockquote' | 'heading' | 'list' | null;

export interface FormatCaps {
  /** run styling applies (the node bears text) */
  text: boolean;
  /** the box / shape look applies (fill · border · opacity · rotation · shadow) */
  box: boolean;
  /** free placement applies (position + wrap) */
  arrange: boolean;
  /** the single type-specific control, if any */
  element: ElementKind;
}

// Text-bearing nodes carry run styling. (image/table/chart/divider/video/page_break/
// spacer/toc do not — their content isn't a styled run.)
const TEXT_RUN = new Set<NodeType>([
  'heading', 'text_block', 'bulleted_list', 'numbered_list', 'caption', 'footnote',
  'url', 'text_box', 'callout', 'blockquote', 'shape', 'code_block', 'equation', 'signature',
]);
// Box-look nodes carry fill/border/opacity/rotation/shadow (the Shape-Format tab).
const BOX = new Set<NodeType>(['shape', 'text_box', 'callout', 'image', 'chart', 'video']);
// Free-placement nodes (content boxes / shapes / floating figures that don't snap to margins).
const ARRANGE = new Set<NodeType>(['shape', 'text_box', 'image', 'chart', 'video']);

// Node types whose content is a single text/code field a prose library atom can
// replace WITHOUT destroying the node's shape. "Replace from Library" is hidden for
// every other type (image/table/chart/list/…) so a swap can never corrupt a node.
const REPLACEABLE_FROM_LIBRARY = new Set<NodeType>([
  'text_block', 'heading', 'blockquote', 'callout', 'text_box', 'caption', 'footnote', 'code_block',
]);

/** Whether "Replace from Library" (prose swap) is safe for this node type. */
export function canReplaceFromLibrary(type: NodeType): boolean {
  return REPLACEABLE_FROM_LIBRARY.has(type);
}

/** Resolve the control groups + the one element-specific control for a node type. */
export function formatCapabilities(type: NodeType): FormatCaps {
  const element: ElementKind =
    type === 'shape' ? 'shape'
      : type === 'callout' ? 'callout'
        : type === 'chart' ? 'chart'
          : type === 'divider' ? 'divider'
            : type === 'code_block' ? 'code'
              : type === 'signature' ? 'signature'
                : type === 'equation' ? 'equation'
                  : type === 'video' ? 'video'
                    : type === 'text_box' ? 'textbox'
                      : type === 'blockquote' ? 'blockquote'
                        : type === 'heading' ? 'heading'
                          : (type === 'bulleted_list' || type === 'numbered_list') ? 'list'
                            : null;
  return { text: TEXT_RUN.has(type), box: BOX.has(type), arrange: ARRANGE.has(type), element };
}

// ── Option lists for the drawer's dropdowns / pickers ──
export const SHAPE_KINDS: ReadonlyArray<{ value: ShapeKind; label: string; glyph: string }> = [
  { value: 'rectangle', label: 'Rectangle', glyph: '▭' },
  { value: 'rounded_rectangle', label: 'Rounded', glyph: '▢' },
  { value: 'ellipse', label: 'Ellipse', glyph: '◯' },
  { value: 'triangle', label: 'Triangle', glyph: '△' },
  { value: 'diamond', label: 'Diamond', glyph: '◇' },
  { value: 'star', label: 'Star', glyph: '★' },
  { value: 'arrow', label: 'Arrow', glyph: '➜' },
  { value: 'line', label: 'Line', glyph: '─' },
  { value: 'callout_bubble', label: 'Bubble', glyph: '💬' },
];
export const CALLOUT_VARIANTS = ['info', 'warning', 'tip', 'success', 'note'] as const;
export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'doughnut', 'scatter'] as const;
export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'none'] as const;
export const WRAP_MODES = ['inline', 'float', 'front', 'behind'] as const;
export const FONT_FAMILIES = ['Times New Roman', 'Arial', 'Calibri', 'Georgia', 'Helvetica', 'Courier New'] as const;

/** The extended element types insertable from the ribbon's Elements group. */
export const INSERT_ELEMENTS: ReadonlyArray<{ type: NodeType; label: string; icon: string }> = [
  { type: 'shape', label: 'Shape', icon: '▭' },
  { type: 'text_box', label: 'Text box', icon: '⬚' },
  { type: 'callout', label: 'Callout', icon: '❗' },
  { type: 'chart', label: 'Chart', icon: '📊' },
  { type: 'divider', label: 'Divider', icon: '―' },
  { type: 'code_block', label: 'Code', icon: '</>' },
  { type: 'blockquote', label: 'Quote', icon: '❝' },
  { type: 'equation', label: 'Equation', icon: '∑' },
  { type: 'video', label: 'Video', icon: '▶' },
  { type: 'signature', label: 'Signature', icon: '✍' },
];

/** The properties-panel tabs, in the order they render. */
export type PanelTab = 'compliance' | 'node' | 'add' | 'history' | 'settings' | 'review';

/**
 * Should selecting a node move the properties panel to the `Node` tab?
 *
 * The panel opens on `compliance` and every shape, arrange and layering control lives under `Node`,
 * so the full ribbon sat two steps from the page: select, then switch tab. The controls were all
 * built — they just were not where a person looks after clicking something.
 *
 * THE GUARD IS THE POINT. Jumping on every selection would hijack a deliberate choice: inserting
 * from the `Add` tab selects the node it just inserted, so an unconditional rule throws the author
 * out of the insert panel on every single insert — worse than the friction it fixes. Moving off
 * `compliance` is an expressed preference; sitting on the untouched default is not. So only the
 * default gives way, and only when the selection actually CHANGES (re-selecting the same node after
 * deliberately returning to `compliance` must not yank the tab back).
 *
 * Extracted as a predicate rather than left inline because this project's vitest runs in the `node`
 * environment with no jsdom — a rule buried in a component effect could only have been verified by
 * hand, and "it typechecks" is not evidence about behaviour.
 */
export function shouldFocusNodeTab(
  prevSelectedId: string | null,
  nextSelectedId: string | null,
  activeTab: PanelTab,
): boolean {
  if (!nextSelectedId) return false;                 // nothing selected → nothing to format
  if (nextSelectedId === prevSelectedId) return false; // same node → not a new selection
  return activeTab === 'compliance';                 // only the untouched default gives way
}
