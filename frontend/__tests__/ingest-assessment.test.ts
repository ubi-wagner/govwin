/**
 * Ingest-assessment reader (#12) — lib/ingest/assessment.ts.
 *
 * The rfp_ingest_manager plan lands as a JSON blob nested at varying depths in step_results
 * (the same variable carriers the strategy reader handles). These tests pin that
 * parseIngestAssessment: finds + parses the JSON even wrapped in prose / a ```json fence, maps
 * every field defensively, and reports hasAny:false for a missing step / non-JSON stub (so the
 * panel self-hides).
 */
import { describe, expect, it } from 'vitest';
import { parseIngestAssessment, INGEST_MANAGER_STEP } from '@/lib/ingest/assessment';

const plan = {
  stage: 'matrixing',
  readiness: 0.4,
  agent_plan: [
    { agent: 'matrix_stager', action: 'run', why: 'no compliance rows yet', priority: 1 },
    { agent: 'skeleton_architect', action: 're-run', why: 'outline stale', priority: 2 },
    { agent: '', action: 'run', why: 'dropped — no agent name' }, // filtered out
  ],
  blockers: [{ area: 'matrix', issue: 'compliance matrix empty', fix: 'run matrix_stager' }],
  next_actions: ['Run matrix_stager', 'Review the matrix', ''],
  summary: 'Matrixing stage — build the compliance matrix next.',
};

describe('parseIngestAssessment', () => {
  it('parses the manager JSON nested at result.result.text (AI_INVOKE shape)', () => {
    const sr = { [INGEST_MANAGER_STEP]: { result: { result: { text: JSON.stringify(plan) } } } };
    const a = parseIngestAssessment(sr, '2026-08-17T00:00:00Z');
    expect(a.hasAny).toBe(true);
    expect(a.stage).toBe('matrixing');
    expect(a.readiness).toBe(0.4);
    expect(a.summary).toContain('Matrixing');
    expect(a.agentPlan.map((p) => p.agent)).toEqual(['matrix_stager', 'skeleton_architect']); // empty-agent dropped
    expect(a.agentPlan[1].action).toBe('re-run');
    expect(a.blockers).toHaveLength(1);
    expect(a.blockers[0].area).toBe('matrix');
    expect(a.nextActions).toEqual(['Run matrix_stager', 'Review the matrix']); // empty string dropped
    expect(a.generatedAt).toBe('2026-08-17T00:00:00Z');
  });

  it('finds the JSON even when wrapped in prose + a ```json fence', () => {
    const text = 'Here is the plan.\n\n```json\n' + JSON.stringify(plan) + '\n```\nLet me know.';
    const a = parseIngestAssessment({ [INGEST_MANAGER_STEP]: { text } }, null);
    expect(a.hasAny).toBe(true);
    expect(a.agentPlan).toHaveLength(2);
  });

  it('hasAny:false for a missing step, a non-JSON stub, and null step_results (panel self-hides)', () => {
    expect(parseIngestAssessment({}, null).hasAny).toBe(false);
    expect(parseIngestAssessment(null, null).hasAny).toBe(false);
    expect(parseIngestAssessment({ [INGEST_MANAGER_STEP]: { text: 'Done — the emulated model completed its tool loop.' } }, null).hasAny).toBe(false);
  });

  it('tolerates a partial object — present fields render, absent ones default empty', () => {
    const a = parseIngestAssessment({ [INGEST_MANAGER_STEP]: { text: JSON.stringify({ summary: 'just a summary' }) } }, null);
    expect(a.hasAny).toBe(true); // summary alone is renderable
    expect(a.summary).toBe('just a summary');
    expect(a.agentPlan).toEqual([]);
    expect(a.blockers).toEqual([]);
    expect(a.readiness).toBeNull();
  });
});
