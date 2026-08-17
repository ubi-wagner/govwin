/**
 * Shared reader for agent/workflow step output.
 *
 * Agent output nests VARIABLY across the fabric's paths — a queue result is `output.result.text`,
 * an AI_INVOKE step nests at `result.result.text`, and some land as a bare `{text}` or a plain
 * string. `digStepText` tries them all so a consumer can't silently miss the content (the same
 * defensive posture as the card-fit chip fix). Pure + framework-free.
 *
 * Used by the read-on-review surfaces that render advisory agent output: the proposal capture
 * Strategy panel (lib/proposal/strategy.ts) and the ingest-assessment plan (lib/ingest/assessment.ts).
 */

/** Pull the human-readable text out of one step's result, whatever shape the fabric used. */
export function digStepText(stepResult: unknown): string | null {
  const seen = new Set<unknown>();
  const dig = (o: unknown, depth: number): string | null => {
    if (o == null || depth > 6) return null;
    if (typeof o === 'string') return o.trim() || null;
    if (typeof o !== 'object' || seen.has(o)) return null;
    seen.add(o);
    const r = o as Record<string, unknown>;
    // Prefer an explicit text field at this level.
    if (typeof r.text === 'string' && r.text.trim()) return r.text.trim();
    // Then descend the known nesting carriers (result / output), in order.
    for (const k of ['result', 'output'] as const) {
      const t = dig(r[k], depth + 1);
      if (t) return t;
    }
    return null;
  };
  return dig(stepResult, 0);
}
