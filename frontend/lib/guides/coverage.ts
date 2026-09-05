/**
 * Guide coverage — the two halves, joined.
 *
 * ── WHY THIS IS A JOIN AND NOT A QUERY ───────────────────────────────────────────────────────
 * A guide's state comes from two places that are true in different environments:
 *
 *   the REPO      is there a guide · does it still have `<Unwritten>` sections · did the surface
 *                 change after the guide did.  Needs the `.tsx` sources and a git history, and the
 *                 deployed container has neither — so it is computed at build time into
 *                 `docs/guide-coverage.json` by `scripts/catalog-guides.mjs`.
 *   the DATABASE  what people wrote while using it.  Only true at runtime.
 *
 * Joining them here rather than pretending either half is the whole thing is the point. The board
 * says which half it is showing, and a missing artifact is reported as such rather than rendering
 * an empty table that reads like full coverage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sqlBypass } from '@/lib/db';

export type GuideState = 'none' | 'open' | 'ready' | 'stale';

export interface CoverageRow {
  route: string;
  dir: string;
  guide: string | null;
  state: GuideState;
  steps: Array<{ id: string; title: string }>;
  controls: string[];
  unwritten: number;
  canon: string | null;
  surfaceChangedAt: number | null;
  guideWrittenAt: number | null;
}

export interface Coverage {
  generatedAt: string | null;
  summary: { surfaces: number; none: number; open: number; ready: number; stale: number };
  rows: CoverageRow[];
  /** Unresolved notes per route — the live half. */
  openNotes: Record<string, number>;
  /** True when the build-time artifact is missing: the board must say so, not show nothing. */
  missing: boolean;
}

const EMPTY: Coverage = {
  generatedAt: null,
  summary: { surfaces: 0, none: 0, open: 0, ready: 0, stale: 0 },
  rows: [],
  openNotes: {},
  missing: true,
};

/** The artifact is traced into the standalone build; a missing one is a fact, not an empty table. */
function readArtifact(): Omit<Coverage, 'openNotes' | 'missing'> | null {
  for (const p of [
    path.join(process.cwd(), 'docs/guide-coverage.json'),
    path.join(process.cwd(), '../docs/guide-coverage.json'),
    '/home/user/govwin/docs/guide-coverage.json',
  ]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* try the next */ }
  }
  return null;
}

/**
 * Unresolved notes, counted per route.
 *
 * Anchors are `route#step`, so the route is everything before the `#`. Counting by prefix instead
 * would fold `/admin/sources` into `/admin/source-profiles` the day such a route exists — the kind
 * of quiet miscount that makes a board stop being believed.
 */
async function openNotesByRoute(): Promise<Record<string, number>> {
  try {
    const rows = await sqlBypass<Array<{ route: string; n: number }>>`
      SELECT split_part(anchor, '#', 1) AS route, count(*)::int AS n
        FROM working_notes
       WHERE anchor IS NOT NULL AND anchor_kind = 'route' AND state <> 'resolved'
       GROUP BY 1`;
    return Object.fromEntries(rows.map((r) => [r.route, r.n]));
  } catch (e) {
    console.error('[guides/coverage] open-note count failed:', e);
    return {};
  }
}

export async function getCoverage(): Promise<Coverage> {
  const art = readArtifact();
  if (!art) return EMPTY;
  return { ...art, openNotes: await openNotesByRoute(), missing: false };
}

/**
 * The state a row is actually in once the live half is known.
 *
 * A guide with no `<Unwritten>` left but unresolved notes against it is NOT ready — somebody using
 * it said it was wrong and nobody has answered. Storing that would need a flag; deriving it needs
 * one join.
 */
export function effectiveState(row: CoverageRow, openNotes: Record<string, number>): GuideState {
  if (row.state === 'none') return 'none';
  if (row.state === 'stale') return 'stale';
  return (openNotes[row.route] ?? 0) > 0 ? 'open' : row.state;
}

/** How a state reads, and what it asks of the reader. */
export const STATE_COPY: Record<GuideState, { label: string; hint: string; tone: string }> = {
  none: { label: 'No guide', hint: 'nobody has written one — this is the queue', tone: 'bg-gray-100 text-gray-700 ring-gray-500/20' },
  open: { label: 'Open', hint: 'unwritten sections, or notes nobody has answered', tone: 'bg-amber-50 text-amber-900 ring-amber-600/30' },
  stale: { label: 'Stale', hint: 'the surface changed after the guide did — re-drive it', tone: 'bg-red-50 text-red-800 ring-red-600/20' },
  ready: { label: 'Ready', hint: 'no unwritten sections, no open notes, controls verified', tone: 'bg-green-50 text-green-800 ring-green-600/20' },
};
