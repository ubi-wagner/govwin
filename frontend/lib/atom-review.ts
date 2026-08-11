/**
 * Library Review — the deterministic "librarian" the UI can run right now.
 *
 * The pipeline `librarian` agent was designed to catalog each upload (dedup, quality, retag,
 * merge/reject) but its output is never persisted or surfaced. This computes the same
 * high-value signals — **duplicates** and **quality flags** — deterministically from the atom
 * rows, so a tenant can de-bloat + quality-gate their library with one click, no agent needed.
 * (When the live librarian's richer scoring is persisted, it layers into the same panel.)
 *
 * Pure + framework-free so it is unit-tested and can run server-side.
 */

export interface ReviewAtom {
  id: string;
  title: string | null;
  content: string;
  wordCount: number;
  status: string;
  grain: string;
  tagCount: number;
  confirmedTagCount: number;
  createdAt: string; // ISO
}

export interface DuplicateGroup {
  /** the shared normalized-content key (opaque). */
  key: string;
  /** the atoms that share (near-)identical content — the first is the suggested keeper. */
  atoms: Array<{ id: string; title: string | null; wordCount: number; status: string; createdAt: string }>;
}

export type FlagKind = 'empty' | 'tiny' | 'untagged' | 'unconfirmed';

export interface QualityFlag {
  atomId: string;
  title: string | null;
  kind: FlagKind;
  detail: string;
}

export interface LibraryReview {
  duplicateGroups: DuplicateGroup[];
  flags: QualityFlag[];
  stats: {
    total: number;
    duplicateAtoms: number;   // atoms that are a non-keeper in some duplicate group
    flagged: number;          // distinct atoms with ≥1 flag
    clean: number;            // atoms with no duplicate + no flag
  };
}

/** Normalize text so copy-paste / re-upload duplicates collide: lowercase, strip punctuation,
 *  collapse whitespace. (Paraphrase/semantic dedup is a separate, non-deterministic concern.) */
export function normalizeForDedup(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TINY_WORDS = 10;

export function computeLibraryReview(atoms: ReviewAtom[]): LibraryReview {
  // ── Duplicates: group by normalized content (only substantive atoms) ──
  const byNorm = new Map<string, ReviewAtom[]>();
  for (const a of atoms) {
    const n = normalizeForDedup(a.content);
    if (n.length < 24) continue; // too short to trust as a dedup key
    const key = n.slice(0, 600);
    const g = byNorm.get(key);
    if (g) g.push(a);
    else byNorm.set(key, [a]);
  }
  const duplicateGroups: DuplicateGroup[] = [];
  const dupNonKeepers = new Set<string>();
  for (const [key, group] of byNorm) {
    if (group.length < 2) continue;
    // Suggested keeper = the approved one if any, else the earliest created.
    const sorted = [...group].sort((a, b) => {
      const ap = a.status === 'approved' ? 0 : 1;
      const bp = b.status === 'approved' ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.createdAt.localeCompare(b.createdAt);
    });
    sorted.slice(1).forEach((a) => dupNonKeepers.add(a.id));
    duplicateGroups.push({
      key,
      atoms: sorted.map((a) => ({ id: a.id, title: a.title, wordCount: a.wordCount, status: a.status, createdAt: a.createdAt })),
    });
  }
  duplicateGroups.sort((a, b) => b.atoms.length - a.atoms.length);

  // ── Quality flags ──
  const flags: QualityFlag[] = [];
  const flagged = new Set<string>();
  for (const a of atoms) {
    const empty = !a.content || !a.content.trim();
    if (empty) {
      flags.push({ atomId: a.id, title: a.title, kind: 'empty', detail: 'No content' });
      flagged.add(a.id);
    } else if (a.wordCount > 0 && a.wordCount < TINY_WORDS) {
      flags.push({ atomId: a.id, title: a.title, kind: 'tiny', detail: `Only ${a.wordCount} word${a.wordCount === 1 ? '' : 's'}` });
      flagged.add(a.id);
    }
    if (a.tagCount === 0) {
      flags.push({ atomId: a.id, title: a.title, kind: 'untagged', detail: 'No tags — hard to find + reuse' });
      flagged.add(a.id);
    } else if (a.confirmedTagCount === 0) {
      flags.push({ atomId: a.id, title: a.title, kind: 'unconfirmed', detail: 'All tags are unconfirmed machine guesses' });
      flagged.add(a.id);
    }
  }

  const clean = atoms.filter((a) => !dupNonKeepers.has(a.id) && !flagged.has(a.id)).length;
  return {
    duplicateGroups,
    flags,
    stats: { total: atoms.length, duplicateAtoms: dupNonKeepers.size, flagged: flagged.size, clean },
  };
}
