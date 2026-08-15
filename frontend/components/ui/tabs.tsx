'use client';

/**
 * Tabs — a small, dependency-free, accessible tab primitive (the repo rolls its
 * own UI; see components/ui/autocomplete.tsx). Used by the opportunity card to
 * reveal its "hidden" panels (origin / compliance). Supports a LOCKED tab — a
 * disabled tab with a lock affordance — modeling the stage-control lock pattern
 * (a panel the current stage/role can't open yet).
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef {
  key: string;
  label: ReactNode;
  content: ReactNode;
  /** Disabled + lock affordance (e.g. a stage-gated panel). Not selectable. */
  locked?: boolean;
  /** Plain disabled (not selectable), no lock affordance. */
  disabled?: boolean;
}

export function Tabs({
  tabs,
  initialKey,
  className = '',
  onChange,
}: {
  tabs: TabDef[];
  initialKey?: string;
  className?: string;
  /** Fires when the active tab changes (click or keyboard). The CC uses it to mark a tab "seen". */
  onChange?: (key: string) => void;
}) {
  const baseId = useId();
  const firstSelectable = tabs.find((t) => !t.locked && !t.disabled)?.key;
  const [active, setActive] = useState<string>(initialKey ?? firstSelectable ?? tabs[0]?.key ?? '');
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const select = (key: string) => { setActive(key); onChange?.(key); };

  // Roving keyboard nav (WAI-ARIA tabs): Left/Right (and Up/Down) move between
  // SELECTABLE tabs with wrap; Home/End jump to first/last. Combined with the
  // roving tabIndex below, the whole tablist is a single tab stop.
  const selectableKeys = tabs.filter((t) => !t.locked && !t.disabled).map((t) => t.key);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = selectableKeys.indexOf(active);
    if (i === -1 || selectableKeys.length === 0) return;
    let next: string | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = selectableKeys[(i + 1) % selectableKeys.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = selectableKeys[(i - 1 + selectableKeys.length) % selectableKeys.length];
    else if (e.key === 'Home') next = selectableKeys[0];
    else if (e.key === 'End') next = selectableKeys[selectableKeys.length - 1];
    if (next) {
      e.preventDefault();
      select(next);
      btnRefs.current[next]?.focus();
    }
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label="Card sections" onKeyDown={onKeyDown} className="flex items-center gap-1 border-b border-gray-200">
        {tabs.map((t) => {
          const selected = t.key === active;
          const blocked = t.locked || t.disabled;
          return (
            <button
              key={t.key}
              ref={(el) => { btnRefs.current[t.key] = el; }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.key}`}
              aria-disabled={blocked || undefined}
              disabled={blocked}
              tabIndex={selected ? 0 : -1}
              onClick={() => !blocked && select(t.key)}
              className={[
                'px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
                selected
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800',
                blocked ? 'cursor-not-allowed text-gray-300 hover:text-gray-300' : '',
              ].join(' ')}
            >
              <span className="inline-flex items-center gap-1">
                {t.locked && <LockGlyph />}
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
      {activeTab && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeTab.key}`}
          aria-labelledby={`${baseId}-tab-${activeTab.key}`}
          className="pt-3"
        >
          {activeTab.content}
        </div>
      )}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 2a4 4 0 00-4 4v2H5a1 1 0 00-1 1v7a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-1V6a4 4 0 00-4-4zm2 6V6a2 2 0 10-4 0v2h4z"
        clipRule="evenodd"
      />
    </svg>
  );
}
