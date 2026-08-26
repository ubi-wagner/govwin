'use client';

/**
 * "3m ago" — safe to server-render.
 *
 * THE DEFECT THIS EXISTS FOR (bug log B79, and its second and third occurrences). A `'use client'`
 * component that reads `Date.now()` during render makes its output a function of WHEN IT RENDERED:
 * the server writes "2s ago", the client hydrates a beat later and computes "4s ago", the text does
 * not match, and React throws #418. That does not degrade one cell — it fails hydration for the
 * whole subtree and takes the page to its error boundary, while the route answers HTTP 200 the
 * entire time. Nothing gating on a status code can see it; `verify-surfaces` reads the rendered
 * page, which is how all three were found.
 *
 * The shape: `now` is null until mounted, so the FIRST paint — server and client alike — is a
 * deterministic UTC timestamp, and the relative form appears on the next tick. A component rather
 * than a helper because the call sites are scattered across sub-components, and threading a `now`
 * prop through every one of them is how the next site gets forgotten.
 *
 * `iso` is typed string and is not always one: postgres.js hands back a Date for a timestamptz and
 * server components pass it straight through. Normalised here rather than at seven call sites.
 */
import { useEffect, useState } from 'react';

/** Null until mounted; ticks so an open tab does not go stale. */
export function useClientNow(everyMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function relativeFrom(iso: string | Date | null | undefined, now: number | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  if (now === null) return new Date(t).toISOString().slice(0, 19).replace('T', ' ') + 'Z';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Elapsed since a start, for a still-running thing ("2m 14s"). Same mount rule. */
export function elapsedFrom(iso: string | Date | null | undefined, now: number | null): string {
  if (!iso) return '--';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '--';
  if (now === null) return '—';
  const ms = Math.max(0, now - t);
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/** Drop-in for `{relativeTime(x)}` at a call site that has no `now` to hand. */
export function TimeAgo({ iso, everyMs }: { iso: string | Date | null | undefined; everyMs?: number }) {
  return <>{relativeFrom(iso, useClientNow(everyMs))}</>;
}

/** Drop-in for `{formatElapsed(x)}`. Ticks per second — it is showing a running clock. */
export function Elapsed({ iso }: { iso: string | Date | null | undefined }) {
  return <>{elapsedFrom(iso, useClientNow(1000))}</>;
}
