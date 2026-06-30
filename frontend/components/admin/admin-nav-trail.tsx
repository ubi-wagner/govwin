'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { adminPageLabel } from './admin-nav-data';

type Entry = { href: string; label: string };
const KEY = 'adminNavTrail.v1';
const MAX = 12;

/**
 * A click-through breadcrumb: as you follow links between admin pages it records
 * the path so you can walk back and forward through the session (and jump to any
 * step). Persisted per-tab in sessionStorage so it survives refreshes.
 *
 * A cursor (like browser history) tracks your position: following a NEW link from
 * the middle of the trail drops the forward entries; back/forward just move the
 * cursor. The links are plain <Link>s, so the AdminNavProvider's unsaved-changes
 * guard covers them too.
 */
export function AdminNavTrail() {
  const pathname = usePathname();
  const entriesRef = useRef<Entry[]>([]);
  const cursorRef = useRef(0);
  const loadedRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (!pathname || !pathname.startsWith('/admin')) return;

    if (!loadedRef.current) {
      loadedRef.current = true;
      try {
        const raw = sessionStorage.getItem(KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (Array.isArray(s.entries)) entriesRef.current = s.entries;
          if (typeof s.cursor === 'number') cursorRef.current = s.cursor;
        }
      } catch {
        /* ignore malformed storage */
      }
    }

    const e = entriesRef.current;
    const c = cursorRef.current;
    const label = adminPageLabel(pathname);
    const pending = pendingRef.current;

    if (pending != null && e[pending]?.href === pathname) {
      cursorRef.current = pending; // explicit click on a trail entry / arrow
    } else if (e[c]?.href === pathname) {
      e[c] = { href: pathname, label }; // same page — refresh label only
    } else if (e[c - 1]?.href === pathname) {
      cursorRef.current = c - 1; // stepped back
    } else if (e[c + 1]?.href === pathname) {
      cursorRef.current = c + 1; // stepped forward
    } else {
      const next = e.slice(0, c + 1); // new branch — drop any forward history
      next.push({ href: pathname, label });
      entriesRef.current = next.slice(-MAX);
      cursorRef.current = entriesRef.current.length - 1;
    }

    pendingRef.current = null;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ entries: entriesRef.current, cursor: cursorRef.current }));
    } catch {
      /* ignore */
    }
    force((x) => x + 1);
  }, [pathname]);

  const entries = entriesRef.current;
  const cursor = cursorRef.current;
  if (entries.length === 0) return null;

  const canBack = cursor > 0;
  const canFwd = cursor < entries.length - 1;
  const arm = (i: number) => () => {
    pendingRef.current = i;
  };
  const arrowCls = (enabled: boolean) =>
    `px-1.5 py-0.5 rounded text-sm leading-none ${enabled ? 'text-gray-500 hover:bg-gray-200' : 'text-gray-300 pointer-events-none'}`;

  return (
    <nav
      aria-label="Navigation trail"
      className="flex items-center gap-0.5 text-xs text-gray-500 mb-4 overflow-x-auto whitespace-nowrap border-b border-gray-200 pb-2"
    >
      <Link href={canBack ? entries[cursor - 1].href : '#'} onClick={arm(cursor - 1)} aria-disabled={!canBack} title="Back" className={arrowCls(canBack)}>
        ‹
      </Link>
      <Link href={canFwd ? entries[cursor + 1].href : '#'} onClick={arm(cursor + 1)} aria-disabled={!canFwd} title="Forward" className={arrowCls(canFwd)}>
        ›
      </Link>
      <span className="mx-1 text-gray-300">|</span>
      {entries.map((en, i) => (
        <span key={`${en.href}-${i}`} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-gray-300 px-0.5">›</span>}
          {i === cursor ? (
            <span className="px-1.5 py-0.5 font-semibold text-gray-800">{en.label}</span>
          ) : (
            <Link href={en.href} onClick={arm(i)} className="px-1.5 py-0.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700">
              {en.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
