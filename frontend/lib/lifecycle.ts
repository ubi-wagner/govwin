/**
 * Canonical opportunity submission lifecycle (Tranche 1, mig 100).
 *
 * SIX states: nofo → pre_release → open ⇄ updated → closed → archived, with
 * reopen (closed/archived → open) and un-archive. `submission_stage` on the master
 * opportunity and the tenant card is the SOURCE OF TRUTH; `lifecycle_status`
 * (open/closed/archived) + `is_active` are the COARSE projection that existing feed
 * and ranking filters rely on — keep them in sync via coarseStatus()/isActiveStage().
 * A lifecycle change on a released opp fans out to every tenant card using the bridge
 * event from eventTypeForStage().
 */

export const SUBMISSION_STAGES = ['nofo', 'pre_release', 'open', 'updated', 'closed', 'archived'] as const;
export type SubmissionStage = (typeof SUBMISSION_STAGES)[number];

/** Bridge event union — defined here and re-exported by lib/opportunity-bridge.ts. */
export type BridgeEventType = 'published' | 'updated' | 'closed' | 'reopened' | 'awarded' | 'archived';

export const STAGE_LABEL: Record<SubmissionStage, string> = {
  nofo: 'NOFO',
  pre_release: 'Pre-Release',
  open: 'Open',
  updated: 'Updated',
  closed: 'Closed',
  archived: 'Archived',
};

/** Admin-driven allowed transitions (from → [to…]). */
const TRANSITIONS: Record<SubmissionStage, readonly SubmissionStage[]> = {
  nofo: ['pre_release', 'open', 'archived'],
  pre_release: ['open', 'closed', 'archived'],
  open: ['updated', 'closed', 'archived'],
  updated: ['open', 'closed', 'archived'],
  closed: ['open', 'archived'], // reopen
  archived: ['open'], // un-archive
};

export function isSubmissionStage(v: unknown): v is SubmissionStage {
  return typeof v === 'string' && (SUBMISSION_STAGES as readonly string[]).includes(v);
}

export function canTransition(from: SubmissionStage, to: SubmissionStage): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: SubmissionStage): SubmissionStage[] {
  return [...TRANSITIONS[from]];
}

/** Coarse projection existing feed/ranking filters use (lifecycle_status/is_active). */
export function coarseStatus(stage: SubmissionStage): 'open' | 'closed' | 'archived' {
  if (stage === 'closed') return 'closed';
  if (stage === 'archived') return 'archived';
  return 'open'; // nofo / pre_release / open / updated are all customer-visible "open"
}

/** Whether the customer feed should show this stage (drives is_active). */
export function isActiveStage(stage: SubmissionStage): boolean {
  return coarseStatus(stage) === 'open';
}

/** The forward-only bridge event to emit when a RELEASED opp moves from → to. */
export function eventTypeForStage(from: SubmissionStage, to: SubmissionStage): BridgeEventType {
  if (to === 'closed') return 'closed';
  if (to === 'archived') return 'archived';
  if (to === 'open' && (from === 'closed' || from === 'archived')) return 'reopened';
  return 'updated'; // updated, pre_release↔open amendments, close-date changes, etc.
}
