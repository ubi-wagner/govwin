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
  // The per-section edit ToDo raised when a section is assigned (SPINE-T1). Deep-links to the section
  // editor (taskHref 'section' case); auto-completes when the section is locked. First-class so it never
  // falls to the broadcast default — its params.kind='review' already drives the completer.
  edit_section: {
    key: 'edit_section',
    name: 'Edit section',
    description: 'Draft & edit your assigned section on the canvas, then it locks.',
    side: 'tenant',
    steps: ['Open section', 'Draft & edit', 'Save', 'Accept & Lock'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human', 'engine'],
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
  // Full-draft program (OnFullDraftRequested Mode A/B/C) — the staged workforce output lands at a
  // tenant review gate. Each is a real approve/continue gate, not a bare acknowledge.
  proposal_draft_stage_review: {
    key: 'proposal_draft_stage_review',
    name: 'Full draft — stage review',
    description: 'Review the staged full-draft output (Mode A / HITL) and continue.',
    side: 'tenant',
    steps: ['Auto-draft', 'Review', 'Continue'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'agent'],
  },
  proposal_style_lock_review: {
    key: 'proposal_style_lock_review',
    name: 'Full draft — style lock',
    description: 'Review the restyled draft (Mode B) and lock the style.',
    side: 'tenant',
    steps: ['Restyle', 'Review', 'Lock'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'agent'],
  },
  proposal_full_draft_review: {
    key: 'proposal_full_draft_review',
    name: 'Full draft — final review',
    description: 'Review the full auto-drafted proposal (Mode C) and accept.',
    side: 'tenant',
    steps: ['Auto-draft', 'Review', 'Accept'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'agent'],
  },
  advisory_overlay_review: {
    key: 'advisory_overlay_review',
    name: 'Advisory review',
    description: 'Review the adversarial advisory overlay findings and reconcile.',
    side: 'tenant',
    steps: ['Advisory run', 'Review', 'Reconcile'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'agent'],
  },
  vault_artifact_review: {
    key: 'vault_artifact_review',
    name: 'Vault artifact review',
    description: 'A collaborator uploaded an artifact — review and accept it into the vault.',
    side: 'tenant',
    steps: ['Uploaded', 'Review', 'Accept'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human', 'engine'],
  },
  starter_set_offer: {
    key: 'starter_set_offer',
    name: 'Starter library offer',
    description: 'A starter library set is available — review and accept it.',
    side: 'tenant',
    steps: ['Offered', 'Review', 'Accept'],
    actionStep: 1,
    completer: 'acknowledge',
    producedBy: ['engine'],
  },
  final_due: {
    key: 'final_due',
    name: 'Final deadline',
    description: 'A submission deadline is approaching — prepare and submit.',
    side: 'tenant',
    steps: ['Scheduled', 'Prepare', 'Submit'],
    actionStep: 1,
    completer: 'acknowledge',
    producedBy: ['engine'],
  },
  // Portal build stage ToDos (createStageTodos → portal-workflow.ts). Their params.kind overrides
  // these defaults per-stage, but a catalog entry keeps them off the broadcast floor.
  complete_sections: {
    key: 'complete_sections',
    name: 'Complete sections',
    description: 'Draft the required sections for this portal stage.',
    side: 'tenant',
    steps: ['Assigned', 'Draft', 'Mark done'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine'],
  },
  upload_documents: {
    key: 'upload_documents',
    name: 'Upload documents',
    description: 'Provide the required documents for this portal stage.',
    side: 'tenant',
    steps: ['Requested', 'Upload', 'Provided'],
    actionStep: 1,
    completer: 'upload',
    producedBy: ['engine'],
  },
  acknowledge: {
    key: 'acknowledge',
    name: 'Acknowledge',
    description: 'Read and acknowledge a portal-stage note.',
    side: 'tenant',
    steps: ['Read', 'Acknowledge'],
    actionStep: 1,
    completer: 'acknowledge',
    producedBy: ['engine'],
  },
  // Generic pre-staged review gate (automation prestage-todos → literal task_type 'review').
  review: {
    key: 'review',
    name: 'Review gate',
    description: 'A pre-staged review gate — review and advance.',
    side: 'both',
    steps: ['Staged', 'Review', 'Advance'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['automation', 'engine'],
  },
  // Partner-manager access request — the company admin approves/declines from the Team page
  // (completeTask routes it there; this entry gives the queue the right label + steps).
  manager_request: {
    key: 'manager_request',
    name: 'Manager access request',
    description: 'A partner manager requested to manage this company — approve or decline on the Team page.',
    side: 'tenant',
    steps: ['Requested', 'Review', 'Approve / decline'],
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
  content_publish: {
    key: 'content_publish',
    name: 'Content review & publish',
    description: 'Review a drafted site-content version and publish it (opens in the Content Studio).',
    side: 'admin',
    steps: ['Draft', 'Review', 'Publish'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine'],
  },
  triage_new_opportunities: {
    key: 'triage_new_opportunities',
    name: 'Triage new opportunities',
    description: 'Review newly detected opportunities and triage them.',
    side: 'admin',
    steps: ['Detected', 'Review', 'Triage'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine', 'agent'],
  },
  source_review: {
    key: 'source_review',
    name: 'Source change review',
    description: 'Review a detected source/solicitation change and confirm the update.',
    side: 'admin',
    steps: ['Change detected', 'Review diff', 'Confirm'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['engine'],
  },
  partner_registration_triage: {
    key: 'partner_registration_triage',
    name: 'Partner registration triage',
    description: 'Review a partner-org registration request and decide.',
    side: 'admin',
    steps: ['Requested', 'Review', 'Decide'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human'],
  },
  application_triage: {
    key: 'application_triage',
    name: 'Application triage',
    description: 'Review a new customer application and decide.',
    side: 'admin',
    steps: ['Applied', 'Review', 'Decide'],
    actionStep: 1,
    completer: 'review',
    producedBy: ['human', 'automation'],
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
