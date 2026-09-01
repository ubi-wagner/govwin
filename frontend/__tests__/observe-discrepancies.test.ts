/**
 * THE OBSERVATION WINDOW'S FINDINGS ARE ARITHMETIC, AND ARITHMETIC IS TESTABLE.
 *
 * `/admin/observe` exists because every defect found this week was invisible from the surface that
 * caused it. Its value is entirely in the discrepancy list, and a discrepancy list that cannot
 * fail is decoration — so each rule is exercised against a window that DOES contain the shape and
 * a window that does not.
 *
 * The second half matters as much as the first. A rule that fires on everything is as useless as
 * one that fires on nothing: during a live drive, a false finding costs the driver a detour, and
 * two of them cost the tool its credibility.
 */
import { describe, it, expect } from 'vitest';
import { findDiscrepancies, clampWindow, type ObservedEvent } from '@/lib/observe';

const ev = (o: Partial<ObservedEvent>): ObservedEvent => ({
  id: Math.random().toString(36).slice(2),
  namespace: 'proposal', type: 'section.saved', phase: 'single',
  actorEmail: 'a@b.test', tenantId: null, error: null, durationMs: 12,
  payload: {}, createdAt: new Date(), sentence: 'a section was saved',
  ...o,
});
const none = { tasks: [], mail: [], workflows: [] };
const run = (
  events: ObservedEvent[],
  extra: Partial<typeof none> = {},
) => findDiscrepancies(events, (extra.tasks ?? []) as never, (extra.mail ?? []) as never, (extra.workflows ?? []) as never);

describe('observation window · discrepancies', () => {
  it('a clean window reports nothing', () => {
    expect(run([ev({}), ev({ type: 'section.locked' })])).toEqual([]);
  });

  it('a start with no end is a finding; a matched pair is not', () => {
    const unclosed = run([ev({ phase: 'start', type: 'package.requested' })]);
    expect(unclosed.map((d) => d.severity)).toContain('finding');
    expect(unclosed[0].what).toMatch(/started and never finished/);

    const closed = run([
      ev({ phase: 'start', type: 'package.requested' }),
      ev({ phase: 'end', type: 'package.requested' }),
    ]);
    expect(closed, 'a matched bracket must NOT be reported').toEqual([]);
  });

  it('a reserved-never-confirmed mail row is a finding, a sent one is not', () => {
    const stuck = run([], { mail: [{ toEmail: 'x@y.test', template: 'welcome', status: 'pending', createdAt: new Date() }] });
    expect(stuck.some((d) => d.severity === 'finding' && /never confirmed/.test(d.what))).toBe(true);

    const sent = run([], { mail: [{ toEmail: 'x@y.test', template: 'welcome', status: 'sent', createdAt: new Date() }] });
    expect(sent).toEqual([]);
  });

  it('a failed send is a NOTE, not a finding — it is expected with no provider', () => {
    const r = run([], { mail: [{ toEmail: 'x@y.test', template: 'welcome', status: 'failed', createdAt: new Date() }] });
    expect(r).toHaveLength(1);
    expect(r[0].severity, 'a sandbox with no provider would otherwise cry wolf every run').toBe('note');
    expect(r[0].meaning).toMatch(/production gate/i);
  });

  it('a workflow that started and never moved is a finding; one that advanced is not', () => {
    const t = new Date();
    const idle = run([], { workflows: [{ id: 'w1', workflowName: 'OnCardApplied', status: 'running', currentStep: 0, createdAt: t, updatedAt: t }] });
    expect(idle.some((d) => /never advanced/.test(d.what))).toBe(true);

    const moved = run([], { workflows: [{ id: 'w2', workflowName: 'OnCardApplied', status: 'running', currentStep: 2, createdAt: t, updatedAt: new Date(t.getTime() + 5000) }] });
    expect(moved).toEqual([]);
  });

  it('a task assigned to a role no queue reads is a finding; a real role is not', () => {
    const bad = run([], { tasks: [{ id: 't1', taskType: 'admin_review', title: 'x', assigneeRole: 'wizard', tenantId: null, createdAt: new Date() }] });
    expect(bad.some((d) => /no queue reads/.test(d.what))).toBe(true);

    const good = run([], { tasks: [{ id: 't2', taskType: 'admin_review', title: 'x', assigneeRole: 'rfp_admin', tenantId: null, createdAt: new Date() }] });
    expect(good).toEqual([]);
  });

  it('an event carrying an error is surfaced', () => {
    const r = run([ev({ error: 'boom' })]);
    expect(r.some((d) => /carry an error/.test(d.what))).toBe(true);
  });

  it('the window is clamped at both ends', () => {
    // 0 observes nothing; a week is not a window; a non-number falls back rather than NaN-ing.
    expect(clampWindow(0)).toBe(1);
    expect(clampWindow(99999)).toBe(240);
    expect(clampWindow('abc')).toBe(5);
    expect(clampWindow(undefined)).toBe(5);
    expect(clampWindow(15)).toBe(15);
  });

  it('every finding states what it MEANS, not just what it counted', () => {
    // A driver mid-session should not have to infer the significance of a count.
    const r = run([ev({ phase: 'start' })], {
      mail: [{ toEmail: 'x@y.test', template: null, status: 'pending', createdAt: new Date() }],
    });
    expect(r.length).toBeGreaterThan(1);
    for (const d of r) expect(d.meaning.length, `"${d.what}" has no meaning`).toBeGreaterThan(30);
  });
});
