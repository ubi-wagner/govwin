/**
 * Turn a system identifier into something a person reads. A zero-import leaf.
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
 * Three unrelated surfaces reached a customer with a raw token in the same week — the activity
 * stream's actor (`workflow_manager`), the agent panel's role (`outcome_analyst`), and the
 * opportunity card's program type (`sbir_phase_1`) — plus the process monitor showing
 * `wait_deadline_exceeded` as the entire error message. Four files, one rule. A copy per file is
 * exactly how the first three got out of step with each other.
 *
 * Everything here is presentation only: it never decides anything, and it never invents a word
 * that was not in the identifier.
 */

/**
 * Title-case a `snake_case` / `kebab-case` identifier.
 *
 * Small words stay lower except in first position, so `library_seed_suggester` reads
 * "Library Seed Suggester" and a hypothetical `review_of_record` reads "Review of Record" —
 * a name, not a shout. Known initialisms are upper-cased, because "Rfp" is worse than the token.
 */
const INITIALISMS = new Set(['rfp', 'qa', 'ai', 'pp', 'sbir', 'sttr', 'baa', 'ota', 'cso', 'clin', 'cdrl', 'tvsf', 'nsf', 'doe', 'dod', 'dow', 'nofo']);
const SMALL = new Set(['of', 'to', 'for', 'and', 'or', 'the', 'a', 'an', 'in', 'on', 'by']);

export function titleizeIdentifier(raw: string): string {
  return raw
    .split(/[_\-.:]+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (INITIALISMS.has(lower)) return lower.toUpperCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Humanize a string ONLY if it looks like an identifier.
 *
 * A real sentence passes through untouched. This matters where a field can hold either — a
 * workflow's `last_error` is sometimes `wait_deadline_exceeded` and sometimes a message somebody
 * wrote, and title-casing the second would mangle it. Deciding by shape rather than by hoping is
 * the difference.
 */
export function humanizeIfIdentifier(raw: string | null | undefined): string {
  if (!raw) return '';
  return /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)+$/.test(raw.trim()) ? titleizeIdentifier(raw.trim()) : raw;
}
