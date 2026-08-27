/**
 * Parsing `@someone` out of a comment.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────
 * It is pure, it is fiddly, and it is the part most likely to be wrong in a way nobody notices:
 * an over-eager matcher silently notifies people who were never mentioned, and an under-eager one
 * silently notifies nobody at all. Both look identical from the outside — a comment that saved.
 *
 * ── WHAT COUNTS AS A MENTION ─────────────────────────────────────────────────────────────────
 * `@` followed by an email address. Not `@FirstName`: names are not unique, two Daves is the
 * normal case, and guessing which one was meant is exactly the kind of confident wrongness this
 * codebase keeps finding. An email is what the product already shows on the roster, so it is what
 * a person can actually type.
 *
 * The `@` must start a token — preceded by start-of-string or whitespace or an opening bracket. An
 * email address inside prose ("write to dana@acme.test") is NOT a mention; without this rule every
 * address anyone pasted would notify its owner.
 *
 * ── AND WHAT DOES NOT ────────────────────────────────────────────────────────────────────────
 * A token that matches nothing on the project stays PLAIN TEXT and the comment still saves. Two
 * reasons: refusing a whole comment over a typo'd name is the sort of thing that teaches people to
 * stop using the feature, and someone not on the project must not be notified about a project they
 * cannot open — the same rule that makes `NOT_ON_PROJECT` a refusal on task assignment. The caller
 * is told who was matched and who was not, so the UI can say so rather than leaving the author to
 * assume they were heard.
 */

/**
 * `@` + an email, anchored to a token boundary.
 *
 * The local part deliberately excludes `@` so `@@x` cannot match, and the domain requires a dot so
 * a trailing word does not get swallowed. Trailing punctuation is trimmed by the caller rather
 * than by the pattern: "…ask @dana@acme.test." should match the address, not the full stop.
 */
const MENTION = /(^|[\s(\[<])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Raw `@token` addresses in a body, lowercased and de-duplicated, in first-seen order. */
export function extractMentionTokens(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of String(body ?? '').matchAll(MENTION)) {
    // Trim trailing sentence punctuation the address cannot end with anyway. A dot is legal INSIDE
    // a domain but never at the end of one, so stripping it here cannot damage a real address.
    const token = m[2].replace(/[.,;:!?)\]>]+$/, '').toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export interface MentionResolution {
  /** User ids to notify — matched, on the project, and never the author themselves. */
  userIds: string[];
  /** The emails that matched, in the same order as `userIds`. */
  matched: string[];
  /** Tokens that matched nobody on the project. Kept so the caller can say so. */
  unmatched: string[];
}

/**
 * Resolve tokens against the people who can actually see this project.
 *
 * `candidates` is the project roster, not the tenant directory. That is the whole point: a mention
 * is an invitation to look at something, and inviting somebody to look at a page they will be
 * refused is worse than not inviting them.
 *
 * The AUTHOR is dropped from the result. Mentioning yourself is a normal thing to do while writing
 * ("@me to follow up") and it must not raise a ToDo telling you what you already know.
 */
export function resolveMentions(
  body: string,
  candidates: Array<{ userId: string; email: string | null }>,
  authorUserId: string,
): MentionResolution {
  const byEmail = new Map<string, string>();
  for (const c of candidates) {
    if (c.email) byEmail.set(c.email.toLowerCase(), c.userId);
  }

  const userIds: string[] = [];
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const token of extractMentionTokens(body)) {
    const userId = byEmail.get(token);
    if (!userId) { unmatched.push(token); continue; }
    if (userId === authorUserId) continue;      // telling yourself is not a notification
    if (userIds.includes(userId)) continue;     // two spellings of one person is one mention
    userIds.push(userId);
    matched.push(token);
  }
  return { userIds, matched, unmatched };
}
