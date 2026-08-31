'use client';

/**
 * THE SCOPE BAR — the assist panel as a function of what you selected.
 *
 * The right-hand bar has always acted on whatever it was handed, with no notion of level: a review
 * meant a section, a regenerate meant a section, and a customer looking at one figure had no way to
 * say so. Meanwhile `agent_task_queue` learned scope (mig 207) and `resolveScope` learned to
 * compute the ladder — so what was missing was the surface that lets a person choose a rung.
 *
 * THE ONE RULE THIS COMPONENT EXISTS TO ENFORCE: continuity. Opening the panel from a click in the
 * fluid document, from the section rail, or from a page thumbnail must say the SAME thing about the
 * same content — because all three resolve through `resolveScope`, not through three
 * surface-specific notions of "what is selected". A panel that disagrees with itself depending on
 * how it was opened teaches a customer not to trust it.
 *
 * Advisory only. Every action here queues a review or proposes a revision; none of them edits a
 * section, advances a stage, locks, or submits.
 */
import { useMemo, useState } from 'react';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { resolveScope, focusOf, type Scope, type ScopeLevel, type Selection } from '@/lib/canvas/scope';
import { fmtNum } from '@/lib/fmt';

/** What the caller can do at a given rung. Filtered per level below. */
export interface ScopeAction {
  id: string;
  label: string;
  hint: string;
  /** Rungs this action makes sense at. A "re-assemble from the library" at node level would be a
   *  lie — the assembler builds a SECTION out of atoms; there is no smaller unit it produces. */
  levels: ScopeLevel[];
  run: (scope: Scope, sel: Selection) => void | Promise<void>;
}

const LEVEL_LABEL: Record<ScopeLevel, string> = {
  node: 'Element', group: 'Group', section: 'Section', pages: 'Pages', document: 'Document',
};

const LEVEL_DOT: Record<ScopeLevel, string> = {
  node: '#0f9d8f', group: '#c2410c', section: '#6d5ef0', pages: '#2f6df6', document: '#475569',
};

interface Props {
  doc: CanvasDocument;
  /** What the surface says is selected. `{}` means the whole document — a real level, not "nothing". */
  selection: Selection;
  onSelectionChange: (sel: Selection) => void;
  /** node id → owning section, for a FLAT document (the assembled fluid proposal). */
  sectionOf?: Record<string, { id: string; title: string }>;
  actions: ScopeAction[];
  /** Disable every action (read-only, or one is already running). */
  busy?: boolean;
  className?: string;
}

/** The selection that re-focuses the ladder on a given rung. */
function selectionForScope(scope: Scope): Selection {
  switch (scope.level) {
    case 'node': return { nodeId: scope.id };
    case 'group': return { groupId: scope.id };
    case 'section': return { sectionId: scope.id };
    case 'pages': return scope.pages ? { pageRange: { ...scope.pages } } : {};
    default: return {};
  }
}

export function ScopeBar({
  doc, selection, onSelectionChange, sectionOf, actions, busy = false, className = '',
}: Props) {
  const ladder = useMemo(
    () => resolveScope(doc, selection, sectionOf ? { sectionOf } : {}),
    [doc, selection, sectionOf],
  );
  const focus = ladder.length ? focusOf(ladder) : null;
  const totalPages = useMemo(() => {
    const d = ladder.find((s) => s.level === 'document');
    return d?.pages?.end ?? 1;
  }, [ladder]);

  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);

  if (!focus) return null;

  const available = actions.filter((a) => a.levels.includes(focus.level));

  return (
    <div className={`rounded-lg border border-gray-200 bg-white ${className}`}>
      {/* ── The ladder, innermost first. Clicking a rung WIDENS or NARROWS the focus. ──────────
          Shown as a breadcrumb rather than a dropdown because the containment relationship is the
          point: a person needs to see that this element sits in this group, in this section. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3 py-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Scope</span>
        {[...ladder].reverse().map((s, i, arr) => (
          <span key={`${s.level}:${s.id}`} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelectionChange(selectionForScope(s))}
              aria-current={s.level === focus.level ? 'true' : undefined}
              title={`${LEVEL_LABEL[s.level]} · ${s.label}`}
              className={`inline-flex max-w-[13rem] items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-xs transition-colors ${
                s.level === focus.level
                  ? 'border-transparent text-white'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
              style={s.level === focus.level ? { backgroundColor: LEVEL_DOT[s.level] } : undefined}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.level === focus.level ? '#fff' : LEVEL_DOT[s.level], opacity: s.level === focus.level ? 1 : 0.6 }}
              />
              <span className="truncate">{s.level === 'document' ? 'Document' : s.label}</span>
            </button>
            {i < arr.length - 1 && <span className="text-gray-300">›</span>}
          </span>
        ))}
      </div>

      {/* ── What this scope IS, in numbers the rest of the product agrees with ────────────────
          Pages come from the same `paginate` the compliance gate reads, so a page-scoped review and
          a page-limit violation are talking about the same page. Characters from the same counter
          the character budget uses. Atoms from the group/section provenance. */}
      <dl className="grid grid-cols-3 gap-px border-b border-gray-100 bg-gray-100 text-center">
        <div className="bg-white px-2 py-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">Blocks</dt>
          <dd className="text-sm font-semibold tabular-nums text-gray-800">{focus.nodes.length}</dd>
        </div>
        <div className="bg-white px-2 py-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">Pages</dt>
          <dd className="text-sm font-semibold tabular-nums text-gray-800">
            {focus.pages ? (focus.pages.start === focus.pages.end ? focus.pages.start : `${focus.pages.start}–${focus.pages.end}`) : '—'}
          </dd>
        </div>
        <div className="bg-white px-2 py-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">Characters</dt>
          <dd className="text-sm font-semibold tabular-nums text-gray-800">{fmtNum(focus.characters)}</dd>
        </div>
      </dl>

      {focus.atomRefs.length > 0 && (
        <p className="border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
          From {focus.atomRefs.length} library atom{focus.atomRefs.length === 1 ? '' : 's'}
        </p>
      )}

      {/* ── A page range, the unit the AGENCY addresses ────────────────────────────────────────
          Offered only on a document that HAS more than one page: on a single-page document every
          range is the whole thing, and a control whose only outcome is the one already available
          is noise. */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Pages</span>
          <input
            type="number" min={1} max={totalPages} value={rangeStart}
            onChange={(e) => setRangeStart(Math.min(totalPages, Math.max(1, Number(e.target.value) || 1)))}
            className="w-14 rounded border border-gray-200 px-1.5 py-0.5 text-xs tabular-nums"
            aria-label="First page"
          />
          <span className="text-gray-400">–</span>
          <input
            type="number" min={1} max={totalPages} value={rangeEnd}
            onChange={(e) => setRangeEnd(Math.min(totalPages, Math.max(1, Number(e.target.value) || 1)))}
            className="w-14 rounded border border-gray-200 px-1.5 py-0.5 text-xs tabular-nums"
            aria-label="Last page"
          />
          <button
            type="button"
            // Normalised here rather than refused: a person who types 5 then 2 means pages 2–5, and
            // rejecting that would be pedantry. The API still validates independently.
            onClick={() => onSelectionChange({ pageRange: {
              start: Math.min(rangeStart, rangeEnd), end: Math.max(rangeStart, rangeEnd),
            } })}
            className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:border-gray-300"
          >
            Focus
          </button>
          <span className="ml-auto text-[11px] text-gray-400 tabular-nums">of {totalPages}</span>
        </div>
      )}

      {/* ── The actions this rung supports ────────────────────────────────────────────────────
          Filtered, not disabled. A greyed-out "Assemble from library" on a single figure invites a
          person to wonder what they did wrong; an absent one says the truth, which is that the
          assembler builds sections. */}
      <div className="flex flex-col gap-1 p-2">
        {available.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-gray-400">
            No assist actions at {LEVEL_LABEL[focus.level].toLowerCase()} level.
          </p>
        ) : available.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => a.run(focus, selectionForScope(focus))}
            title={a.hint}
            className="flex w-full items-center justify-between rounded border border-gray-200 px-2.5 py-1.5 text-left text-xs text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{a.label}</span>
            <span className="text-[10px] uppercase tracking-wide text-gray-400">{LEVEL_LABEL[focus.level]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
