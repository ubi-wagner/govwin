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
  // ── The project namespace (migs 216–223) ──────────────────────────────────────────────────
  // EVERY type this sandbox has emitted under `project`, joined the same way the list above was
  // built. Nine of them had no label when the bell was opened to the namespace — they would have
  // reached a customer's feed as "Comment posted" and "Review rejected", which is not wrong so
  // much as it is nobody's sentence, and in the rejection's case it drops the one thing a reader
  // needs: the reason.
  ['project', 'project.created'],
  ['project', 'project.closed'],
  ['project', 'project.reopened'],
  ['project', 'source_document.uploaded'],
  ['project', 'clin.created'],
  ['project', 'baseline.set'],
  ['project', 'milestone.met'],
  ['project', 'milestone.rescheduled'],
  ['project', 'milestone.overdue'],
  ['project', 'milestone.dependency_set'],
  ['project', 'task.completed'],
  ['project', 'task.blocked'],
  ['project', 'task.overdue'],
  ['project', 'task.reassigned'],
  ['project', 'task.rescheduled'],
  ['project', 'task.reference_attached'],
  ['project', 'task.reference_removed'],
  ['project', 'deliverable.uploaded'],
  ['project', 'deliverable.authored'],
  ['project', 'deliverable.accepted'],
  ['project', 'comment.posted'],
  ['project', 'comment.resolved'],
  ['project', 'comment.reopened'],
  ['project', 'comment.edited'],
  ['project', 'review.requested'],
  ['project', 'review.approved'],
  ['project', 'review.rejected'],
  ['project', 'review.withdrawn'],
  ['project', 'nudge_sweep.completed'],
  ['project', 'acceptance_evidence.filed'],
];

describe('events a customer sees carry a written label', () => {
  for (const [namespace, type] of CUSTOMER_VISIBLE) {
    it(`${type} is not shown as "${fallback(type)}"`, () => {
      const label = describeEvent({ namespace, type, phase: 'single', payload: {} });
      expect(label).not.toBe(fallback(type));
      expect(label.length).toBeGreaterThan(0);
    });
  }

  it('a REJECTED review puts the reason in the row, not behind a click', () => {
    // The one project case where the wording is the point. A feed row saying "Review rejected"
    // sends the reader hunting for the single thing that tells them what to change.
    const label = describeEvent({
      namespace: 'project', type: 'review.rejected', phase: 'single',
      payload: { reason: 'Section 3 cites the wrong CLIN.' },
    });
    expect(label).toContain('Section 3 cites the wrong CLIN.');
  });

  it('a handed-over task says WHO it went to', () => {
    const label = describeEvent({
      namespace: 'project', type: 'task.reassigned', phase: 'single',
      payload: { title: 'CDR slide package', to: 'dana@acme.test' },
    });
    expect(label).toContain('CDR slide package');
    expect(label, '"a task was reassigned" makes a reader open the project to learn anything')
      .toContain('dana@acme.test');
  });

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
