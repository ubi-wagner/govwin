/**
 * Task → workflow catalog (#101).
 *
 * INVARIANT: every ToDo is a step in a DEFINED workflow. A task's `task_type`
 * names the workflow it belongs to; this catalog is the single source of truth
 * for that workflow's human name, its ordered steps, and how the step in the
 * queue is completed. Even the smallest job — "review, edit & lock this section"
 * — is a named micro-workflow here, not a loose one-off.
 *
 * The floor is `broadcast`: a catch-all "note" workflow whose only step is to be
 * read and acknowledged (accept-on-read — the most atomic ToDo there is). Any
 * `task_type` with no explicit entry resolves to it, so a ToDo can NEVER be
 * orphaned from a workflow — `resolveTaskWorkflow` always returns a definition.
 *
 * Pure + dependency-free (only the CompleterKind type) so it is safe to import
 * from server components, client components, and unit tests alike.
 */
import type { CompleterKind } from '@/lib/tasks/completers';

/** Which side of the OPP bridge a workflow runs on (for grouping/labels). */
export type WorkflowSide = 'tenant' | 'admin' | 'both';

/**
 * Who can PRODUCE a ToDo for this workflow. Today most are `human` (a manager
 * delegates) or `engine` (the pipeline workflow parks a HITL step). `automation`
 * (event-trigger rules, #107) and `agent` (the AgentFabric processors) are
 * declared here now so those producers slot into the same catalog when they land
 * — an automated or agent-created ToDo is still a step in a defined workflow.
 */
export type WorkflowProducer = 'human' | 'engine' | 'automation' | 'agent';

export interface TaskWorkflowDef {
  /** Canonical key — matches `tasks.task_type`. */
  key: string;
  /** Human name of the workflow this ToDo is a step in. */
  name: string;
  /** One line: what completing this workflow accomplishes. */
  description: string;
  /** Which portal surfaces it. */
  side: WorkflowSide;
  /** Ordered steps; the ToDo is the human-gated one (see `actionStep`). */
  steps: string[];
  /** Index (0-based) of the step the ToDo itself represents — the one bolded. */
  actionStep: number;
  /** Default completer for the ToDo (a task's `params.kind` still overrides). */
  completer: CompleterKind;
  /** Who can create this ToDo (foundational hook for automation + agents). */
  producedBy: WorkflowProducer[];
}

/**
 * The atomic floor: a broadcast note. One human step — read it, acknowledge it.
 * Every unknown `task_type` collapses to this so no ToDo is workflow-less.
 */
export const BROADCAST_WORKFLOW: TaskWorkflowDef = {
  key: 'broadcast',
  name: 'Broadcast note',
  description: 'A note to read and acknowledge — the most atomic ToDo.',
  side: 'both',
  steps: ['Read', 'Acknowledge'],
  actionStep: 1,
  completer: 'acknowledge',
  producedBy: ['human', 'engine', 'automation', 'agent'],
};

/**
 * Defined workflows keyed by `task_type`. Add a row here when a new kind of ToDo
 * enters the system so it renders with real steps instead of collapsing to a
 * broadcast note. Keep steps short and verb-first — they render as a trail.
 */
export const TASK_WORKFLOWS: Record<string, TaskWorkflowDef> = {
  // ── Customer (tenant) side ────────────────────────────────────────────────
  review_section: {
    key: 'review_section',
    name: 'Section review & lock',
    description: 'Bring one section to a locked, compliant final.',
    side: 'tenant',
    steps: ['Draft', 'Review', 'Edit on canvas', 'Accept & Lock'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human', 'engine', 'agent'],
  },
  proposal_setup: {
    key: 'proposal_setup',
    name: 'Proposal setup',
    description: 'Curate a purchased portal and release the build to the customer.',
    side: 'admin',
    steps: ['Purchase', 'Curate & release', 'Draft sections', 'Review'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human', 'engine'],
  },
  proposal_build: {
    key: 'proposal_build',
    name: 'Proposal build',
    description: 'Draft every section from the library, then review and lock.',
    side: 'tenant',
    steps: ['Provisioned', 'Draft sections', 'Review', 'Lock & export'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human', 'engine', 'agent'],
  },
  contract_kickoff: {
    key: 'contract_kickoff',
    name: 'Contract kickoff',
    description: 'Acknowledge an award and start post-award execution.',
    side: 'tenant',
    steps: ['Award', 'Assign owner', 'Kickoff'],
    actionStep: 2,
    completer: 'review',
    producedBy: ['engine', 'automation'],
  },
  document_request: {
    key: 'document_request',
    name: 'Provide a document',
    description: 'Upload a required document into the workspace.',
    side: 'both',
    steps: ['Requested', 'Open workspace', 'Upload', 'Mark provided'],
    actionStep: 2,
    completer: 'upload',
    producedBy: ['human', 'engine', 'automation'],
  },
  intake_form: {
    key: 'intake_form',
    name: 'Intake form',
    description: 'Capture the requested details on a short form.',
    side: 'both',
    steps: ['Requested', 'Fill fields', 'Submit'],
    actionStep: 1,
    completer: 'form',
    producedBy: ['human', 'engine'],
  },
  delegated_task: {
    key: 'delegated_task',
    name: 'Delegated task',
    description: 'A job a manager handed off to a teammate.',
    side: 'both',
    steps: ['Assigned', 'Do the work', 'Mark done'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human'],
  },

  // ── RFP-admin side ────────────────────────────────────────────────────────
  admin_review: {
    key: 'admin_review',
    name: 'Admin triage',
    description: 'Review an item and record a decision.',
    side: 'admin',
    steps: ['Detected', 'Review', 'Decide'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'automation', 'agent'],
  },
  proposal_review: {
    key: 'proposal_review',
    name: 'Proposal compliance review',
    description: 'Check a proposal against the solicitation and advance it.',
    side: 'both',
    steps: ['Compliance check', 'Review findings', 'Advance stage'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'agent'],
  },
  curation_release: {
    key: 'curation_release',
    name: 'Curate & release',
    description: 'Curate the compliance skeleton and release the build.',
    side: 'admin',
    steps: ['Purchased', 'Curate matrix', 'Release portal'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'automation'],
  },

  // ── The atomic floor (also addressable by key) ────────────────────────────
  broadcast: BROADCAST_WORKFLOW,
};

/**
 * Resolve the workflow a ToDo belongs to. NEVER returns undefined: an unmapped
 * `task_type` resolves to the broadcast (acknowledge-on-read) floor, so the
 * "every ToDo is part of a defined workflow" invariant always holds.
 */
export function resolveTaskWorkflow(taskType: string | null | undefined): TaskWorkflowDef {
  const key = (taskType ?? '').trim();
  return TASK_WORKFLOWS[key] ?? BROADCAST_WORKFLOW;
}

/** All defined workflows, de-duplicated (broadcast appears once), for docs/registry UIs. */
export const TASK_WORKFLOW_LIST: TaskWorkflowDef[] = Array.from(
  new Map(Object.values(TASK_WORKFLOWS).map((w) => [w.key, w])).values(),
);
