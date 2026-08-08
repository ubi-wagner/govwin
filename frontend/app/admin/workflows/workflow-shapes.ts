// ─────────────────────────────────────────────────────────────────────────────
// Workflow shape catalog — the DESIGNED step-DAG of every workflow the pipeline
// registers, mirrored here so the admin console can VISUALISE each template
// (and overlay live run status onto it).
//
// Why a code-defined mirror: the step DAG lives only in the Python `Workflow`
// classes (pipeline/src/workflows/*). The `process_templates` catalog the boot
// sync writes carries name/trigger/source/active but NO step structure
// (db/migrations/054), and the sync only runs inside the full pipeline boot.
// So drawing a template's flow is a frontend concern; this file is its source.
// It is kept 1:1 with the Python registry (29 templates, verified file:line) and
// keyed by the SAME workflow_name the engine writes to process_instances, so a
// live instance's step_status overlays straight onto these nodes.
// ─────────────────────────────────────────────────────────────────────────────

import type { GraphNode, GraphEdge, StepKind, StepRunStatus } from './workflow-graph';

/** The two lifecycle spines (discovery/finder · build/capture) + the cross-cutting platform lane. */
export type Spine = 'discovery' | 'build' | 'platform';

export interface StepDef {
  name: string;
  kind: StepKind; // ACTION | AI_INVOKE | NOTIFY | TODO | HITL_WAIT (API_CALL/CONDITION unused today)
  dependsOn?: string; // single parent (the Python Step.depends_on is one optional string)
}

export interface WorkflowShape {
  workflowName: string; // === process_instances.workflow_name
  title: string;
  spine: Spine;
  trigger: string; // full trigger key "namespace:type:phase"
  launch: 'event' | 'imperative' | 'scheduled';
  description: string;
  steps: StepDef[];
}

export const SPINES: { key: Spine; title: string; blurb: string }[] = [
  {
    key: 'discovery',
    title: 'Discovery spine (finder)',
    blurb:
      'Our-org / platform side: ingest a solicitation, QA the curation, fan every activated opportunity onto the bridge, and rescore each tenant’s cards.',
  },
  {
    key: 'build',
    title: 'Build spine (capture)',
    blurb:
      'Customer side: onboard, draft V0, run the Draft-Manager / Studio loops and the adversarial overlay, advance through review to a submission package, then harvest the outcome.',
  },
  {
    key: 'platform',
    title: 'Platform & scheduled',
    blurb:
      'Cross-cutting admin automations: the CMS content vertical plus the cron-fired ops digest, social scheduler, and content resurfacing.',
  },
];

// ── The 29 templates ─────────────────────────────────────────────────────────

export const WORKFLOW_SHAPES: WorkflowShape[] = [
  // ── Discovery spine (finder) ───────────────────────────────────────────────
  {
    workflowName: 'OnRfpUploaded',
    title: 'RFP Uploaded',
    spine: 'discovery',
    trigger: 'finder:rfp.uploaded:end',
    launch: 'event',
    description: 'Shred an uploaded RFP, stage the compliance matrix + skeleton, and notify the curator.',
    steps: [
      { name: 'shred_document', kind: 'ACTION' },
      { name: 'extract_compliance', kind: 'ACTION', dependsOn: 'shred_document' },
      { name: 'ai_ingest_analyst', kind: 'AI_INVOKE', dependsOn: 'shred_document' },
      { name: 'ai_matrix_stager', kind: 'AI_INVOKE', dependsOn: 'extract_compliance' },
      { name: 'ai_skeleton_architect', kind: 'AI_INVOKE', dependsOn: 'extract_compliance' },
      { name: 'notify_curator', kind: 'NOTIFY' },
    ],
  },
  {
    workflowName: 'OnOpportunitiesDetected',
    title: 'Opportunities Detected',
    spine: 'discovery',
    trigger: 'finder:opportunities.detected:single',
    launch: 'event',
    description: 'When a scouting/ingest run detects new opportunities, email the RFP admin and park a triage ToDo.',
    steps: [
      { name: 'ai_opportunity_scout', kind: 'AI_INVOKE' },
      { name: 'notify_rfp_admin', kind: 'NOTIFY' },
      { name: 'triage_todo', kind: 'TODO', dependsOn: 'notify_rfp_admin' },
    ],
  },
  {
    workflowName: 'OnSourceChangeDetected',
    title: 'Source Change Detected',
    spine: 'discovery',
    trigger: 'finder:source.change_detected:single',
    launch: 'event',
    description: 'When Source Scout sees meaningful site changes, draft solicitations and park an admin review gate.',
    steps: [
      { name: 'ai_amendment_monitor', kind: 'AI_INVOKE' },
      { name: 'create_draft_solicitations', kind: 'ACTION' },
      { name: 'notify_rfp_admin', kind: 'NOTIFY', dependsOn: 'create_draft_solicitations' },
      { name: 'wait_for_admin_review', kind: 'TODO', dependsOn: 'notify_rfp_admin' },
    ],
  },
  {
    workflowName: 'OnSolicitationPushed',
    title: 'Solicitation Pushed',
    spine: 'discovery',
    trigger: 'finder:solicitation.pushed:single',
    launch: 'event',
    description: 'Fan a newly-activated solicitation to matching tenants and send the Spotlight digest.',
    steps: [
      { name: 'find_matching_tenants', kind: 'ACTION' },
      { name: 'send_spotlight_digest', kind: 'NOTIFY', dependsOn: 'find_matching_tenants' },
    ],
  },
  {
    workflowName: 'OnSolicitationReviewRequested',
    title: 'Curation Review Requested',
    spine: 'discovery',
    trigger: 'finder:solicitation.triaged:end',
    launch: 'event',
    description: 'Run an advisory pre-release QA pass when a curation is submitted for review.',
    steps: [
      { name: 'ai_curation_qa', kind: 'AI_INVOKE' },
      { name: 'notify_reviewer', kind: 'NOTIFY' },
    ],
  },
  {
    workflowName: 'OnIngestAssessmentRequested',
    title: 'Ingest Assessment Requested',
    spine: 'discovery',
    trigger: 'finder:ingest.assessment_requested:end',
    launch: 'event',
    description: 'Run the advisory ingest-orchestration manager when an admin requests an ingest assessment.',
    steps: [
      { name: 'ai_ingest_manager', kind: 'AI_INVOKE' },
      { name: 'notify_admin', kind: 'NOTIFY' },
    ],
  },
  {
    workflowName: 'OnCardApplied',
    title: 'Card Applied (rescore)',
    spine: 'discovery',
    trigger: 'capture:card.applied:single',
    launch: 'event',
    description: 'Rescore a tenant’s card against their buckets when it lands in their mirror.',
    steps: [{ name: 'rescore_card', kind: 'ACTION' }],
  },
  {
    workflowName: 'OnBucketsUpdated',
    title: 'Buckets Updated (rescore)',
    spine: 'discovery',
    trigger: 'capture:buckets.updated:single',
    launch: 'event',
    description: 'Rescore all of a tenant’s open cards when they change their OPP list / buckets.',
    steps: [{ name: 'rescore_all', kind: 'ACTION' }],
  },
  {
    workflowName: 'OnSolicitationUpdateScan',
    title: 'Solicitation Update Scan',
    spine: 'discovery',
    trigger: 'finder:solicitation.update_scan_requested:single',
    launch: 'scheduled',
    description: 'Cron (≈6h): proactively re-scan active solicitations for compliance-affecting amendments.',
    steps: [
      { name: 'ai_amendment_scan', kind: 'AI_INVOKE' },
      { name: 'notify_admin', kind: 'NOTIFY' },
    ],
  },

  // ── Build spine (capture) ──────────────────────────────────────────────────
  {
    workflowName: 'OnApplicationAccepted',
    title: 'Application Accepted (onboard)',
    spine: 'build',
    trigger: 'capture:application.accepted:end',
    launch: 'event',
    description: 'Onboard a new tenant after acceptance; wait (HITL) for their first login.',
    steps: [
      { name: 'ai_onboarding_concierge', kind: 'AI_INVOKE' },
      { name: 'schedule_login_reminder', kind: 'HITL_WAIT' },
    ],
  },
  {
    workflowName: 'OnProposalCreated',
    title: 'Proposal Created (draft V0)',
    spine: 'build',
    trigger: 'proposal:proposal.created:end',
    launch: 'event',
    description: 'On provision: capture cohort (architect / strategy / cost / PP match / seed) + draft V0, then notify the admin review.',
    steps: [
      { name: 'architect_review', kind: 'AI_INVOKE' },
      { name: 'ai_capture_strategy', kind: 'AI_INVOKE' },
      { name: 'ai_cost_estimator', kind: 'AI_INVOKE' },
      { name: 'ai_pp_matcher', kind: 'AI_INVOKE' },
      { name: 'library_seed_suggest', kind: 'AI_INVOKE' },
      { name: 'draft_sections', kind: 'ACTION' },
      { name: 'notify_admin_review', kind: 'NOTIFY', dependsOn: 'draft_sections' },
    ],
  },
  {
    workflowName: 'OnProposalAdvancedToReview',
    title: 'Advanced → Review',
    spine: 'build',
    trigger: 'proposal:proposal.advanced:end',
    launch: 'event',
    description: 'Run the AI compliance review when a proposal enters review, then park the reviewer gate.',
    steps: [
      { name: 'ai_compliance_review', kind: 'AI_INVOKE' },
      { name: 'notify_reviewers', kind: 'NOTIFY' },
      { name: 'wait_for_review', kind: 'TODO', dependsOn: 'notify_reviewers' },
    ],
  },
  {
    workflowName: 'OnProposalAdvancedToFinal',
    title: 'Advanced → Final',
    spine: 'build',
    trigger: 'proposal:proposal.advanced:end',
    launch: 'event',
    description: 'At final stage: package review, generate the export preview, and notify all collaborators.',
    steps: [
      { name: 'ai_package_review', kind: 'AI_INVOKE' },
      { name: 'generate_export_preview', kind: 'ACTION' },
      { name: 'notify_all_collaborators', kind: 'NOTIFY', dependsOn: 'generate_export_preview' },
    ],
  },
  {
    workflowName: 'OnFullDraftRequestedModeA',
    title: 'Full Draft · Mode A (HITL)',
    spine: 'build',
    trigger: 'proposal:proposal.full_draft_requested:end',
    launch: 'imperative',
    description: 'V0.1 human-controlled: plan → seed → draft, landing at a staged human review.',
    steps: [
      { name: 'plan_draft', kind: 'AI_INVOKE' },
      { name: 'seed_suggest', kind: 'AI_INVOKE' },
      { name: 'draft_sections', kind: 'AI_INVOKE', dependsOn: 'seed_suggest' },
      { name: 'stage_review', kind: 'TODO' },
    ],
  },
  {
    workflowName: 'OnFullDraftRequestedModeB',
    title: 'Full Draft · Mode B (restyle)',
    spine: 'build',
    trigger: 'proposal:proposal.full_draft_requested:end',
    launch: 'imperative',
    description: 'V0.2 controlled restyle + reformat; the lock sets the house style.',
    steps: [
      { name: 'plan_draft', kind: 'AI_INVOKE' },
      { name: 'restyle', kind: 'AI_INVOKE' },
      { name: 'reformat', kind: 'AI_INVOKE', dependsOn: 'restyle' },
      { name: 'lock_review', kind: 'TODO' },
    ],
  },
  {
    workflowName: 'OnFullDraftRequestedModeC',
    title: 'Full Draft · Mode C (full auto)',
    spine: 'build',
    trigger: 'proposal:proposal.full_draft_requested:end',
    launch: 'imperative',
    description: 'V0.5 full auto: per-section draft → reformat → restyle → package, the G-gate cohort, then the review gate.',
    steps: [
      { name: 'plan_draft', kind: 'AI_INVOKE' },
      { name: 'seed_suggest', kind: 'AI_INVOKE' },
      { name: 'draft_sections', kind: 'AI_INVOKE', dependsOn: 'seed_suggest' },
      { name: 'reformat', kind: 'AI_INVOKE', dependsOn: 'draft_sections' },
      { name: 'restyle', kind: 'AI_INVOKE', dependsOn: 'reformat' },
      { name: 'cost_estimate', kind: 'AI_INVOKE' },
      { name: 'package', kind: 'AI_INVOKE', dependsOn: 'restyle' },
      { name: 'gate_continuity', kind: 'AI_INVOKE', dependsOn: 'package' },
      { name: 'gate_traceability', kind: 'AI_INVOKE', dependsOn: 'package' },
      { name: 'gate_redaction', kind: 'AI_INVOKE', dependsOn: 'package' },
      { name: 'request_overlay', kind: 'ACTION' },
      { name: 'review_gate', kind: 'TODO' },
    ],
  },
  {
    workflowName: 'OnReviewPhaseRequestedDraft',
    title: 'Studio · Draft',
    spine: 'build',
    trigger: 'proposal:review_phase.requested:end',
    launch: 'imperative',
    description: 'Studio phase 1 (Draft): plan + seed + draft all sections, then advance the phase.',
    steps: [
      { name: 'plan_draft', kind: 'AI_INVOKE' },
      { name: 'seed_suggest', kind: 'AI_INVOKE' },
      { name: 'draft_sections', kind: 'AI_INVOKE', dependsOn: 'seed_suggest' },
      { name: 'advance_phase', kind: 'ACTION' },
    ],
  },
  {
    workflowName: 'OnReviewPhaseRequestedRefine',
    title: 'Studio · Refine',
    spine: 'build',
    trigger: 'proposal:review_phase.requested:end',
    launch: 'imperative',
    description: 'Studio phase 2 (Refine): reformat + restyle + cost + package, then advance.',
    steps: [
      { name: 'reformat', kind: 'AI_INVOKE' },
      { name: 'restyle', kind: 'AI_INVOKE', dependsOn: 'reformat' },
      { name: 'cost_estimate', kind: 'AI_INVOKE' },
      { name: 'package', kind: 'AI_INVOKE', dependsOn: 'restyle' },
      { name: 'advance_phase', kind: 'ACTION' },
    ],
  },
  {
    workflowName: 'OnReviewPhaseRequestedCompliance',
    title: 'Studio · Compliance',
    spine: 'build',
    trigger: 'proposal:review_phase.requested:end',
    launch: 'imperative',
    description: 'Studio phase 3 (Compliance): compliance + continuity + traceability + redaction, then advance.',
    steps: [
      { name: 'check_compliance', kind: 'AI_INVOKE' },
      { name: 'check_continuity', kind: 'AI_INVOKE' },
      { name: 'audit_traceability', kind: 'AI_INVOKE' },
      { name: 'scan_redaction', kind: 'AI_INVOKE' },
      { name: 'advance_phase', kind: 'ACTION' },
    ],
  },
  {
    workflowName: 'AdvisoryOverlay',
    title: 'Advisory Overlay (HITL)',
    spine: 'build',
    trigger: 'proposal:proposal.advisory_overlay_requested:end',
    launch: 'imperative',
    description: 'Adversarial gate: pre-augment → 1:n fan-out → reconcile → land at a HITL review.',
    steps: [
      { name: 'pre_augment', kind: 'AI_INVOKE' },
      { name: 'fanout_0', kind: 'AI_INVOKE' },
      { name: 'fanout_1', kind: 'AI_INVOKE' },
      { name: 'fanout_2', kind: 'AI_INVOKE' },
      { name: 'reconcile', kind: 'AI_INVOKE', dependsOn: 'fanout_0' },
      { name: 'land_review', kind: 'TODO' },
    ],
  },
  {
    workflowName: 'AdvisoryOverlayAuto',
    title: 'Advisory Overlay (auto)',
    spine: 'build',
    trigger: 'proposal:proposal.advisory_overlay_requested:end',
    launch: 'imperative',
    description: 'Adversarial gate (auto policy): pre-augment → fan-out → reconcile → advisory record, no gate.',
    steps: [
      { name: 'pre_augment', kind: 'AI_INVOKE' },
      { name: 'fanout_0', kind: 'AI_INVOKE' },
      { name: 'fanout_1', kind: 'AI_INVOKE' },
      { name: 'fanout_2', kind: 'AI_INVOKE' },
      { name: 'reconcile', kind: 'AI_INVOKE', dependsOn: 'fanout_0' },
      { name: 'record_auto', kind: 'ACTION' },
    ],
  },
  {
    workflowName: 'OnCollaboratorInvited',
    title: 'Collaborator Invited',
    spine: 'build',
    trigger: 'proposal:collaborator.invited:end',
    launch: 'event',
    description: 'Draft a partner welcome for admin review when a collaborator is invited.',
    steps: [
      { name: 'ai_partner_welcome', kind: 'AI_INVOKE' },
      { name: 'notify_admin_partner_draft', kind: 'NOTIFY' },
    ],
  },
  {
    workflowName: 'OnProposalOutcomeRecorded',
    title: 'Outcome Recorded (harvest)',
    spine: 'build',
    trigger: 'proposal:outcome.recorded:end',
    launch: 'event',
    description: 'On win/loss: attribute the outcome and run the harvest→resurface analysis.',
    steps: [
      { name: 'attribute_outcome', kind: 'ACTION' },
      { name: 'ai_outcome_analysis', kind: 'AI_INVOKE' },
    ],
  },
  {
    workflowName: 'OnProposalSectionEdited',
    title: 'Section Edited (diff)',
    spine: 'build',
    trigger: 'proposal:section.saved:single',
    launch: 'event',
    description: 'Run the DiffAnalyzer when a human saves a proposal section.',
    steps: [{ name: 'analyze_diff', kind: 'ACTION' }],
  },
  {
    workflowName: 'ProjectCollaboration',
    title: 'Project Collaboration (generic gate)',
    spine: 'build',
    trigger: 'proposal:project.collaboration_requested:single',
    launch: 'imperative',
    description: 'The generic, payload-parameterized HITL gate: park one human ToDo (assignee · nudges · due), resume on completion, then notify. Backs the 72h curation gate, color-team review, and any one-off review gate.',
    steps: [
      { name: 'collaborate', kind: 'TODO' },
      { name: 'notify_done', kind: 'NOTIFY', dependsOn: 'collaborate' },
    ],
  },

  // ── Platform & scheduled ───────────────────────────────────────────────────
  {
    workflowName: 'OnCmsContentRequested',
    title: 'CMS Content Requested',
    spine: 'platform',
    trigger: 'library:content.requested:single',
    launch: 'imperative',
    description: 'CMS content vertical: AI drafts a content version → park at a human review ToDo → publish on approval → notify.',
    steps: [
      { name: 'ai_content_generate', kind: 'AI_INVOKE' },
      { name: 'draft_content', kind: 'ACTION' },
      { name: 'review', kind: 'TODO', dependsOn: 'draft_content' },
      { name: 'publish_content', kind: 'ACTION', dependsOn: 'review' },
      { name: 'notify_author', kind: 'NOTIFY', dependsOn: 'publish_content' },
    ],
  },
  {
    workflowName: 'OnOpsDigestRequested',
    title: 'Ops Digest',
    spine: 'platform',
    trigger: 'system:ops.digest_requested:single',
    launch: 'scheduled',
    description: 'Cron: compile + deliver the ops-health digest to master_admin.',
    steps: [
      { name: 'ai_ops_digest', kind: 'AI_INVOKE' },
      { name: 'notify_master_admin', kind: 'NOTIFY' },
    ],
  },
  {
    workflowName: 'OnSocialScheduleRequested',
    title: 'Social Schedule',
    spine: 'platform',
    trigger: 'system:social.schedule_requested:single',
    launch: 'scheduled',
    description: 'Cron: draft a week of social posts from published content, emailed for approval.',
    steps: [
      { name: 'ai_social_schedule', kind: 'AI_INVOKE' },
      { name: 'email_social_queue', kind: 'NOTIFY' },
    ],
  },
  {
    workflowName: 'OnContentResurfaceRequested',
    title: 'Content Resurface',
    spine: 'platform',
    trigger: 'library:content.resurface_requested:single',
    launch: 'scheduled',
    description: 'Cron: curate crawler content findings into reshare drafts, emailed for approval.',
    steps: [
      { name: 'ai_content_curate', kind: 'AI_INVOKE' },
      { name: 'email_curation', kind: 'NOTIFY' },
    ],
  },
];

export const SHAPE_BY_NAME: Record<string, WorkflowShape> = Object.fromEntries(
  WORKFLOW_SHAPES.map((s) => [s.workflowName, s]),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "shred_document" → "shred document" */
export function prettyStep(name: string): string {
  return name.replace(/_/g, ' ');
}

/** Short, human trigger label: the type segment of namespace:type:phase. */
export function triggerType(trigger: string): string {
  const parts = trigger.split(':');
  return parts.length >= 2 ? parts[1] : trigger;
}

/** Map a process_instances.step_status value onto the graph's run-status vocabulary. */
export function mapStepStatus(v: string | undefined | null): StepRunStatus {
  switch (v) {
    case 'completed':
    case 'done':
    case 'succeeded':
      return 'done';
    case 'running':
    case 'in_progress':
    case 'active':
      return 'running';
    case 'failed':
    case 'error':
      return 'failed';
    case 'paused':
    case 'waiting':
    case 'parked':
    case 'blocked':
      return 'paused';
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}

/**
 * Turn a shape into a {nodes, edges} graph for <WorkflowGraph>, injecting a
 * TRIGGER node (→ every root step) and an END node (← every leaf step). When
 * `live` opts are supplied, per-step status is overlaid from an instance's
 * step_status map (+ the instance status colours the END node).
 */
export function buildGraph(
  shape: WorkflowShape,
  opts?: { statusByStep?: Record<string, string>; instanceStatus?: string; live?: boolean },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const TRIG = '__trigger';
  const END = '__end';
  const live = !!opts?.live;
  const st = opts?.statusByStep ?? {};

  const isParent = new Set<string>();
  for (const s of shape.steps) if (s.dependsOn) isParent.add(s.dependsOn);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({
    id: TRIG,
    label: shape.launch === 'scheduled' ? `⏱ ${triggerType(shape.trigger)}` : triggerType(shape.trigger),
    kind: 'TRIGGER',
    sublabel: shape.trigger,
    status: live ? 'done' : undefined,
  });

  for (const s of shape.steps) {
    nodes.push({
      id: s.name,
      label: prettyStep(s.name),
      kind: s.kind,
      status: live ? mapStepStatus(st[s.name]) : undefined,
    });
    edges.push({ from: s.dependsOn ?? TRIG, to: s.name });
  }

  const leaves = shape.steps.filter((s) => !isParent.has(s.name));
  const endStatus: StepRunStatus = live
    ? opts?.instanceStatus === 'completed'
      ? 'done'
      : opts?.instanceStatus === 'failed'
        ? 'failed'
        : 'pending'
    : undefined;
  nodes.push({ id: END, label: 'complete', kind: 'END', status: endStatus });
  for (const l of leaves) edges.push({ from: l.name, to: END });

  return { nodes, edges };
}

/**
 * Fallback graph for a live instance whose workflow_name has no registered
 * shape (future templates): a simple chain derived from its step_status keys,
 * ordered by `order` if provided (else insertion order).
 */
export function buildGraphFromStatus(
  workflowName: string,
  stepStatus: Record<string, string>,
  instanceStatus?: string,
  order?: string[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const known = SHAPE_BY_NAME[workflowName];
  if (known) return buildGraph(known, { statusByStep: stepStatus, instanceStatus, live: true });

  const names = order && order.length ? order : Object.keys(stepStatus);
  const TRIG = '__trigger';
  const END = '__end';
  const nodes: GraphNode[] = [{ id: TRIG, label: 'trigger', kind: 'TRIGGER', status: 'done' }];
  const edges: GraphEdge[] = [];
  let prev = TRIG;
  for (const n of names) {
    nodes.push({ id: n, label: prettyStep(n), kind: 'ACTION', status: mapStepStatus(stepStatus[n]) });
    edges.push({ from: prev, to: n });
    prev = n;
  }
  nodes.push({
    id: END,
    label: 'complete',
    kind: 'END',
    status: instanceStatus === 'completed' ? 'done' : instanceStatus === 'failed' ? 'failed' : 'pending',
  });
  edges.push({ from: prev, to: END });
  return { nodes, edges };
}
