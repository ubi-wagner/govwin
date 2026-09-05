/**
 * "Who did this" is a name, never an identifier.
 *
 * The activity stream rendered `actorEmail ?? actorId ?? actorType ?? 'unknown'` — one line below
 * the `describeEvent` call that had already been fixed for exactly this reason. The sentences were
 * English; the name beside them was a UUID, or `workflow_manager`.
 *
 * The rule these tests hold: whatever `describeActor` returns as a `label` is safe to put in front
 * of a customer. The raw identifier survives in `title`, where support can still read it.
 */
import { describe, it, expect } from 'vitest';
import { describeActor } from '@/lib/event-labels';

const UUID = 'bd101904-582d-44db-ac2e-ce63eb341979';

describe('describeActor — the label is never an identifier', () => {
  it('prefers a resolved person over anything else', () => {
    expect(describeActor({ actorName: 'Kate Ulepic', actorEmail: 'k@x.com', actorId: UUID, actorType: 'user' }))
      .toEqual({ label: 'Kate Ulepic', title: 'k@x.com' });
  });

  it('falls back to the email, which is still a person', () => {
    expect(describeActor({ actorEmail: 'k@x.com', actorId: UUID, actorType: 'user' }).label).toBe('k@x.com');
  });

  it('THE DEFECT: an unresolved UUID becomes "A team member", never the UUID', () => {
    const r = describeActor({ actorId: UUID, actorType: 'user' });
    expect(r.label).toBe('A team member');
    expect(r.label).not.toContain(UUID);
    // …and the id is kept where support can still find it.
    expect(r.title).toBe(UUID);
  });

  it('THE DEFECT: a system token becomes English', () => {
    expect(describeActor({ actorId: 'workflow_manager', actorType: 'system' }).label).toBe('Workflow automation');
    expect(describeActor({ actorId: 'lifecycle_scheduler', actorType: 'system' }).label).toBe('Scheduled job');
    expect(describeActor({ actorId: 'fabric', actorType: 'agent' }).label).toBe('Agent workforce');
  });

  it('an UNMAPPED token is humanized, not echoed — a new actor is never a token', () => {
    const r = describeActor({ actorId: 'some_new_daemon', actorType: 'system' });
    expect(r.label).toBe('Some new daemon');
    expect(r.label).not.toMatch(/_/);
  });

  it('an ingest source names itself the way a person writes it', () => {
    expect(describeActor({ actorId: 'ingest:sbir_gov', actorType: 'pipeline' }).label).toBe('SBIR.GOV ingest');
  });

  it('with nothing at all it says Unknown rather than inventing a person', () => {
    expect(describeActor({}).label).toBe('Unknown');
    expect(describeActor({ actorType: 'system' }).label).toBe('Automation');
  });

  it('THE PROPERTY: no input produces a label containing a UUID or an underscore', () => {
    const inputs = [
      { actorId: UUID, actorType: 'user' }, { actorId: UUID, actorType: 'system' },
      { actorId: UUID }, { actorId: 'weird_thing_here' }, { actorId: 'ingest:dsip' },
      { actorType: 'pipeline' }, {}, { actorId: '', actorEmail: '' },
    ];
    for (const i of inputs) {
      const { label } = describeActor(i);
      expect(label, JSON.stringify(i)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(label, JSON.stringify(i)).not.toMatch(/_/);
    }
  });
});
