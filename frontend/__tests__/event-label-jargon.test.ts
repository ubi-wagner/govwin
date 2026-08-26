/**
 * THE CUSTOMER'S ACTIVITY FEED SHOULD NOT SPEAK THE SYSTEM'S OWN VOCABULARY.
 *
 * `describeEvent()` humanises an unrecognised type by de-punctuating it, so a missing label never
 * looks like a bug: the feed is populated, the words are English, and the row reads "Shadow
 * descended". That is the internal name for an RFP administrator entering a customer's account
 * through the RLS shadow — deliberately recorded under the customer's `tenant_id` because, as the
 * emit site says, "the event belongs to the customer's audit trail". So the company that bought a
 * proposal portal was being told, in their own audit log, that a shadow descended.
 *
 * Found by joining the DISTINCT event types the database has actually emitted with a non-null
 * `tenant_id` against the labels this file defines — not by reading the code, which is why it
 * survived: nothing about a humanised fallback looks wrong at a glance.
 *
 * The guard below is deliberately not a list of expected strings — that only re-asserts what was
 * typed. It asserts the PROPERTY: for these types, the label must not be the fallback.
 */
import { describe, it, expect } from 'vitest';
import { describeEvent } from '@/lib/event-labels';

/** The fallback `describeEvent` produces for a type it does not recognise. */
const fallback = (type: string) => {
  const w = type.replace(/[._]/g, ' ').trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

// Every one of these was observed in this sandbox's `system_events` with a real tenant_id.
const CUSTOMER_VISIBLE: Array<[string, string]> = [
  ['identity', 'shadow.descended'],
  ['identity', 'shadow.ascended'],
  ['capture', 'card.applied'],
  ['capture', 'card.scored'],
  ['capture', 'tenant.rescored'],
  ['capture', 'buckets.updated'],
  ['capture', 'bucket.deactivated'],
  ['capture', 'workspace.released'],
  ['proposal', 'review_todos.prestaged'],
  ['proposal', 'proposal.full_draft_requested'],
  ['proposal', 'proposal.advisory_overlay_requested'],
  ['proposal', 'proposal.advisory_overlay_reconciled'],
  ['system', 'workflow.instance_created'],
];

describe('events a customer sees carry a written label', () => {
  for (const [namespace, type] of CUSTOMER_VISIBLE) {
    it(`${type} is not shown as "${fallback(type)}"`, () => {
      const label = describeEvent({ namespace, type, phase: 'single', payload: {} });
      expect(label).not.toBe(fallback(type));
      expect(label.length).toBeGreaterThan(0);
    });
  }

  it('the shadow descent explains itself in the customer\'s terms', () => {
    // The one case where the wording, not just its presence, is the point: this row is the
    // customer's only notice that someone from the vendor was in their account.
    const label = describeEvent({ namespace: 'identity', type: 'shadow.descended', phase: 'single', payload: {} });
    expect(label.toLowerCase()).not.toContain('shadow');
    expect(label.toLowerCase()).toContain('administrator');
  });

  it('still falls back for a type nobody has labelled', () => {
    // The fallback is correct behaviour and must survive — this guards the guard.
    const label = describeEvent({ namespace: 'library', type: 'widget.frobnicated', phase: 'single', payload: {} });
    expect(label).toBe('Widget frobnicated');
  });
});
