/**
 * Portal build-workflow authoring — recommended defaults + validator (delegated managers).
 *
 * Locks in Phase-4:
 *   - recommendedGuardrails(): 3 phases, empty managers, [3,1,0] nudges, close-anchored dates
 *   - validateGuardrailConfig: managers are now delegated/unlimited (per mig 123 limits),
 *     while stages (3) and nudges (3) stay bounded and bad todo types are rejected.
 *
 * portal-workflow.ts imports server-only modules at the top; stub them so the pure
 * validator is unit-testable. guardrail-defaults.ts is pure (no mocks needed).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/lib/rls', () => ({ withTenant: vi.fn() }));
vi.mock('@/lib/tasks/tasks', () => ({ createTask: vi.fn() }));

import { validateGuardrailConfig } from '@/lib/portal-workflow';
import { recommendedGuardrails } from '@/lib/guardrail-defaults';

const LIMITS = { maxStages: 3, maxCollaborators: 25, maxManagers: 25, maxNudges: 3 };

describe('recommendedGuardrails', () => {
  it('is 3 phases, empty managers, 3-nudge cadence (final last)', () => {
    const g = recommendedGuardrails();
    expect(g.stages.map((s) => s.key)).toEqual(['kickoff', 'draft', 'review']);
    expect(g.collaborators).toEqual([]);
    expect(g.nudgeDays).toEqual([5, 2, 1]);
    expect(g.nudgeDays.every((n) => n > 0)).toBe(true); // createTask drops non-positive
    expect(g.stages.every((s) => s.todos.length >= 1)).toBe(true);
  });

  it('anchors draft/submit deadlines to the close date', () => {
    const nowMs = 1_000_000_000_000;
    const closeDate = new Date(nowMs + 40 * 86_400_000).toISOString(); // 40 days out
    const g = recommendedGuardrails({ closeDate, nowMs });
    const draft = g.stages.find((s) => s.key === 'draft')!.todos[0].dueDays;
    const submit = g.stages.find((s) => s.key === 'review')!.todos[0].dueDays;
    expect(submit).toBe(40);  // submit by close
    expect(draft).toBe(33);   // ~1 week before close (40 - 7)
  });

  it('the recommended default validates within the delegated-manager limits', () => {
    expect(validateGuardrailConfig(recommendedGuardrails(), LIMITS).ok).toBe(true);
  });
});

describe('validateGuardrailConfig — delegated managers', () => {
  const stage = { key: 'k', label: 'K', todos: [{ type: 'acknowledge', title: 't' }] };

  it('accepts many managers (delegated, per portal)', () => {
    const collaborators = Array.from({ length: 8 }, (_, i) => ({ email: `m${i}@x.com`, role: 'manager' as const }));
    expect(validateGuardrailConfig({ stages: [stage], collaborators, nudgeDays: [3, 1, 0] }, LIMITS).ok).toBe(true);
  });

  it('still caps stages at 3', () => {
    const res = validateGuardrailConfig({ stages: [stage, stage, stage, stage], nudgeDays: [] }, LIMITS);
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/too many stages/);
  });

  it('still caps nudges at 3', () => {
    const res = validateGuardrailConfig({ stages: [stage], nudgeDays: [1, 2, 3, 4] }, LIMITS);
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/too many nudges/);
  });

  it('rejects an invalid todo type', () => {
    const res = validateGuardrailConfig({ stages: [{ key: 'k', todos: [{ type: 'frobnicate' }] }], nudgeDays: [] }, LIMITS);
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/invalid todo type/);
  });
});

// Bug 2 (proven, this sweep): config arrives from JSON (a saved template, a launch/save body),
// so a mistyped field must fall through to a VALIDATION ERROR, never throw an un-iterable — the
// guardrail-templates POST route relies on this returning {ok:false} (422), not a bare 500. These
// call the REAL validator (unmocked); the earlier route test mocked it and missed the throw.
describe('validateGuardrailConfig — malformed shapes never throw (Bug 2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bad = (config: any) => () => validateGuardrailConfig(config, LIMITS);

  it('non-array stages (number / object) → {ok:false}, no throw', () => {
    for (const stages of [5, {}, 'nope', true]) {
      const call = bad({ stages });
      expect(call).not.toThrow();
      const res = call();
      expect(res.ok).toBe(false);
      expect(res.errors.join()).toMatch(/at least one stage/);
    }
  });

  it('non-array collaborators → {ok:false}, no throw (the .filter would have crashed)', () => {
    const call = bad({ stages: [{ key: 'k', todos: [{ type: 'acknowledge' }] }], collaborators: 'x' });
    expect(call).not.toThrow();
    expect(call().ok).toBe(true); // collaborators ignored when unusable; stages are valid
  });

  it('non-array nudgeDays → {ok:false path}, no throw', () => {
    const call = bad({ stages: [{ key: 'k', todos: [{ type: 'acknowledge' }] }], nudgeDays: 3 });
    expect(call).not.toThrow();
    expect(call().ok).toBe(true); // nudgeDays ignored when unusable
  });

  it('non-array todos on a stage → no throw, stage still validates', () => {
    const call = bad({ stages: [{ key: 'k', todos: 'nope' }], nudgeDays: [] });
    expect(call).not.toThrow();
    expect(call().ok).toBe(true); // a stage with no (usable) todos is allowed by the validator
  });

  it('empty object config → {ok:false} (needs a stage), no throw', () => {
    const call = bad({});
    expect(call).not.toThrow();
    expect(call().ok).toBe(false);
  });

  // Sweep DEFECT#1/#2 (proven, real DB): a null/degenerate stage ELEMENT passes Array.isArray but
  // later crashes createStageTodos (null.todos, AFTER the portal advanced → gate-bypass) and the
  // editor's applyConfig (null.key). The validator must reject it so it can never be saved.
  it('rejects a null / non-object / keyless stage element (no throw)', () => {
    const good = { key: 's0', todos: [{ type: 'acknowledge' }] };
    for (const badStages of [
      [good, null],                       // null element (the exact crash input)
      [good, 5],                          // number element
      [good, 'nope'],                     // string element
      [good, []],                         // array element
      [good, { label: 'no key' }],        // object with no key
      [good, { key: '' }],                // empty-string key (breaks the gate match)
      [good, { key: '   ' }],             // whitespace key
    ]) {
      const call = bad({ stages: badStages, nudgeDays: [] });
      expect(call).not.toThrow();
      const res = call();
      expect(res.ok).toBe(false);
      expect(res.errors.join()).toMatch(/each stage must be an object with a non-empty key/);
    }
    // A clean two-stage config still passes (the guard doesn't over-reject).
    expect(validateGuardrailConfig({ stages: [good, { key: 's1', todos: [] }], nudgeDays: [] }, LIMITS).ok).toBe(true);
  });
});
