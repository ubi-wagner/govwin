/**
 * The bucket scorer — a ZERO-IMPORT LEAF.
 *
 * `scoreCard` is a pure function and it has exactly one other implementation: `score_card` in
 * pipeline/src/workflows/actions/rescore.py. Keeping it importable without pulling anything else in
 * is what lets `verify-scorer-parity.mjs` run it head-to-head against the Python one over a shared
 * fixture set — the check that the two files' comments about each other have always claimed and
 * never made. It split out of `lib/bucket-ranking.ts` for that reason: that module imports
 * `@/lib/db`, which throws at module scope without a DATABASE_URL, so a parity runner could not
 * load the scorer without standing up a database to test a pure function.
 *
 * Same reasoning as `lib/event-namespaces.ts`, the other zero-import leaf in this tree. Everything
 * here is re-exported by `lib/bucket-ranking.ts`, so existing imports are unaffected.
 *
 * ⚠️ KEEP IT A LEAF. An import here is a database, or a browser bundle, or a broken parity check.
 */

/**
 * True if `keyword` occurs in `text` (both compared lowercased). Precision rule: a short single-word
 * token (≤3 chars) matches only on a WORD BOUNDARY, so the default buckets' bare `ai`/`ml` no longer
 * false-positive on "email"/"html"; longer tokens and multi-word phrases keep substring matching
 * (deliberately fuzzy — "3d print" should hit "3d printing"). Deterministic. Mirror in
 * pipeline/src/workflows/actions/rescore.py::_keyword_hit.
 */
export function keywordHit(text: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  if (k.length <= 3 && !/\s/.test(k)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`).test(text);
  }
  return text.includes(k);
}

/**
 * Epoch ms for a card `closeDate`, or null if it is not an ISO-8601 date.
 *
 * ── WHY THIS IS NOT `new Date(x).getTime()` ──────────────────────────────────────────────────
 * `new Date('Fri Aug 28')` returns a VALID date — 2001-08-28, a year V8 invented — while Python's
 * `datetime.fromisoformat` raises. So the same card scored by the two runtimes got different
 * DENOMINATORS: TS admitted a timeline factor at v=0, Python abstained. Not hypothetical: the
 * bridge's own comment records `"Fri Aug 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"`
 * reaching the card jsonb, and JS parses that too.
 *
 * Two rules, both learned from the mismatch:
 *  · **Require ISO.** The loose parser is the one inventing information; matching Python's
 *    strictness is the direction that closes the gap rather than widening it.
 *  · **Assume UTC when no zone is given.** `new Date('2026-09-20T00:00:00')` is parsed in the
 *    HOST's timezone by JS and as naive-then-UTC by Python — a silent divergence that hides
 *    entirely on a UTC box and appears in production.
 *
 * Mirror of rescore.py::_close_ms.
 */
export function closeMs(closeDate: unknown): number | null {
  if (typeof closeDate !== 'string') {
    // A Date can reach here if a caller passed a row column straight through (the repo's #2 crash
    // class). Accept it rather than silently abstaining on a perfectly good value.
    if (closeDate instanceof Date) return Number.isFinite(closeDate.getTime()) ? closeDate.getTime() : null;
    return null;
  }
  const s = closeDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  const hasTime = /[T ]\d{2}:/.test(s);
  const normalized = hasZone ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}${hasTime ? '' : 'T00:00:00'}Z`;
  const t = new Date(normalized).getTime();
  return Number.isFinite(t) ? t : null;
}

export interface BucketCriteria {
  keywords?: string[];
  naics?: string[];
  agencies?: string[];
  programTypes?: string[];
  setAsides?: string[];
  useAccessibility?: boolean;
  useTimeline?: boolean;
  includeClosed?: boolean;
  trlBand?: string | null;           // reserved (needs opp-TRL extraction)
  weights?: Record<string, number>;
}

/**
 * Coerce arbitrary client input into a valid BucketCriteria (docs/BUCKET_LOCKDOWN.md T2). Drops
 * junk rather than 400-ing: string-array fields keep only non-empty strings; toggles must be real
 * booleans; weights keep only finite, non-negative numbers. An explicit empty array is preserved
 * (so a client can clear keywords); an omitted field stays absent (so a PATCH can merge). Guarantees
 * the stored jsonb is always shaped the way scoreCard expects — no silent all-zero from bad shapes.
 */
export function sanitizeBucketCriteria(input: unknown): BucketCriteria {
  const c = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : undefined;
  const out: BucketCriteria = {};
  const set = (k: 'keywords' | 'naics' | 'agencies' | 'programTypes' | 'setAsides') => {
    const a = strArr(c[k]);
    if (a !== undefined) out[k] = a;
  };
  set('keywords'); set('naics'); set('agencies'); set('programTypes'); set('setAsides');
  if (typeof c.useAccessibility === 'boolean') out.useAccessibility = c.useAccessibility;
  if (typeof c.useTimeline === 'boolean') out.useTimeline = c.useTimeline;
  if (typeof c.includeClosed === 'boolean') out.includeClosed = c.includeClosed;
  if (typeof c.trlBand === 'string' || c.trlBand === null) out.trlBand = c.trlBand as string | null;
  if (c.weights && typeof c.weights === 'object' && !Array.isArray(c.weights)) {
    const w: Record<string, number> = {};
    for (const [k, v] of Object.entries(c.weights as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) w[k] = v;
    }
    if (Object.keys(w).length) out.weights = w;
  }
  return out;
}

export interface CardFields {
  title?: string | null;
  description?: string | null;
  spotlightSummary?: string | null;   // admin's first-pass matching context (mig 107)
  office?: string | null;
  agency?: string | null;
  naicsCodes?: string[] | null;
  programType?: string | null;
  setAsideType?: string | null;
  closeDate?: string | null;
  // Carried across the bridge from mig 238. Each was extracted at ingest and dropped at the one hop
  // that feeds ranking; `techFocusAreas` is the headline — AI-extracted, admin-editable, read by
  // `capture_strategist`, and matched by neither scorer until now.
  techFocusAreas?: string[] | null;
  phaseType?: string | null;
  topicNumber?: string | null;
  topicBranch?: string | null;
  /**
   * The curated build-out and the curator's marks (mig 239) — what ranking reads INSTEAD of the
   * solicitation text. See `ScoreInputs` for the measurement that settled it.
   */
  volumes?: string[] | null;
  requiredItems?: string[] | null;
  highlights?: Array<{ text?: string | null }> | null;
}

/**
 * The default weight of every signal, in ONE place.
 *
 * `describeComposition` tells a customer what their lens actually scores on, and a number in the UI
 * that disagrees with the scorer is worse than no number at all — it is a confident lie about how
 * their own bucket behaves. Both read this table, so they cannot drift. Changing a value here
 * changes the scorer, the Python mirror's fixture expectations, and the sentence the customer reads,
 * which is the correct blast radius.
 */
export const DEFAULT_WEIGHTS = {
  keyword: 1,
  naics: 1,
  agency: 1,
  program: 1,
  accessibility: 1,
  timeline: 0.5,
} as const;

/** How a bucket's score is composed — what the customer is shown about their own lens. */
export interface CompositionEntry {
  key: keyof typeof DEFAULT_WEIGHTS;
  /** Plain-language name. Not the field name: a customer did not choose "programTypes". */
  label: string;
  weight: number;
  /** Percentage of the score this signal carries, when every side has the data. */
  share: number;
  /**
   * True when the signal only participates if the OPPORTUNITY carries the field. Stated because a
   * lens naming NAICS codes against opportunities that have none is, in practice, scoring on
   * something else entirely — and the customer should be able to see that rather than infer it.
   */
  conditional: boolean;
  /**
   * How many of the tenant's OWN cards carry the field this signal reads — `null` when not measured.
   *
   * `conditional` says the signal *can* be skipped. This says how often it *is*. They are not the
   * same sentence, and only the second one is actionable.
   */
  carried: number | null;
  /** The denominator for `carried` — cards in this tenant's feed. `null` when not measured. */
  cards: number | null;
}

/**
 * How many of a tenant's cards carry each conditional signal's field.
 *
 * ── WHY A HEDGE IS NOT A MEASUREMENT ─────────────────────────────────────────────────────────
 * `conditional` already told the customer a signal "is skipped for any opportunity that does not
 * carry that field". True, and useless: it is the same sentence whether the field is present on
 * every opportunity or on none. On this box `naicsCodes` is an EMPTY ARRAY on all 22 master
 * opportunities and therefore on all 63 cards — so a lens that names NAICS codes and is told they
 * carry 25% of its score is scoring on keywords and closing date alone, at 100%, and has no way to
 * find that out. `setAsideType` and `techFocusAreas` are the same story.
 *
 * The scorer is already right about this — `scoreCard` abstains rather than charging a card for
 * what ingest never captured (see ABSENT IS NOT ZERO below). This type carries that fact FORWARD to
 * the person authoring the lens, which is the only place it can change a decision: they can drop
 * the criterion, or add keywords to carry the weight, or ask us why the field is empty.
 *
 * Measured over the tenant's own mirror, not the platform: what matters is what THIS customer's
 * feed carries.
 */
export interface SignalCoverage {
  /** Cards in the tenant's feed. */
  cards: number;
  /** Per-signal count of cards carrying the field that signal reads. */
  carried: Partial<Record<keyof typeof DEFAULT_WEIGHTS, number>>;
}

/**
 * Describe how a bucket's criteria compose into a score.
 *
 * Enumerates exactly the signals `scoreCard` would use if every card field were present, in the
 * same order and off the same weight table. `__tests__` pins it against what `scoreCard` actually
 * produces for a fully-populated card, because the plan's rule for this line was: *confirm the
 * percentage matches what scoreCard computes — a wrong number here is worse than none.*
 *
 * Pass `coverage` to also state how many of the tenant's cards each conditional signal can actually
 * reach. Omitted → every entry reports `carried: null`, which renders as no claim at all rather
 * than as a confident zero.
 */
export function describeComposition(
  criteria: BucketCriteria,
  coverage?: SignalCoverage | null,
): { entries: CompositionEntry[]; totalWeight: number } {
  const c = criteria ?? {};
  const w = c.weights ?? {};
  const raw: Array<Omit<CompositionEntry, 'share'>> = [];
  const add = (key: CompositionEntry['key'], label: string, conditional: boolean) => {
    /**
     * Only a CONDITIONAL signal has coverage: `keyword` reads the title, which every card has, so
     * "carried by 63 of 63" would be noise dressed as information.
     *
     * ⚠️ The presence of `coverage` decides this, NOT the presence of a count inside it. A signal
     * that reached no card is missing from a naively-built map, and gating on the count would then
     * render "no claim" for exactly the case worth reporting — 0 of 63. (`measureCoverage` seeds
     * zeros for this reason too; both halves, because either alone is a silent revert.)
     */
    const measured = conditional && !!coverage;
    raw.push({
      key,
      label,
      weight: w[key] ?? DEFAULT_WEIGHTS[key],
      conditional,
      carried: measured ? (coverage!.carried[key] ?? 0) : null,
      cards: measured ? coverage!.cards : null,
    });
  };

  if (c.keywords?.length) add('keyword', `${c.keywords.length} keyword${c.keywords.length === 1 ? '' : 's'}`, false);
  if (c.naics?.length) add('naics', 'NAICS codes', true);
  if (c.agencies?.length) add('agency', 'agency', true);
  if (c.programTypes?.length) add('program', 'program type', true);
  if (c.useAccessibility && c.setAsides?.length) add('accessibility', 'set-aside', true);
  if (c.useTimeline !== false) add('timeline', 'closing date', true);

  const totalWeight = raw.reduce((s, e) => s + e.weight, 0);
  return {
    entries: raw.map((e) => ({ ...e, share: totalWeight > 0 ? Math.round((100 * e.weight) / totalWeight) : 0 })),
    totalWeight,
  };
}

/**
 * Measure, over a tenant's own cards, how many each signal can actually reach.
 *
 * ── THE PREDICATE IS `scoreCard` ITSELF, NOT A COPY OF IT ────────────────────────────────────
 * The obvious implementation is a SQL aggregate — `count(*) FILTER (WHERE card->>'agency' <> '')`
 * and one clause per signal. It is also the implementation this repo has been burned by: it
 * re-types a predicate the scorer already owns, in a second language, and the two drift silently.
 * `closeDate` alone makes the point — the scorer requires ISO-8601 (`closeMs`), so a card holding
 * `"Fri Aug 28 2026 00:00:00 GMT+0000"` is non-empty in SQL and ABSTAINS in the ranker. A SQL
 * count would report that signal as covered while it reached nothing, which is the exact failure
 * this function exists to expose.
 *
 * So instead: score every card against a probe that names every signal with a token no card can
 * match, and count which factors come back. A factor is present in `factors` if and only if the
 * signal participated — that IS "the card carries the field", by definition rather than by
 * restatement. A signal added to `scoreCard` later is measured correctly with no change here.
 *
 * The probe deliberately matches NOTHING (`\u0000`): coverage asks whether a signal is *in the
 * denominator*, never whether it scored well. The returned scores are discarded.
 *
 * Pure and cheap — arithmetic over the ≤1,000 cards a feed holds — so it runs inline on the
 * request that lists buckets rather than needing storage of its own.
 */
export function measureCoverage(cards: CardFields[], nowMs: number): SignalCoverage {
  const NEVER = '\u0000';
  const probe: BucketCriteria = {
    keywords: [NEVER],
    naics: [NEVER],
    agencies: [NEVER],
    programTypes: [NEVER],
    setAsides: [NEVER],
    useAccessibility: true,
    useTimeline: true,
  };
  /**
   * Seeded with an explicit 0 for every signal, which is the whole point of the measurement.
   *
   * Leaving a signal that matched nothing ABSENT from the map makes "reached no card" and "was
   * never measured" the same value — and the first is precisely the finding this function exists
   * to report. Seeded off `DEFAULT_WEIGHTS`, so a signal added to the scorer is seeded with it.
   */
  const carried: SignalCoverage['carried'] = Object.fromEntries(
    (Object.keys(DEFAULT_WEIGHTS) as Array<keyof typeof DEFAULT_WEIGHTS>).map((k) => [k, 0]),
  ) as SignalCoverage['carried'];
  for (const card of cards) {
    const { factors } = scoreCard(card, probe, nowMs);
    for (const k of Object.keys(factors) as Array<keyof typeof DEFAULT_WEIGHTS>) {
      carried[k] = (carried[k] ?? 0) + 1;
    }
  }
  return { cards: cards.length, carried };
}

/**
 * Optional per-card inputs a pure function cannot compute for itself.
 *
 * ── THE CORPUS FACTOR WAS REMOVED (mig 239) ──────────────────────────────────────────────────
 * mig 238 fed a `ts_rank` over the tenant's copy of the whole solicitation. Measured on one
 * 330-page general BAA, `ts_rank` returns the SAME value for terms the document has nothing to do
 * with — `agriculture` 0.0608 and `concrete` 0.0608 and `submarine` 0.0608, `manufacturing` 0.0827
 * and `quantum` 0.0827. A general solicitation mentions everything once, so ranking against it
 * measures document LENGTH, not relevance; the normalization then turned "appears once" into 100
 * and four unrelated buckets scored one card at ceiling.
 *
 * What ranks instead is the CURATED record on the card — summary, expert notes, technology focus,
 * volumes, required items and the admin's highlights. All of it small, specific, and there because
 * a person decided it mattered.
 *
 * The interface stays because the shape is right and a future input (a tenant's own past-award
 * history, say) belongs here rather than in the card.
 */
export interface ScoreInputs {
  /** Reserved. No inputs today — see the note above. */
  readonly _?: never;
}

/**
 * Score one card (0-100) against the bucket criteria; returns the per-signal factors too.
 *
 * ── ABSENT IS NOT ZERO ───────────────────────────────────────────────────────────────────────
 * Every factor guards BOTH sides. A bucket naming agencies against a card whose agency the ingest
 * never captured contributes nothing and stays OUT of the denominator; a card with an agency that
 * does not match scores a real 0 and stays in. Before mig 238 only `timeline` did this, and said
 * so — *"an invalid date must not change the denominator"* — while four other factors quietly
 * charged the tenant's lens for the platform's missing data.
 *
 * Mirror in pipeline/src/workflows/actions/rescore.py::score_card. `verify-scorer-parity.mjs`
 * asserts they agree; the comment claiming it is not the check.
 */
export function scoreCard(
  card: CardFields,
  criteria: BucketCriteria,
  nowMs: number,
  inputs: ScoreInputs = {},
): { score: number; factors: Record<string, number> } {
  // The Python twin opens with `card = card or {}` / `criteria = criteria or {}`. Without the same
  // guard here a null card THROWS on one side and scores 0 on the other — a divergence the parity
  // fixtures cannot see, because they always pass an object.
  card = card ?? {};
  criteria = criteria ?? {};
  const w = criteria.weights ?? {};
  const parts: Array<{ key: string; v: number; weight: number }> = [];
  // The admin's spotlight summary is authoritative matching context — it's the
  // curated first-pass blurb built for exactly this ranking (mig 107).
  const text = [
    card.title, card.spotlightSummary, card.description, card.office,
    // mig 238. Not agency/programType/setAside: those already have their own weighted factor, and
    // folding them in here too would double-count one signal as a silent weight change.
    card.phaseType, card.topicNumber, card.topicBranch,
    ...(Array.isArray(card.techFocusAreas) ? card.techFocusAreas : []),
    // The curated build-out (mig 239): what the admin decided this proposal is MADE OF.
    // "Commercialization Plan", "Phase I Work Plan", "Cost Volume" says what the work IS.
    ...(Array.isArray(card.volumes) ? card.volumes : []),
    ...(Array.isArray(card.requiredItems) ? card.requiredItems : []),
    // And what they MARKED while reading — the residue of a reading that otherwise evaporates
    // into a 103-character blurb. This is the passage a person judged worth keeping, which is
    // exactly what the raw document text is not.
    ...(Array.isArray(card.highlights) ? card.highlights.map((h) => h?.text ?? '') : []),
  ].filter(Boolean).join(' ').toLowerCase();

  if (criteria.keywords?.length && text !== '') {
    const hits = criteria.keywords.filter((k) => k && keywordHit(text, k)).length;
    parts.push({ key: 'keyword', v: hits / criteria.keywords.length, weight: w.keyword ?? DEFAULT_WEIGHTS.keyword });
  }
  if (criteria.naics?.length && (card.naicsCodes?.length ?? 0) > 0) {
    const cn = new Set((card.naicsCodes ?? []).map((n) => String(n)));
    const inter = criteria.naics.filter((n) => cn.has(String(n))).length;
    parts.push({ key: 'naics', v: inter / criteria.naics.length, weight: w.naics ?? DEFAULT_WEIGHTS.naics });
  }
  if (criteria.agencies?.length && card.agency) {
    const a = card.agency.toLowerCase();
    parts.push({ key: 'agency', v: criteria.agencies.some((x) => a.includes(x.toLowerCase())) ? 1 : 0, weight: w.agency ?? DEFAULT_WEIGHTS.agency });
  }
  if (criteria.programTypes?.length && card.programType) {
    const p = card.programType.toLowerCase();
    parts.push({ key: 'program', v: criteria.programTypes.some((x) => p === x.toLowerCase()) ? 1 : 0, weight: w.program ?? DEFAULT_WEIGHTS.program });
  }
  if (criteria.useAccessibility && criteria.setAsides?.length && card.setAsideType) {
    const s = card.setAsideType.toLowerCase();
    parts.push({ key: 'accessibility', v: criteria.setAsides.some((x) => s.includes(x.toLowerCase())) ? 1 : 0, weight: w.accessibility ?? DEFAULT_WEIGHTS.accessibility });
  }
  if (criteria.useTimeline !== false && card.closeDate) {
    // Skip an UNPARSEABLE close date rather than pushing a phantom 0.1 timeline signal — parity with
    // the Python scorer's `_close_ms is None` skip (an invalid date must not change the denominator).
    const t = closeMs(card.closeDate);
    if (t !== null) {
      const days = (t - nowMs) / 86_400_000;
      const v = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 0.6 : days <= 90 ? 0.3 : 0.1;
      parts.push({ key: 'timeline', v, weight: w.timeline ?? DEFAULT_WEIGHTS.timeline });
    }
  }

  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  // v ∈ [0,1] for every signal so the weighted average is already in range; clamp anyway to belt the
  // DB CHECK(score BETWEEN 0 AND 100) (mig 180) — a negative/huge criteria weight can't leak a bad score.
  const raw = totalW > 0 ? Math.round((100 * parts.reduce((s, p) => s + p.v * p.weight, 0)) / totalW) : 0;
  const score = Math.max(0, Math.min(100, raw));
  const factors: Record<string, number> = {};
  for (const p of parts) factors[p.key] = Math.max(0, Math.min(100, Math.round(p.v * 100)));
  return { score, factors };
}
