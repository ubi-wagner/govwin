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
