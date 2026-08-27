/**
 * Canonical event label + deep-link map for customer-facing audit surfaces.
 *
 * IMPORTANT: emitted `type` strings ALREADY contain the entity prefix
 * (e.g. `proposal.advanced`, `file.uploaded`, `comment.created`). Earlier
 * consumers keyed on `${namespace}.${type}` → `proposal.proposal.advanced`,
 * which never matched, so audit rows rendered raw type strings. Everything
 * here keys on `type` (and `phase` where it disambiguates) and reads the
 * payload fields the routes actually emit.
 *
 * Used by: the activity stream, the notification bell, the notifications API,
 * the dashboard recent-activity card, and the proposal timeline — one source
 * of truth so a fix lands everywhere.
 */

export interface EventLike {
  namespace: string;
  type: string;
  phase?: string | null;
  payload?: Record<string, unknown> | null;
  durationMs?: number | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Title-case a raw `entity.verb_past` type as a last-resort label. */
function humanizeType(type: string): string {
  const words = type.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Explicit labels for the customer-relevant taxonomy. Values are either a
 * string or a fn of the payload (to fold in titles, stage names, etc.).
 */
const LABELS: Record<string, string | ((p: Record<string, unknown>) => string)> = {
  // ── Proposal lifecycle ──────────────────────────────────────────────
  'proposal.created': (p) => `Proposal created${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'proposal.advanced': (p) =>
    `Proposal advanced to ${str(p.targetStage) ?? str(p.toStage) ?? str(p.stage) ?? 'the next stage'}`,
  'proposal.stage_advanced': (p) =>
    `Proposal advanced to ${str(p.targetStage) ?? str(p.toStage) ?? str(p.stage) ?? 'the next stage'}`,
  'proposal.advance_ready': 'All sections locked — ready to advance',

  // ── Internal terms that were reaching a CUSTOMER's Activity feed ────
  //
  // `describeEvent` falls back to de-punctuating the raw type, which never looks broken and so
  // never got noticed: these arrived as "Shadow descended", "Card applied", "Review todos
  // prestaged", "Workflow instance created". Every one is a term from the system's own vocabulary
  // — the shadow account, the bridge card, the process instance — shown to the company that bought
  // a proposal portal. The events are deliberately tenant-scoped (shadow-transition's own comment
  // says the event "belongs to the customer's audit trail"), so the fix is the wording, not the
  // scope. Found by joining what the DB has actually emitted under a tenant_id against this map.
  'shadow.descended': 'An RFP administrator opened your workspace to assist',
  'shadow.ascended': 'An RFP administrator left your workspace',
  'card.applied': 'Opportunity added to your board',
  'card.scored': 'Opportunity ranked against your buckets',
  'tenant.rescored': 'Opportunities re-ranked against your buckets',
  'buckets.updated': 'Spotlight buckets updated',
  'bucket.deactivated': 'Spotlight bucket deactivated',
  'review_todos.prestaged': 'Review to-dos prepared for this stage',
  'workflow.instance_created': 'Workflow started',
  'workspace.released': 'Proposal workspace released to your team',
  'proposal.advisory_overlay_requested': 'AI review panel requested',
  'proposal.advisory_overlay_reconciled': 'AI review panel findings reconciled',
  'proposal.full_draft_requested': 'Full AI draft requested',
  'document.locked': (p) =>
    `Document complete & locked${str(p.volumeName) ? `: ${str(p.volumeName)}` : ''}`,
  'proposal.locked': 'Proposal locked for admin review',
  'proposal.unlocked': 'Proposal unlocked for editing',
  'proposal.ready_for_customer': 'Proposal ready for your input',
  'proposal.review_requested': 'AI review requested',
  'proposal.draft_requested': 'AI drafting requested',
  'proposal.dropbox_file_uploaded': 'File uploaded to proposal dropbox',
  'proposal.dropbox_file_deleted': 'File removed from proposal dropbox',

  // ── Sections / content ──────────────────────────────────────────────
  'section.saved': (p) => `Section saved${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'section.exported': 'Section exported',
  'section.locked': (p) => `Section accepted & locked${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'section.unlocked': (p) => `Section reopened${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'section.harvested': 'Accepted content saved to library',
  'section.assigned': (p) => str(p.assigneeUserId) ? `Section assigned${str(p.sectionTitle) ? `: ${str(p.sectionTitle)}` : ''}` : `Section unassigned${str(p.sectionTitle) ? `: ${str(p.sectionTitle)}` : ''}`,

  // ── Collaboration ───────────────────────────────────────────────────
  'comment.created': 'Comment added',
  'comment.resolved': 'Comment resolved',
  'collaborator.invited': 'Collaborator invited',
  'collaborator.access_revoked': 'Collaborator access revoked',
  'team_member.invited': 'Team member invited',

  // ── Reviews / outcomes ──────────────────────────────────────────────
  'compliance.checked': 'Compliance checked',
  'review.created': 'Review recorded',
  'outcome.recorded': (p) => `Outcome recorded${str(p.outcome) ? `: ${str(p.outcome)}` : ''}`,
  'package.export_started': 'Proposal package export started',

  // ── Library ─────────────────────────────────────────────────────────
  'file.uploaded': 'File uploaded to library',
  'document.atomized': 'Document atomized into library',
  'document.reatomized': 'Document re-atomized',
  'atom.saved': 'Library atom saved',
  'atom.retagged': 'Library atom retagged',

  // ── Capture / pipeline ──────────────────────────────────────────────
  'topic.pinned': 'Opportunity pinned',
  'topic.unpinned': 'Opportunity unpinned',
  'opportunity.pinned': 'Opportunity pinned',
  'opportunity.unpinned': 'Opportunity unpinned',
  'opportunity.closed': (p) => `Opportunity closed${str(p.title) ? `: ${str(p.title)}` : ''}`,
  // Admin pin-for-updates (RANK-8): a watched opp changed → holders hear about it pre-purchase.
  'opportunity.updated': (p) => `Opportunity updated${str(p.title) ? `: ${str(p.title)}` : ''}`,
  // Provisioning (PV-2): the master OPP build-out was completed + broadcast to all mirror cards.
  'opportunity.build_completed': (p) => {
    const n = typeof p.cardsRefreshed === 'number' ? p.cardsRefreshed : null;
    return `OPP build-out completed${n != null ? ` — ${n} tenant card${n === 1 ? '' : 's'} refreshed` : ''}`;
  },
  // Pre-purchase start nudge (RANK-9): a hot, closing-soon opp the customer hasn't started yet.
  'opportunity.start_recommended': (p) => {
    const t = str(p.title); const d = p.daysToClose;
    const tail = typeof d === 'number' ? ` — closes in ${d}d` : '';
    return `Recommended: start a proposal${t ? ` on ${t}` : ''}${tail}`;
  },
  // Command Center read-receipt: the user cleared the "new" items in a lane (mig 179).
  'command.acknowledged': (p) => {
    const names: Record<string, string> = { opp: 'Opportunities', todos: 'To-dos', workflows: 'Workflows', activity: 'Activity', admin: 'Admin', tenant: 'Tenant', system: 'System' };
    const t = str(p.tab);
    return `Reviewed the ${t && names[t] ? names[t] : 'Command Center'} lane`;
  },
  'opportunity.reopened': (p) => `Opportunity reopened${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'opportunity.archived': (p) => `Opportunity archived${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'opportunity.close_date_changed': (p) => `Opportunity close date changed${str(p.newCloseDate) ? ` to ${str(p.newCloseDate)}` : ''}`,
  'profile.updated': 'Company profile updated',
  'process.force_advanced': 'Process advanced',
  // Tenant Workflow Setup (TW): the required one-time accept + later re-configuration of a portal's workflow.
  'workflow.accepted': (p) => `Build workflow set up & started${typeof p.stages === 'number' ? ` (${p.stages} phase${p.stages === 1 ? '' : 's'})` : ''}`,
  'workflow.reconfigured': 'Build workflow updated',
  'task.reassigned': (p) => `To-do reassigned${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'task.rescheduled': (p) => `To-do rescheduled${str(p.title) ? `: ${str(p.title)}` : ''}`,
  // TW-8: the AI-manager stage gate — the cohort is requested on stage entry, then completes.
  'stage_review.requested': 'AI review started for the stage',
  'stage_review.completed': (p) => `AI review complete${str(p.verdict) ? ` — ${str(p.verdict)}` : ''}`,
  'stage_review.advanced': 'AI manager advanced the stage',

  // ── Gates / compliance setup ────────────────────────────────────────
  'gate_requirement.created': 'Gate requirement added',
  'gate_requirement.toggled': 'Gate requirement updated',
  'supporting_doc.deleted': 'Supporting document removed',

  // ── Identity ────────────────────────────────────────────────────────
  'user.logged_in': 'Signed in',
  'password.reset_requested': 'Password reset requested',
  'password.reset_completed': 'Password reset completed',
  'user.password_changed': 'Password changed',
};

/**
 * Human-readable label for an event. Handles the AI-tool and closed-loop
 * system/email/notification namespaces, then the explicit map, then a
 * humanized fallback (never the raw `namespace.type` double-prefix).
 */
export function describeEvent(ev: EventLike): string {
  const { namespace, type, phase } = ev;
  const payload = ev.payload ?? {};

  // AI tool invocations
  if (namespace === 'tool') {
    if (phase === 'start') return `AI tool started: ${humanizeType(type)}`;
    if (phase === 'end') {
      const ms = ev.durationMs;
      return `AI tool completed${typeof ms === 'number' ? ` (${(ms / 1000).toFixed(1)}s)` : ''}`;
    }
  }

  // Post-award projects (migration 217). EVERY type here needs a case, or it reaches a customer's
  // Activity feed as a de-punctuated identifier — which is B136 ("Shadow descended") happening
  // again in a new namespace. The fallback humanizer produces "clin created", which is not wrong
  // so much as it is nobody's sentence.
  if (namespace === 'project') {
    const project = str(payload.name) ?? 'the project workspace';
    switch (type) {
      case 'project.created':
        return `Project workspace opened: ${project}`;
      case 'source_document.uploaded': {
        const kind = payload.kind === 'executed_contract' ? 'Executed contract' : 'As-submitted proposal';
        return `${kind} uploaded${str(payload.filename) ? ` — ${str(payload.filename)}` : ''}`;
      }
      case 'clin.created':
        return `CLIN ${str(payload.clinNumber) ?? ''} added${str(payload.title) ? ` — ${str(payload.title)}` : ''}`.trim();
      case 'baseline.set':
        return phase === 'start' ? 'Freezing the contract baseline' : 'Contract baseline set';
      case 'project.rebaselined':
        return phase === 'start' ? 'Rebaselining the project plan' : 'Project plan rebaselined';
      case 'milestone.due':
        return `Milestone due: ${str(payload.title) ?? 'a milestone'}`;
      case 'milestone.met': {
        // The completion RECORD, not just the fact. "Milestone met" six months later tells a
        // reader nothing; the variance and the note are why anyone opens the feed.
        const what = str(payload.title) ?? 'a milestone';
        const v = typeof payload.varianceDays === 'number' ? payload.varianceDays : null;
        const when = v === null || v === 0 ? ''
          : v > 0 ? ` — ${v} day${v === 1 ? '' : 's'} late` : ` — ${-v} day${v === -1 ? '' : 's'} early`;
        const note = str(payload.note);
        return `Milestone met: ${what}${when}${note ? ` · ${note}` : ''}`;
      }
      case 'milestone.rescheduled': {
        const what = str(payload.title) ?? 'a milestone';
        const d = typeof payload.deltaDays === 'number' ? payload.deltaDays : null;
        const by = d === null || d === 0 ? ''
          : d > 0 ? ` — pushed out ${d} day${d === 1 ? '' : 's'}` : ` — pulled in ${-d} day${d === -1 ? '' : 's'}`;
        const also = typeof payload.cascaded === 'number' && payload.cascaded > 0
          ? `, and ${payload.cascaded} later milestone${payload.cascaded === 1 ? '' : 's'} with it` : '';
        return `Milestone rescheduled: ${what}${by}${also}`;
      }
      case 'milestone.due_soon':
        return `Milestone due ${str(payload.dueOn) ?? 'soon'}: ${str(payload.title) ?? 'a milestone'}`;
      case 'milestone.overdue': {
        const late = typeof payload.daysLate === 'number' ? payload.daysLate : null;
        return `Milestone overdue${late ? ` by ${late} day${late === 1 ? '' : 's'}` : ''}: `
          + `${str(payload.title) ?? 'a milestone'}`;
      }
      case 'project.closed': {
        const n = typeof payload.milestones === 'number' ? payload.milestones : null;
        const note = str(payload.note);
        return `Project closed out${n ? ` — ${n} milestone${n === 1 ? '' : 's'}` : ''}`
          + `${note ? ` · ${note}` : ''}`;
      }
      case 'project.reopened':
        return `Project reopened${str(payload.reason) ? ` — ${str(payload.reason)}` : ''}`;
      case 'task.completed':
        return `Task done: ${str(payload.title) ?? 'a task'}`;
      case 'task.blocked':
        return `Task blocked: ${str(payload.title) ?? 'a task'}`
          + `${str(payload.reason) ? ` — ${str(payload.reason)}` : ''}`;
      case 'task.reopened':
        return `Task reopened: ${str(payload.title) ?? 'a task'}`;
      case 'task.due_soon':
        return `Task due ${str(payload.dueOn) ?? 'soon'}: ${str(payload.title) ?? 'a task'}`;
      case 'task.overdue': {
        const late = typeof payload.daysLate === 'number' ? payload.daysLate : null;
        return `Task overdue${late ? ` by ${late} day${late === 1 ? '' : 's'}` : ''}: `
          + `${str(payload.title) ?? 'a task'}`;
      }
      case 'deliverable.uploaded':
        return `Deliverable uploaded: ${str(payload.title) ?? str(payload.filename) ?? 'a deliverable'}`;
      case 'deliverable.authored':
        return `Deliverable drafted in-product: ${str(payload.title) ?? 'a document'}`
          + `${str(payload.preset) ? ` (${str(payload.preset)})` : ''}`;
      case 'deliverable.accepted':
        return `Deliverable accepted: ${str(payload.title) ?? 'a deliverable'}`;
      default:
        break;
    }
  }

  // Closed-loop system events (email/notification delivery, failures)
  if (namespace === 'system') {
    if (type === 'content_pipeline.post.publish_completed') {
      const title = str(payload.title) ?? str(payload.slug) ?? 'post';
      return `Blog post "${title}" published`;
    }
    if (type === 'content_pipeline.post.unpublish_completed') {
      return `Blog post "${str(payload.slug) ?? 'post'}" unpublished`;
    }
    const status = payload.status === 'sent' ? 'sent' : 'failed';
    const recipient = str(payload.recipientEmail) ?? 'recipient';
    if (type === 'email.delivery_completed' || type === 'email.admin_notification_completed') {
      return `Email ${status} to ${recipient}`;
    }
    if (type === 'email.invite_delivered') return `Invite email ${status} to ${recipient}`;
    if (type === 'email.team_invite_delivered') return `Team invite email ${status} to ${recipient}`;
    if (type === 'email.admin_alert_delivered') {
      const count = Number(payload.adminsNotified ?? 0);
      return `Admin alert sent (${count} admin${count === 1 ? '' : 's'} notified)`;
    }
    if (type === 'notification.delivered') return `Notification delivered to ${recipient}`;
    if (type === 'notification.bounced') {
      // The hard/soft distinction is the whole content of this event for a reader: one means the
      // address is dead and will not be mailed again, the other means try tomorrow.
      return payload.hard
        ? `Notification hard-bounced for ${recipient} — address suppressed`
        : `Notification soft-bounced for ${recipient} — will be retried`;
    }
    if (type === 'notification.complained') {
      return `${recipient} marked a notification as spam — address suppressed`;
    }
    if (type === 'notification.delivery_failed') return `Notification failed for ${recipient}`;
    if (type.endsWith('.failed')) {
      const action = str(payload.actionType) ?? humanizeType(type);
      const err = str(payload.error);
      return `Action failed: ${action}${err ? ` — ${err}` : ''}`;
    }
  }

  const entry = LABELS[type];
  if (typeof entry === 'function') return entry(payload);
  if (typeof entry === 'string') return entry;
  return humanizeType(type);
}

/**
 * Deep-link target for an event row, or null if there's no natural source.
 * Uses the IDs the routes already put in the payload.
 */
export function eventHref(tenantSlug: string, ev: EventLike): string | null {
  const p = ev.payload ?? {};
  const base = `/portal/${tenantSlug}`;
  const proposalId = str(p.proposalId) ?? str(p.proposal_id);
  const sectionId = str(p.sectionId) ?? str(p.section_id) ?? str(p.nodeId);
  const opportunityId = str(p.opportunityId) ?? str(p.opportunity_id) ?? str(p.topicId);

  if (proposalId) {
    const sectionEvents = ['section.saved', 'section.exported', 'section.locked', 'section.unlocked', 'comment.created', 'section.assigned'];
    if (sectionId && sectionEvents.includes(ev.type)) {
      return `${base}/proposals/${proposalId}/sections/${sectionId}`;
    }
    return `${base}/proposals/${proposalId}`;
  }
  if (ev.type.startsWith('topic.') || ev.type.startsWith('opportunity.')) {
    // /spotlights and /spotlights/[id] are RETIRED redirect stubs, and the detail stub redirects to
    // /cards WITHOUT the id — so an opportunity notification landed on the generic list instead of
    // the item it was about. Point at the live surface directly and keep the id.
    return opportunityId ? `${base}/cards?opp=${opportunityId}` : `${base}/cards`;
  }
  if (ev.type === 'file.uploaded' || ev.type.startsWith('document.') || ev.type === 'atom.saved') {
    return `${base}/atoms`; // /library is a retired stub that redirects here
  }
  if (ev.type === 'profile.updated') return `${base}/profile`;
  return null;
}

/** Phases that represent a completed/atomic action (skip noisy `start` rows). */
export function isNotifyWorthyPhase(phase: string | null | undefined): boolean {
  return phase === 'single' || phase === 'end' || phase == null;
}
