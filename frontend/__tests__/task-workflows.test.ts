import { describe, expect, it } from 'vitest';
import {
  BROADCAST_WORKFLOW,
  TASK_WORKFLOWS,
  TASK_WORKFLOW_LIST,
  resolveTaskWorkflow,
} from '@/lib/tasks/workflows';
import { taskCompleterKind } from '@/lib/tasks/completers';

describe('task→workflow catalog — every ToDo belongs to a defined workflow', () => {
  it('resolves every known task_type to a definition with ordered steps', () => {
    for (const key of Object.keys(TASK_WORKFLOWS)) {
      const wf = resolveTaskWorkflow(key);
      expect(wf.key).toBe(key);
      expect(wf.steps.length).toBeGreaterThan(0);
      // the action step must index a real step
      expect(wf.actionStep).toBeGreaterThanOrEqual(0);
      expect(wf.actionStep).toBeLessThan(wf.steps.length);
    }
  });

  it('never returns undefined — an unmapped type falls to the broadcast floor', () => {
    expect(resolveTaskWorkflow('totally_unknown_type')).toBe(BROADCAST_WORKFLOW);
    expect(resolveTaskWorkflow('')).toBe(BROADCAST_WORKFLOW);
    expect(resolveTaskWorkflow(null)).toBe(BROADCAST_WORKFLOW);
    expect(resolveTaskWorkflow(undefined)).toBe(BROADCAST_WORKFLOW);
  });

  it('the broadcast floor is a single read→acknowledge note', () => {
    expect(BROADCAST_WORKFLOW.key).toBe('broadcast');
    expect(BROADCAST_WORKFLOW.completer).toBe('acknowledge');
    expect(BROADCAST_WORKFLOW.steps).toEqual(['Read', 'Acknowledge']);
    // any producer can raise a broadcast note (human, engine, automation, agent)
    expect(BROADCAST_WORKFLOW.producedBy).toEqual(
      expect.arrayContaining(['human', 'engine', 'automation', 'agent']),
    );
  });

  it('the "review, edit & lock" micro-workflow is defined for a section', () => {
    const wf = resolveTaskWorkflow('review_section');
    expect(wf.name).toMatch(/lock/i);
    expect(wf.steps).toContain('Accept & Lock');
    expect(wf.completer).toBe('review');
  });

  it('the live seeded task types (proposal_setup, review_section) are mapped, not floored', () => {
    for (const key of ['proposal_setup', 'review_section']) {
      expect(resolveTaskWorkflow(key)).not.toBe(BROADCAST_WORKFLOW);
    }
  });

  it('de-duplicates the registry list (broadcast appears once)', () => {
    const keys = TASK_WORKFLOW_LIST.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('broadcast');
  });

  it('every workflow declares at least one producer (automation/agent hooks in place)', () => {
    for (const wf of TASK_WORKFLOW_LIST) {
      expect(wf.producedBy.length).toBeGreaterThan(0);
    }
  });
});

describe('completer resolution — params.kind overrides, workflow completer is the fallback', () => {
  it('falls back to the workflow completer when no params.kind is set', () => {
    // broadcast workflow → acknowledge without any params
    expect(taskCompleterKind(null, resolveTaskWorkflow('broadcast').completer)).toBe('acknowledge');
    // review_section workflow → review
    expect(taskCompleterKind({}, resolveTaskWorkflow('review_section').completer)).toBe('review');
  });

  it('an explicit params.kind always wins over the workflow default', () => {
    expect(taskCompleterKind({ kind: 'acknowledge' }, 'review')).toBe('acknowledge');
    expect(taskCompleterKind({ kind: 'upload' }, 'review')).toBe('upload');
    expect(taskCompleterKind({ kind: 'form' }, 'acknowledge')).toBe('form');
    expect(taskCompleterKind({ kind: 'review' }, 'acknowledge')).toBe('review');
  });

  it('an unrecognized params.kind degrades to the provided fallback', () => {
    expect(taskCompleterKind({ kind: 'nonsense' }, 'acknowledge')).toBe('acknowledge');
    expect(taskCompleterKind({ kind: 42 }, 'upload')).toBe('upload');
  });

  it('defaults to review when no fallback is provided (back-compat)', () => {
    expect(taskCompleterKind(null)).toBe('review');
    expect(taskCompleterKind({})).toBe('review');
  });
});
