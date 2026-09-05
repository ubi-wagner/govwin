/**
 * A customer must never read a system identifier where a name belongs.
 *
 * This guards the two halves of that promise. The curated map is the nice half and it will always
 * be behind the registry — it was four behind, twice, and nobody noticed because the fallback
 * returned a perfectly good string that simply was not a name. So the property that actually has to
 * hold is about the FALLBACK: whatever comes out of `agentDisplayName`, for any input at all, must
 * be readable.
 *
 * The drift check is the second half: every role the admin roster knows about must have a curated
 * entry here, so the tenant's panel and the admin's roster cannot name the same agent two ways.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_LABELS, agentDisplayName, titleizeIdentifier } from '@/lib/agent-labels';

describe('agentDisplayName — the property that must hold for every input', () => {
  it('NEVER returns a raw identifier, for any role, curated or not', () => {
    const inputs = [...Object.keys(AGENT_LABELS), 'some_new_agent_v2', 'a-kebab-role', 'ns:scoped_role', 'x'];
    for (const role of inputs) {
      const label = agentDisplayName(role);
      expect(label, `${role} rendered with an underscore`).not.toMatch(/_/);
      expect(label, `${role} rendered with a colon`).not.toMatch(/:/);
      expect(label.trim().length, `${role} rendered empty`).toBeGreaterThan(0);
    }
  });

  it('names an uncurated role rather than echoing it — the case that shipped', () => {
    // `outcome_analyst` was curated later; the point is that the FALLBACK already reads as a name.
    expect(titleizeIdentifier('outcome_analyst')).toBe('Outcome Analyst');
    expect(titleizeIdentifier('library_seed_suggester')).toBe('Library Seed Suggester');
    expect(titleizeIdentifier('some_new_agent')).toBe('Some New Agent');
  });

  it('upper-cases initialisms, because "Rfp" is worse than the token it replaced', () => {
    expect(titleizeIdentifier('rfp_ingest_manager')).toBe('RFP Ingest Manager');
    expect(titleizeIdentifier('curation_qa')).toBe('Curation QA');
  });

  it('keeps small words lower except in first position — a name, not a shout', () => {
    expect(titleizeIdentifier('review_of_record')).toBe('Review of Record');
    expect(titleizeIdentifier('of_counsel')).toBe('Of Counsel');
  });

  it('a missing role is "Agent", not a blank cell', () => {
    expect(agentDisplayName(null)).toBe('Agent');
    expect(agentDisplayName(undefined)).toBe('Agent');
    expect(agentDisplayName('')).toBe('Agent');
  });
});

describe('the two rosters cannot drift apart', () => {
  it('every role in the admin Agent Workforce roster has a curated label here', () => {
    const src = readFileSync(join(process.cwd(), 'components/admin/agent-workforce.tsx'), 'utf8');
    const roles = [...src.matchAll(/role: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(roles.length, 'the roster regex matched nothing — this test is not testing anything')
      .toBeGreaterThan(20);
    const missing = roles.filter((r) => !AGENT_LABELS[r]);
    expect(missing, `roles the admin roster shows but lib/agent-labels.ts does not name: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('and the labels agree, so one agent has one name everywhere', () => {
    const src = readFileSync(join(process.cwd(), 'components/admin/agent-workforce.tsx'), 'utf8');
    const pairs = [...src.matchAll(/role: '([a-z_]+)', label: '([^']+)'/g)];
    const disagree = pairs
      .filter(([, role, label]) => AGENT_LABELS[role] && AGENT_LABELS[role] !== label)
      .map(([, role, label]) => `${role}: roster "${label}" vs labels "${AGENT_LABELS[role]}"`);
    expect(disagree).toEqual([]);
  });
});
