/**
 * Ingest-assessment reader (#12) — surfaces the OnIngestAssessmentRequested advisory manager.
 *
 * When an rfp_admin hits "Assess readiness" on a curated solicitation, OnIngestAssessmentRequested
 * fires `rfp_ingest_manager` (AI_INVOKE `tool.ingest.assess`). The manager reads the ingest state,
 * infers the pipeline stage, and returns an ADVISORY coordination plan — which specialist agents to
 * run next (`ingest_analyst`/`matrix_stager`/`skeleton_architect`/`curation_qa`), what is blocking
 * release, and a prioritized next-action list. That plan lands in the workflow instance's
 * `step_results['ai_ingest_manager']` but never reached a screen (the route returns only the
 * DETERMINISTIC snapshot). This module extracts + parses that plan so the curation workspace can
 * render it. Pure + framework-free (unit-tested; no DB).
 *
 * The manager is prompted to emit a JSON object; `digStepText` (lib/agent-output) pulls the text out
 * of whatever carrier the fabric used, then `extractJson` finds the object even when it's wrapped in
 * prose or a ```json fence. A non-JSON reply (e.g. the sandbox emulator stub) yields `hasAny:false`
 * so the panel self-hides — we only render a real, structured plan.
 */
import { digStepText } from '@/lib/agent-output';

/** The workflow step the manager's plan lands under. */
export const INGEST_MANAGER_STEP = 'ai_ingest_manager';

export interface IngestAgentAction {
  agent: string;
  action: string; // run | re-run
  why: string;
  priority: number | null;
}
export interface IngestBlocker {
  area: string; // shred | extract | matrix | skeleton | quality
  issue: string;
  fix: string;
}
export interface IngestAssessment {
  stage: string | null;
  /** 0..1 readiness estimate, or null if the manager didn't give one. */
  readiness: number | null;
  summary: string | null;
  agentPlan: IngestAgentAction[];
  blockers: IngestBlocker[];
  nextActions: string[];
  generatedAt: string | null;
  /** Whether a real structured plan was rendered (so the panel can self-hide). */
  hasAny: boolean;
}

const empty = (generatedAt: string | null): IngestAssessment => ({
  stage: null, readiness: null, summary: null, agentPlan: [], blockers: [], nextActions: [], generatedAt, hasAny: false,
});

/** Find the first balanced JSON object in a text blob (tolerates ```json fences + surrounding prose). */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>; }
        catch { return null; }
      }
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse the manager's coordination plan out of a workflow instance's step_results (already coerced
 * to an object) + the instance's start time. Defensive at every layer — a missing step, a non-JSON
 * reply, or a partial object all degrade to `hasAny:false`/empty arrays rather than throwing.
 */
export function parseIngestAssessment(
  stepResults: Record<string, unknown> | null | undefined,
  generatedAt: string | null,
): IngestAssessment {
  const sr = stepResults && typeof stepResults === 'object' ? stepResults : {};
  const text = digStepText((sr as Record<string, unknown>)[INGEST_MANAGER_STEP]);
  if (!text) return empty(generatedAt);
  const obj = extractJson(text);
  if (!obj) return empty(generatedAt);

  const agentPlan: IngestAgentAction[] = Array.isArray(obj.agent_plan)
    ? (obj.agent_plan as unknown[])
        .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
        .map((p) => ({ agent: str(p.agent), action: str(p.action) || 'run', why: str(p.why), priority: num(p.priority) }))
        .filter((p) => p.agent)
    : [];
  const blockers: IngestBlocker[] = Array.isArray(obj.blockers)
    ? (obj.blockers as unknown[])
        .map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : {}))
        .map((b) => ({ area: str(b.area), issue: str(b.issue), fix: str(b.fix) }))
        .filter((b) => b.issue)
    : [];
  const nextActions: string[] = Array.isArray(obj.next_actions)
    ? (obj.next_actions as unknown[]).map(str).filter(Boolean)
    : [];
  const summary = str(obj.summary) || null;
  const stage = str(obj.stage) || null;
  const readiness = num(obj.readiness);

  const hasAny = !!(summary || agentPlan.length || blockers.length || nextActions.length);
  return { stage, readiness, summary, agentPlan, blockers, nextActions, generatedAt, hasAny };
}
