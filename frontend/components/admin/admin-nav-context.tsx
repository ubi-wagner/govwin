'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const LEAVE_MSG = 'You have unsaved changes on this page. Leave without saving?';

type AdminNavCtx = {
  /** True when the current page has edits that haven't been saved. */
  dirty: boolean;
  /** Editors call this to report whether they currently hold unsaved changes. */
  setDirty: (d: boolean) => void;
};

const Ctx = createContext<AdminNavCtx | null>(null);

/**
 * Wraps the admin area. Provides a single "unsaved changes" flag plus two guards:
 *   1. beforeunload — native prompt on refresh / tab-close / external URL.
 *   2. a capture-phase document click listener — intercepts ANY in-app <a>/<Link>
 *      click while dirty and asks for confirmation. Capture runs before Next's Link
 *      handler, so preventDefault() cancels the client-side navigation if the user
 *      chooses to stay. This means no per-link wiring is needed — the sidebar, the
 *      nav trail, and the stat-card links are all covered automatically.
 */
export function AdminNavProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);

  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirtyState((prev) => (prev === d ? prev : d));
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      // Let modified clicks (new tab/window), non-primary buttons, and already-handled
      // events through untouched.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.target === '_blank') return;

      if (window.confirm(LEAVE_MSG)) {
        setDirty(false); // user chose to leave — clear so the next page starts clean
      } else {
        e.preventDefault();
        e.stopPropagation(); // also stops React's root listener → the link's onClick won't fire
      }
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [setDirty]);

  const value = useMemo(() => ({ dirty, setDirty }), [dirty, setDirty]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Stable fallback when used outside the provider (e.g. CanvasEditor in the portal):
// a no-op guard so editors never crash and don't churn effects.
const NOOP_CTX: AdminNavCtx = { dirty: false, setDirty: () => {} };

export function useAdminNav(): AdminNavCtx {
  return useContext(Ctx) ?? NOOP_CTX;
}

/**
 * Editors call this each render with their current dirty state, e.g.
 *   useUnsavedChanges(content !== savedContent);
 * It syncs the guard flag and clears it when the editor unmounts.
 */
export function useUnsavedChanges(isDirty: boolean) {
  const { setDirty } = useAdminNav();
  useEffect(() => {
    setDirty(isDirty);
    return () => setDirty(false);
  }, [isDirty, setDirty]);
}
