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

  it('THE FALSE POSITIVE: the two-TYPE bracket convention closes too', () => {
    // `pipeline/src/ingest/base.py` emits `ingest.run.start` and `ingest.run.end` as two different
    // TYPES, each with its matching phase — not one type with two phases, which is what the TS
    // spine does. Keying on `namespace:type` matched only the second convention, so 28 balanced
    // pairs in the live database read as 28 unclosed brackets, every time, for as long as this
    // check has existed. It became urgent the moment the doorbell began HANDING FINDINGS TO THE
    // AGENT: noise is one thing, a false fact stated with authority for a model to diagnose is
    // another.
    const closed = run([
      ev({ namespace: 'finder', phase: 'start', type: 'ingest.run.start' }),
      ev({ namespace: 'finder', phase: 'end', type: 'ingest.run.end' }),
    ]);
    expect(closed).toEqual([]);
  });

  it('…and normalising the suffix does not make a genuinely open bracket disappear', () => {
    // The control. A fix that suppresses the false positive by suppressing the check is not a fix.
    const open = run([ev({ namespace: 'finder', phase: 'start', type: 'ingest.run.start' })]);
    expect(open).toHaveLength(1);
    expect(open[0].what).toMatch(/finder:ingest\.run$/);
  });

  it('reports how long it has been open, because "still running" looks identical', () => {
    // A window is [now-N, now]: an operation that began inside it and has not finished yet is
    // indistinguishable from one that threw. There is no honest threshold — a 6-minute export in a
    // 5-minute window is legitimately open — so the age is stated and the reader judges.
    const open = run([ev({ phase: 'start', type: 'package.requested', createdAt: new Date(Date.now() - 300_000) })]);
    expect(open[0].detail).toMatch(/open for 5m/);
    expect(open[0].meaning).toMatch(/still\s+running/);
  });

  it('a start with no end is a finding; a matched pair is not', () => {
    const unclosed = run([ev({ phase: 'start', type: 'package.requested' })]);
    expect(unclosed.map((d) => d.severity)).toContain('finding');
    expect(unclosed[0].what).toMatch(/started and has not finished/);

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
