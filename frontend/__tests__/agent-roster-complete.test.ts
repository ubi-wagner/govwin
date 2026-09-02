/**
 * AN AGENT MISSING FROM THE ROSTER IS INVISIBLE TO THE PERSON WHOSE WORKFORCE IT IS.
 *
 * `/admin/agents` → Agent Workforce is the only surface where an rfp_admin can see what agents
 * exist, what wakes them, and whether they are live or dormant. It is a hand-written list, and the
 * registry it describes grows in a different file, in a different language.
 *
 * They drifted. The roster listed 36 while the registry held 39: `ops_companion`,
 * `project_manager` and `status_narrator` were registered, action-mapped, invocable — and absent
 * from the one page that documents the workforce. The companion in particular had a doorbell
 * button on two surfaces and no entry saying what it was, so the only way to discover it was to
 * notice the button and guess.
 *
 * That is the producer/consumer shape docs/PRODUCER_CONSUMER_AUDIT.md exists for, one level up:
 * built, correct, wired, and unreachable from the surface that is supposed to describe it. Nothing
 * failed. The comment above the list even said "36", which was true when it was written.
 *
 * So the count is no longer written down anywhere; it is reconciled here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_LABELS } from '@/lib/agent-labels';

const ROSTER_FILE = join(process.cwd(), 'components/admin/agent-workforce.tsx');

function rosterRoles(): string[] {
  const src = readFileSync(ROSTER_FILE, 'utf8');
  return [...src.matchAll(/\{ role: '([a-z_]+)'/g)].map((m) => m[1]);
}

describe('the operator can see every agent that exists', () => {
  it('parses the roster at all — a matcher that matches nothing proves nothing', () => {
    expect(rosterRoles().length).toBeGreaterThan(30);
  });

  it('every registered archetype appears on the roster an rfp_admin reads', () => {
    const missing = Object.keys(AGENT_LABELS).filter((r) => !rosterRoles().includes(r));
    expect(missing, `registered but INVISIBLE at /admin/agents: ${missing.join(', ')}`).toEqual([]);
  });

  it('and the roster invents nobody — a listed agent that does not exist is a promise we do not keep', () => {
    const phantom = rosterRoles().filter((r) => !AGENT_LABELS[r]);
    expect(phantom, `on the roster but not in the registry: ${phantom.join(', ')}`).toEqual([]);
  });

  it('lists each agent once', () => {
    const roles = rosterRoles();
    const dupes = roles.filter((r, i) => roles.indexOf(r) !== i);
    expect(dupes).toEqual([]);
  });

  it('every entry says what wakes it and what it does — a name alone documents nothing', () => {
    const src = readFileSync(ROSTER_FILE, 'utf8');
    const entries = [...src.matchAll(/\{ role: '([a-z_]+)'[^}]*\}/g)];
    const thin = entries
      .filter(([e]) => !/trigger: '[^']{8,}'/.test(e) || !/does: '[^']{20,}/.test(e))
      .map(([, role]) => role);
    expect(thin, `roster entries with no real trigger or description: ${thin.join(', ')}`).toEqual([]);
  });
});

describe('the companion carries a manual, and the manual is not allowed to lie', () => {
  const MANUAL = join(process.cwd(), '..', 'docs', 'OPS_COMPANION_MANUAL.md');
  const manual = () => readFileSync(MANUAL, 'utf8');
  const agent = () => readFileSync(
    join(process.cwd(), '..', 'pipeline', 'src', 'agents', 'archetypes', 'ops_companion.py'), 'utf8');

  it('exists, and the roster points at it', () => {
    expect(manual().length).toBeGreaterThan(2000);
    expect(readFileSync(ROSTER_FILE, 'utf8')).toContain('docs/OPS_COMPANION_MANUAL.md');
  });

  /**
   * The reason this test exists rather than trusting the prose: a manual is written once and the
   * code moves. Every claim below is one a reader would ACT on — "it cannot write", "one call",
   * "at most four hours" — so each is checked against the thing it describes. Same idiom as
   * `event-namespace-registry.test.ts` reconciling three runtimes.
   */
  it('its claim about the window bound matches the code', () => {
    expect(agent()).toMatch(/min\(int\(minutes or 15\), 240\)/);
    expect(manual()).toContain('240');
  });

  it('its claim that the agent has one tool, called once, matches the code', () => {
    expect(agent()).toContain('return ["get_observation_window"]');
    expect(manual()).toContain('get_observation_window');
  });

  it('its claim that output lands in front of a human matches the code', () => {
    expect(agent()).toMatch(/def human_gate[\s\S]{0,120}return True/);
    expect(manual().toLowerCase()).toContain('human');
  });

  it('its claim that the agent cannot write matches the code', () => {
    const src = agent().toUpperCase();
    for (const verb of ['INSERT INTO', 'UPDATE ', 'DELETE FROM']) expect(src).not.toContain(verb);
    expect(manual().toLowerCase()).toMatch(/writes? (nothing|no )/);
  });

  it('documents every field the report is required to return', () => {
    const m = manual();
    for (const field of ['fixes', 'unexplained', 'recency', 'effectiveness', 'finish',
      'could_not_see', 'worth_keeping', 'summary', 'observed']) {
      expect(m, `the manual never explains the "${field}" field`).toContain(field);
    }
  });

  it('says what it CANNOT see — a manual that only lists capabilities is a sales page', () => {
    expect(manual()).toMatch(/cannot|does not see|blind/i);
  });
});
