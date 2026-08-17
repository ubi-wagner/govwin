/**
 * Capture-strategy reader (#1) — surfaces the OnProposalCreated advisory AI actors.
 *
 * When a proposal is created, OnProposalCreated fans four ADVISORY AI steps that plan the
 * build — capture strategy (win themes / positioning / teaming / risk), cost-realism guidance,
 * past-performance matches, and a market-research brief. Their output lands in the workflow
 * instance's `step_results` but never reached a UI. This module extracts that text so a
 * read-only Strategy panel can render it. Pure + framework-free (unit-tested; no DB).
 *
 * Agent output nests VARIABLY across the fabric's paths — a queue result is
 * `output.result.text`, an AI_INVOKE step nests at `result.result.text`, and some land as a
 * bare `{text}` or a plain string. `digStepText` tries them all so the reader can't silently
 * miss the content (the same defensive posture as the card-fit chip fix).
 */

/** The four advisory steps OnProposalCreated fans, in display order. */
export const STRATEGY_STEPS = [
  { step: 'ai_capture_strategy', key: 'strategy', label: 'Capture strategy', blurb: 'Win themes, competitive positioning, teaming, and a risk register.' },
  { step: 'ai_research_scout', key: 'research', label: 'Market research', blurb: 'Prior art, market landscape, and competitors — a cited brief.' },
  { step: 'ai_pp_matcher', key: 'pastPerformance', label: 'Past-performance matches', blurb: 'Relevant past performance and teaming-gap flags.' },
  { step: 'ai_cost_estimator', key: 'cost', label: 'Cost-realism guidance', blurb: 'Budget realism notes for the cost volume.' },
] as const;

export type StrategyKey = (typeof STRATEGY_STEPS)[number]['key'];

export interface StrategySection {
  key: StrategyKey;
  label: string;
  blurb: string;
  text: string;
}
export interface ProposalStrategy {
  sections: StrategySection[];
  generatedAt: string | null;
  /** Whether the OnProposalCreated run has produced anything renderable yet. */
  hasAny: boolean;
}

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

/**
 * Build the read-only strategy view from a workflow instance's step_results (already coerced
 * to an object) + the instance's start time. Empty sections are dropped; `hasAny` is false when
 * nothing rendered (so the panel can self-hide).
 */
export function buildProposalStrategy(
  stepResults: Record<string, unknown> | null | undefined,
  generatedAt: string | null,
): ProposalStrategy {
  const sr = stepResults && typeof stepResults === 'object' ? stepResults : {};
  const sections: StrategySection[] = [];
  for (const s of STRATEGY_STEPS) {
    const text = digStepText((sr as Record<string, unknown>)[s.step]);
    if (text) sections.push({ key: s.key, label: s.label, blurb: s.blurb, text });
  }
  return { sections, generatedAt, hasAny: sections.length > 0 };
}
