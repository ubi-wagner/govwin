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
  /** The pipeline librarian's richer AI catalog, when a result has been persisted (else null).
   *  Advisory — layered on top of the deterministic dedup/quality above. */
  librarian?: LibrarianLayer | null;
}

export type LibrarianAction = 'keep' | 'retag' | 'merge' | 'reject';
/** A tag the librarian proposes (dimension:value), applied UNconfirmed via apply-librarian-tags. */
export interface SuggestedTag { dimension: string; value: string }
export interface LibrarianAssessment {
  atomId: string;
  title: string | null;         // from the REAL atom (never the model's echo)
  qualityScore: number | null;  // 0..1
  relevanceScore: number | null; // 0..1
  freshness: string | null;     // current | aging | stale
  action: LibrarianAction | null;
  reason: string | null;
  mergeIntoAtomId: string | null; // validated to a real tenant atom, else null
  summary: string | null;
  // The librarian's proposed taxonomy (mig-free; applied as unconfirmed tags on request).
  // Previously parsed-and-dropped — surfacing them lets a `retag` recommendation be acted on.
  vol: string | null;
  kind: string | null;
  suggestedTags: SuggestedTag[];
}
export interface LibrarianLayer {
  assessments: LibrarianAssessment[];
  packageNotes: string | null;
  recommendedRejectIds: string[]; // validated
  generatedAt: string;            // ISO — when the catalog was produced
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

// ── Librarian catalog (the pipeline agent's richer, AI-produced scoring) ──────────────────

const _num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const _str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const _ACTIONS: LibrarianAction[] = ['keep', 'retag', 'merge', 'reject'];

// Slugify a taxonomy token to match how tags are stored (lowercase, non-alnum → underscore),
// so a model's "Past Performance" collapses to the canonical `past_performance` value.
const _tagSlug = (s: string): string => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Parse the librarian's `suggested_tags: ["dimension:value", ...]` into validated {dimension,value}
 *  pairs. Drops any entry without exactly one colon-separated dimension + value; deduped. */
function parseSuggestedTags(raw: unknown): SuggestedTag[] {
  if (!Array.isArray(raw)) return [];
  const out: SuggestedTag[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const idx = item.indexOf(':');
    if (idx <= 0 || idx >= item.length - 1) continue; // need non-empty dimension AND value
    const dimension = _tagSlug(item.slice(0, idx));
    const value = _tagSlug(item.slice(idx + 1));
    if (!dimension || !value) continue;
    const key = `${dimension}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dimension, value });
  }
  return out;
}

/**
 * Parse the librarian agent's catalog JSON (model-produced, UNVALIDATED — it arrives as a raw
 * string at agent_task_results.output.result.text) into a clean, safe layer. Every atom_id is
 * validated against the real tenant atoms (`validAtoms`: id → title); anything the model
 * hallucinated or that belongs to another tenant is dropped. Titles come from the real atom,
 * never the model's echo. Pure — unit-testable, no DB. Returns null if there's nothing usable.
 */
export function parseLibrarianCatalog(
  rawText: string | null | undefined,
  validAtoms: Map<string, string | null>,
  generatedAt: string,
): LibrarianLayer | null {
  if (!rawText) return null;
  let cat: unknown;
  try { cat = JSON.parse(rawText); } catch { return null; }
  if (!cat || typeof cat !== 'object') return null;
  const c = cat as Record<string, unknown>;

  const assessments: LibrarianAssessment[] = [];
  const rawList = Array.isArray(c.assessments) ? c.assessments : [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const id = _str(a.atom_id);
    if (!id || !validAtoms.has(id)) continue; // validate against real tenant atoms
    const rec = (a.recommendation && typeof a.recommendation === 'object' ? a.recommendation : {}) as Record<string, unknown>;
    const actionRaw = _str(rec.action);
    const action = actionRaw && (_ACTIONS as string[]).includes(actionRaw) ? (actionRaw as LibrarianAction) : null;
    const mergeInto = _str(rec.merge_into_atom_id);
    assessments.push({
      atomId: id,
      title: validAtoms.get(id) ?? null,
      qualityScore: _num(a.quality_score),
      relevanceScore: _num(a.relevance_score),
      freshness: _str(a.freshness),
      action,
      reason: _str(rec.reason),
      mergeIntoAtomId: mergeInto && validAtoms.has(mergeInto) ? mergeInto : null,
      summary: _str(a.summary),
      vol: _str(a.vol) ? _tagSlug(_str(a.vol) as string) : null,
      kind: _str(a.kind) ? _tagSlug(_str(a.kind) as string) : null,
      suggestedTags: parseSuggestedTags(a.suggested_tags),
    });
  }

  const recommendedRejectIds = (Array.isArray(c.recommended_rejects) ? c.recommended_rejects : [])
    .map(_str)
    .filter((x): x is string => !!x && validAtoms.has(x));
  const packageNotes = _str(c.package_notes);

  if (assessments.length === 0 && !packageNotes && recommendedRejectIds.length === 0) return null;
  return { assessments, packageNotes, recommendedRejectIds, generatedAt };
}
