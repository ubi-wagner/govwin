'use client';

/**
 * Minimal, dependency-free toast notifications.
 *
 * Replaces jarring native `alert()` for transient action-result feedback (success / error / info)
 * that has no natural inline home — e.g. "Failed to remove collaborator", "File ingested". Module-level
 * pub/sub, so there is NO context provider to thread: mount <Toaster/> once in the root layout and call
 * `toast(...)` from any client component.
 *
 * Native `confirm()` is intentionally KEPT for destructive blocking gates (delete / force-advance /
 * deactivate) — a toast is non-blocking and cannot gate an action. Form-level validation keeps using the
 * house inline-message pattern (`setMsg`/`setErr` → inline <p>). Toasts are only for transient results.
 */
import { useEffect, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

let counter = 0;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const l of listeners) l(items);
}

function remove(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(message: string, kind: ToastKind, ttlMs: number) {
  const id = ++counter;
  items = [...items, { id, message, kind }];
  emit();
  if (typeof window !== 'undefined') {
    window.setTimeout(() => remove(id), ttlMs);
  }
  return id;
}

export const toast = Object.assign(
  (message: string, kind: ToastKind = 'info', ttlMs = 4500) => push(message, kind, ttlMs),
  {
    success: (message: string, ttlMs = 4000) => push(message, 'success', ttlMs),
    error: (message: string, ttlMs = 6000) => push(message, 'error', ttlMs),
    info: (message: string, ttlMs = 4500) => push(message, 'info', ttlMs),
  },
);

const kindTone: Record<ToastKind, string> = {
  success: 'bg-emerald-600 border-emerald-700',
  error: 'bg-red-600 border-red-700',
  info: 'bg-gray-800 border-gray-900',
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    const l = (next: ToastItem[]) => setList(next);
    listeners.add(l);
    setList(items); // catch any toast fired before mount
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-auto pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {list.map((t) => (
        <button
          key={t.id}
          onClick={() => remove(t.id)}
          className={`pointer-events-auto text-left text-sm text-white px-4 py-2.5 rounded-lg border shadow-lg hover:opacity-95 ${kindTone[t.kind]}`}
          aria-label="Dismiss notification"
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
