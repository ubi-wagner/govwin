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

/**
 * THE SIGNED DISTANCE from `now` to `iso`, in milliseconds — the primitive under every countdown,
 * age and overdue flag in the tree (B160).
 *
 * Twelve call sites computed this inline off `Date.now()` during render, each with its own rounding:
 * `Math.ceil(…/86_400_000)` for days-left, `Math.floor` for days-ago, `Math.round(Math.abs(…))` for
 * a due label. Every one made its output a function of WHEN it rendered, which is React #418 — and
 * the guard for that class could not see them, because it matched only module-level helpers whose
 * body builds an "ago"-shaped string.
 *
 * DELIBERATELY RETURNS MILLISECONDS, not days. Each caller keeps its own rounding, so the text a
 * person sees after mount is byte-identical to what it was before this change — the same discipline
 * the email seam used when thirteen call sites moved behind one function. A helper that also
 * rounded would be a behaviour change wearing a refactor's clothes.
 *
 * `null` until mounted (and for an unparseable date), so the server and the first client render
 * take the same branch and cannot disagree. What each site shows in that moment is its own choice —
 * usually the absolute date without the countdown — and it must render the SAME thing on both
 * sides, including any className the value drives: an `overdue` flag that flips on hydration is
 * exactly as much of a mismatch as the words next to it.
 */
export function deltaMsFrom(iso: string | Date | null | undefined, now: number | null): number | null {
  if (!iso || now === null) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t - now : null;
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

/**
 * ── ABSOLUTE dates need the same rule, for a DIFFERENT reason (B156) ───────────────────────────
 *
 * Everything above guards *when* a value was computed. This guards *where*. `toLocaleDateString`
 * / `toLocaleString` / `toLocaleTimeString` with no `timeZone` formats in the AMBIENT zone — the
 * container's on the server, the viewer's in the browser. React's own hydration-mismatch list names
 * it outright: *"date formatting in a user's locale which doesn't match the server."*
 *
 * Measured on `/admin/sources`, browser pinned to America/New_York:
 *
 *     +  Aug 25, 2026, 04:02 PM      (client)
 *     -  Aug 25, 2026, 08:02 PM      (server, UTC)
 *
 * Four hours apart, inside `<SourceCard>` — #418, whole-subtree hydration failure, HTTP 200.
 *
 * THIS IS WHY #418 READ AS AN INTERMITTENT FOR FIVE ROUTES AND MONTHS. The sandbox runs the server
 * AND the browser in UTC, so both sides format identically and every sweep is clean. In production
 * it is not intermittent at all: it fires for every admin whose browser is not UTC, which is all of
 * them. A bug that cannot occur on the machine you test on is not a rare bug.
 *
 * `timeZone: 'UTC'` also removes the mismatch and is right where the value IS defined in UTC (cron
 * schedules — B92). It is wrong here: showing a person in Ohio a timestamp in UTC, unlabelled, is a
 * correctness bug of its own. The mount rule gives both — a deterministic UTC stamp on the first
 * paint that both sides agree on, then the viewer's own zone on the next tick.
 */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

const DEFAULT_ABS: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
};

/** Absolute date in the VIEWER's zone once mounted; a deterministic UTC stamp before that. */
export function localFrom(
  iso: string | Date | null | undefined,
  mounted: boolean,
  opts: Intl.DateTimeFormatOptions = DEFAULT_ABS,
  fallback = '—',
): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return fallback;
  // Not mounted — server and first client paint both take this branch, so they cannot disagree.
  if (!mounted) return d.toLocaleString('en-US', { ...opts, timeZone: 'UTC' });
  return d.toLocaleString('en-US', opts);
}

/** Drop-in for `{formatDate(x)}` in a client component. */
export function LocalTime({
  iso, opts, fallback,
}: { iso: string | Date | null | undefined; opts?: Intl.DateTimeFormatOptions; fallback?: string }) {
  return <>{localFrom(iso, useMounted(), opts, fallback)}</>;
}

/** Drop-in for `{relativeTime(x)}` at a call site that has no `now` to hand. */
export function TimeAgo({ iso, everyMs }: { iso: string | Date | null | undefined; everyMs?: number }) {
  return <>{relativeFrom(iso, useClientNow(everyMs))}</>;
}

/** Drop-in for `{formatElapsed(x)}`. Ticks per second — it is showing a running clock. */
export function Elapsed({ iso }: { iso: string | Date | null | undefined }) {
  return <>{elapsedFrom(iso, useClientNow(1000))}</>;
}
