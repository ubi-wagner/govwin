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

  // ── Capture / pipeline ──────────────────────────────────────────────
  'topic.pinned': 'Opportunity pinned',
  'topic.unpinned': 'Opportunity unpinned',
  'opportunity.pinned': 'Opportunity pinned',
  'opportunity.unpinned': 'Opportunity unpinned',
  'profile.updated': 'Company profile updated',
  'process.force_advanced': 'Process advanced',

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
    if (sectionId && (ev.type === 'section.saved' || ev.type === 'section.exported' || ev.type === 'comment.created')) {
      return `${base}/proposals/${proposalId}/sections/${sectionId}`;
    }
    return `${base}/proposals/${proposalId}`;
  }
  if (ev.type.startsWith('topic.') || ev.type.startsWith('opportunity.')) {
    return opportunityId ? `${base}/spotlights/${opportunityId}` : `${base}/spotlights`;
  }
  if (ev.type === 'file.uploaded' || ev.type.startsWith('document.') || ev.type === 'atom.saved') {
    return `${base}/library`;
  }
  if (ev.type === 'profile.updated') return `${base}/profile`;
  return null;
}

/** Phases that represent a completed/atomic action (skip noisy `start` rows). */
export function isNotifyWorthyPhase(phase: string | null | undefined): boolean {
  return phase === 'single' || phase === 'end' || phase == null;
}
