// lib/source-url.ts
//
// Source URL pattern renderer (Scouting Spine M3 / T3.4 — contract C3.a).
//
// A `source_profiles.topic_url_pattern` is a template string containing
// `{token}` placeholders — e.g.
//   https://www.dodsbirsttr.mil/topics-app/?topicNumber={topicNumber}
// The topic expander renders one concrete, absolute URL per topic by
// substituting the tokens it knows for a given solicitation/topic.
//
// This module is pure and dependency-free on purpose: it must be importable
// from server components, API routes, and (eventually) the pipeline-facing
// admin trigger without dragging in DB/runtime deps.

/** Token values available when rendering a per-topic URL. */
export interface TopicUrlTokens {
  /** The topic number / id (e.g. "AF243-0001" or a DSIP topic UUID). */
  topicNumber?: string;
  /** The parent solicitation number (e.g. "DoD SBIR 24.4"). */
  solicitationNumber?: string;
  /** Any additional pattern token (baa_id, release, …). */
  [key: string]: string | undefined;
}

/**
 * Minimal structural shape of a source profile for the URL guard. Kept local
 * (not imported from a component) so this module stays dependency-free; any
 * object exposing `topicUrlPattern` (camelCase serialized) or
 * `topic_url_pattern` (raw DB row) satisfies it.
 */
export interface SourceUrlProfile {
  topicUrlPattern?: string | null;
  topic_url_pattern?: string | null;
}

/** Matches a `{token}` placeholder; the captured group is the token name. */
const TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Returns the list of token names referenced by a pattern, in first-seen order
 * and de-duplicated. `"a={x}&b={x}&c={y}"` -> `["x", "y"]`.
 */
export function topicUrlPatternTokens(pattern: string): string[] {
  if (!pattern) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of pattern.matchAll(TOKEN_RE)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Render a concrete topic URL from a pattern + token values.
 *
 * Substitutes every `{token}` in `pattern` with the matching value from
 * `tokens`, URL-encoding each value (so topic numbers with spaces/slashes are
 * safe in a query string). Returns `''` when:
 *   - `pattern` is empty / whitespace-only, or
 *   - any token referenced by the pattern is missing or blank in `tokens`
 *     (we never emit a URL with an unresolved `{placeholder}`).
 *
 * Pure: no I/O, no globals. Idempotent for a given (pattern, tokens) pair.
 */
export function renderTopicUrl(pattern: string, tokens: TopicUrlTokens): string {
  if (!pattern || !pattern.trim()) return '';

  // A pattern with no tokens is a static URL — return it verbatim.
  const required = topicUrlPatternTokens(pattern);
  for (const name of required) {
    const value = tokens[name];
    if (value === undefined || value === null || value === '') {
      // Required token unsatisfied — refuse to emit a half-rendered URL.
      return '';
    }
  }

  return pattern.replace(TOKEN_RE, (_full, name: string) => {
    // `name` is guaranteed present + non-empty by the check above.
    return encodeURIComponent(tokens[name] as string);
  });
}

/**
 * Guard: does this profile carry a usable topic URL pattern? Accepts either the
 * serialized (`topicUrlPattern`) or raw DB (`topic_url_pattern`) field name.
 */
export function hasTopicUrlPattern(profile: SourceUrlProfile | null | undefined): boolean {
  if (!profile) return false;
  const pattern = profile.topicUrlPattern ?? profile.topic_url_pattern;
  return typeof pattern === 'string' && pattern.trim().length > 0;
}
