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
  // ── THE SAME GAP, MEASURED RATHER THAN GUESSED (2026-08-31) ────────
  //
  // The block below was written from the same join, run again over EVERY (namespace, type) that
  // has actually reached a row carrying a tenant_id: 115 types, of which 38 had no sentence and
  // between them accounted for over 2,300 rows in customers' Activity feeds. They read as
  // "agent invoked", "memory stored", "template applied", "task assigned" — the platform's own
  // vocabulary, de-punctuated, shown to the company that bought a proposal portal.
  //
  // Two rules held throughout. Say what HAPPENED to them, not what the system did internally
  // ("Your library learned from this" beats "memory stored"). And where the payload carries the
  // thing a person would ask about next — the title, the format, whether it was compliant, who it
  // went to — put it in the sentence, because a label that omits it sends the reader to expand a
  // JSON blob to answer an obvious question.

  // Agent + memory. A customer does not care that an archetype was dispatched; they care that
  // their assistant did something, and whether it worked.
  'agent.invoked': (p) => {
    const who = str(p.archetype)?.replace(/_/g, ' ');
    const failed = str(p.status) === 'error' || !!str(p.error);
    const blocked = str(p.guardrail) === 'blocked';
    if (blocked) return `AI assistant held back${who ? ` (${who})` : ''} — a guardrail stopped it`;
    if (failed) return `AI assistant could not finish${who ? ` (${who})` : ''}`;
    return `AI assistant ran${who ? `: ${who}` : ''}`;
  },
  'agent.dispatch': (p) => `AI assistant queued${str(p.archetype) ? `: ${String(p.archetype).replace(/_/g, ' ')}` : ''}`,
  'memory.stored': 'Your workspace learned from this session',
  'memory.outcome_attributed': (p) =>
    `Win/loss fed back into your library${str(p.outcome) ? ` — ${str(p.outcome)}` : ''}`,
  'memory.pattern_promoted': (p) => {
    const n = typeof p.patternsPromoted === 'number' ? p.patternsPromoted : null;
    return `${n === null ? 'Recurring patterns' : `${n} recurring pattern${n === 1 ? '' : 's'}`} promoted into your library`;
  },
  'memory.preferences_extracted': 'Your team\u2019s drafting preferences updated',

  // Library + documents. "Exported" without the format or the compliance verdict is the row a
  // person has to click to understand, and the verdict is the whole point of the export gate.
  'document.created': (p) => `Document created${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'document.updated': (p) => `Document saved${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'document.exported': (p) => {
    const fmt = str(p.format)?.toUpperCase();
    const bad = typeof p.complianceViolations === 'number' ? p.complianceViolations : null;
    return `Document downloaded${fmt ? ` as ${fmt}` : ''}`
      + (bad && bad > 0 ? ` \u2014 ${bad} compliance issue${bad === 1 ? '' : 's'} flagged` : '');
  },
  'template.applied': 'Template applied to your workspace',
  'starter_set.added': (p) => {
    const n = typeof p.added === 'number' ? p.added : null;
    return `Starter library added${n === null ? '' : ` \u2014 ${n} item${n === 1 ? '' : 's'}`}`;
  },
  'atom.curated': 'Library item reviewed',
  'atom.archived': 'Library item archived',
  'atom.restored': 'Library item restored',

  // Proposal lifecycle. These are the customer's own build, so they are the rows most likely to be
  // read closely — and the ones where internal wording is most jarring.
  'artifact.exported': (p) => {
    const fmt = str(p.format)?.toUpperCase();
    const bad = typeof p.complianceViolations === 'number' ? p.complianceViolations : null;
    return `Volume downloaded${fmt ? ` as ${fmt}` : ''}`
      + (bad && bad > 0 ? ` \u2014 ${bad} compliance issue${bad === 1 ? '' : 's'} flagged` : '');
  },
  'artifact.locked': (p) => {
    const n = typeof p.sectionCount === 'number' ? p.sectionCount : null;
    return `Submission package locked${n === null ? '' : ` \u2014 ${n} section${n === 1 ? '' : 's'}`}`;
  },
  'compliance.checked': 'Section checked against the solicitation\u2019s rules',
  // `sectionTitle` is what the save route emits; `title` is accepted too because other section
  // events in this map use it and a label should not go blank over which key an emitter chose.
  'section.saved': (p) => {
    const t = str(p.sectionTitle) ?? str(p.title);
    return `Section saved${t ? `: ${t}` : ''}`;
  },
  'preview.generated': 'Preview generated',
  'draft.completed': (p) => {
    // The interesting half is what did NOT get drafted, and why. "Draft completed" over a run that
    // skipped every section is the most misleading row this feed can show.
    const d = typeof p.drafted === 'number' ? p.drafted : null;
    const held = typeof p.held === 'number' ? p.held : 0;
    const skipped = typeof p.skipped === 'number' ? p.skipped : 0;
    return `AI draft finished${d === null ? '' : ` \u2014 ${d} section${d === 1 ? '' : 's'} drafted`}`
      + (held ? `, ${held} held for review` : '') + (skipped ? `, ${skipped} skipped` : '');
  },
  'collaborator.invited': (p) => `Collaborator invited${str(p.email) ? `: ${str(p.email)}` : ''}`,
  'outcome.recorded': (p) => `Outcome recorded${str(p.outcome) ? `: ${str(p.outcome)}` : ''}`,
  'outcome.attributed': (p) => `Outcome credited back to your library${str(p.outcome) ? ` \u2014 ${str(p.outcome)}` : ''}`,
  'amendment.acknowledged': 'Amendment acknowledged',
  'amendment.flagged': (p) => {
    const n = typeof p.proposalCount === 'number' ? p.proposalCount : null;
    return `Solicitation amended${n === null ? '' : ` \u2014 ${n} build${n === 1 ? '' : 's'} affected`}`;
  },
  'project.collaboration_requested': 'Help requested on this work',

  // Capture: purchase, portal, contract. The moments a customer remembers.
  'purchase.completed': (p) =>
    p.comp ? 'Proposal portal granted' : 'Proposal portal purchased',
  'portal.stage_advanced': 'Build advanced to the next stage',
  'opportunity.pursuit_set': (p) => {
    const st = str(p.status);
    return st === 'passed' ? 'Opportunity passed on'
         : st === 'pursuing' ? 'Opportunity marked as pursuing'
         : st === 'monitoring' ? 'Opportunity flagged to watch'
         : 'Opportunity decision recorded';
  },
  'contract.started': (p) => `Contract started${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'tenant.cards_backfilled': (p) => {
    const n = typeof p.cardsBackfilled === 'number' ? p.cardsBackfilled : null;
    return `Opportunity board filled in${n === null ? '' : ` \u2014 ${n} opportunit${n === 1 ? 'y' : 'ies'}`}`;
  },

  // System: tasks, nudges, mail. "task.created" is a to-do landing in somebody's queue.
  // Lifting a suppression re-opens sending to an address a provider called dead. It is a
  // deliberate, auditable act by a named administrator, so it reads as one.
  'email.suppression_lifted': (p) =>
    `Mail re-enabled for ${str(p.email) ?? 'an address'}`,
  'task.created': 'A to-do was raised',
  'task.assigned': (p) => `To-do assigned${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'task.completed': (p) => `To-do completed${str(p.disposition) ? ` (${str(p.disposition)})` : ''}`,
  'task.nudge': (p) => `Reminder sent${str(p.title) ? ` about \u201c${str(p.title)}\u201d` : ''}`,
  'notification.requested': (p) => `Email sent${str(p.template) ? ` (${String(p.template).replace(/_/g, ' ')})` : ''}`,
  'workflow.wait_timed_out': (p) =>
    `Automation stopped waiting${str(p.workflow_name) ? ` \u2014 ${String(p.workflow_name).replace(/_/g, ' ')}` : ''}`,

  'shadow.descended': 'An RFP administrator opened your workspace to assist',
  'shadow.ascended': 'An RFP administrator left your workspace',

  // ── The partner-manager family — the SAME gap, found by drive-oversight-surfaces ────
  //
  // `finder:partner.entered` reached a customer's Activity feed as "Partner entered": B136 again,
  // in a namespace the earlier sweep did not cover. It is the partner analogue of
  // `shadow.descended` and deserves the same plainness — somebody outside this company opened its
  // workspace, and that is the single most important line in a customer's audit trail.
  //
  // The drive found ONE because one is all that has fired. The other four are tenant-scoped in
  // code (verified at each emit site: portal team/managers routes, manager-request, and the
  // application accept all pass a real `tenantId`), so each is the identical finding waiting for
  // its first row. Wording follows what the product already calls these people to the customer —
  // team-invite-form.tsx: "a Manager is an existing partner organization you grant admin-level
  // access to build on your behalf."
  //
  // ⚠️ ASYMMETRY, DELIBERATELY LEFT: `partner.exited` is emitted with `tenantId: null` (it happens
  // in the partner console, which is not in any tenant's scope), so a customer sees the entry and
  // never the departure. That is a scope question, not a wording one, and it is not fixed here —
  // recorded so the next reader finds it stated rather than rediscovering it.
  'partner.entered': 'A manager from your partner organization opened your workspace',
  'partner.manager_granted': 'Manager access granted to a partner organization',
  'partner.manager_revoked': 'Manager access revoked from a partner organization',
  'partner.manager_requested': 'A partner organization requested manager access',
  'partner.company_registered': 'Your company was registered by a partner organization',
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
  // 'section.saved' is defined above, reading `sectionTitle` — the key the save route actually
  // emits. The version that used to sit here read `p.title`, which is never present, so every row
  // rendered the bare "Section saved".
  'section.exported': 'Section exported',
  'section.locked': (p) => `Section accepted & locked${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'section.unlocked': (p) => `Section reopened${str(p.title) ? `: ${str(p.title)}` : ''}`,
  'section.harvested': 'Accepted content saved to library',
  'section.assigned': (p) => str(p.assigneeUserId) ? `Section assigned${str(p.sectionTitle) ? `: ${str(p.sectionTitle)}` : ''}` : `Section unassigned${str(p.sectionTitle) ? `: ${str(p.sectionTitle)}` : ''}`,

  // ── Collaboration ───────────────────────────────────────────────────
  'comment.created': 'Comment added',
  'comment.resolved': 'Comment resolved',
  // 'collaborator.invited' is defined above, and names WHO was invited.
  'collaborator.access_revoked': 'Collaborator access revoked',
  'team_member.invited': 'Team member invited',

  // ── Reviews / outcomes ──────────────────────────────────────────────
  // 'compliance.checked' is defined above, and says what was checked against what.
  'review.created': 'Review recorded',
  // 'outcome.recorded' is defined above (identical shape).
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
/**
 * The written sentence for an event, or NULL when nobody has written one.
 *
 * `describeEvent` wraps this and falls back to the humanizer, which is right for rendering — a row
 * must always say something. But "it rendered something" and "somebody wrote a sentence for this"
 * are different claims, and only this function can tell them apart. Two earlier attempts to answer
 * it from the outside both failed: comparing the output against the de-punctuated type
 * over-reported (an empty payload collapses every optional suffix, and a good label can
 * legitimately read the same as the humanized form), and checking membership of the LABELS map
 * under-reported by 42, because whole namespaces — `project` above all — are labelled by a switch
 * rather than by that map.
 */
export function describeEventOrNull(ev: EventLike): string | null {
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
      case 'modification.drafted': {
        const n = typeof payload.changes === 'number' ? payload.changes : null;
        return `Modification ${str(payload.modNumber) ?? ''} drafted`
          + `${n ? ` — ${n} change${n === 1 ? '' : 's'}, not yet applied` : ' — no contract change'}`;
      }
      case 'milestone.auto_closed':
        return `Milestone closed by the AI manager: ${str(payload.title) ?? 'a milestone'}`;
      case 'milestone.auto_close_declined': {
        // The DECLINE is the more interesting row. A sweep that only logged its successes would
        // make "nothing happened" and "a phase was held back" look identical in the feed.
        const why = Array.isArray(payload.objections) ? payload.objections : [];
        return `AI manager held back ${str(payload.title) ?? 'a milestone'}`
          + `${why.length ? ` — ${String(why[0])}` : ''}`;
      }
      case 'status_narrative.requested':
        // The check is the point, and the feed says so — otherwise "narrative drafted" reads as
        // "the report now contains generated numbers", which is the one thing it does not.
        return phase === 'start'
          ? 'Drafting the status-report narrative — every figure is checked against the rows'
          : 'Status-report narrative drafted, pending review';
      case 'health.assessment_requested':
        // ADVISORY, said in the feed itself. A reader scanning the activity log must not think a
        // date moved because an assessment ran.
        return phase === 'start'
          ? 'Assessing project health — advisory, nothing will be changed'
          : 'Project health assessment requested';
      // ── the nine that used to be auditLog() ────────────────────────────────────────────────
      // These were `auditLog({action: 'project.member_assigned'})` and friends, writing to a table
      // dropped in migration 142 — so they recorded nothing, and needed no label. They are real
      // events now, which means a person reads them, which means they need sentences. An event
      // with no label renders as its own de-punctuated identifier ("member assigned"), and that is
      // what a customer sees.
      case 'member.assigned':
        return `${str(payload.email) ?? 'Someone'} was staffed onto the project`;
      case 'member.unassigned':
        return 'Someone was taken off the project';
      case 'milestone.gate_closer_set':
        // WHO closes the gate is the consequential half — a human reviewer and an AI manager are
        // different promises about how this milestone will advance.
        return payload.gateCloser === 'ai_manager'
          ? 'Gate closing handed to the AI manager for this milestone'
          : 'Gate closing set to a human reviewer for this milestone';
      case 'task.created':
        return `Task added: ${str(payload.title) ?? 'a task'}`;
      case 'milestone.created':
        return `Milestone added: ${str(payload.title) ?? 'a milestone'}`;
      case 'deliverable.created':
        // "Added", not "delivered". Creating the obligation and meeting it are different rows, and
        // this capability keeps them apart everywhere else too.
        return `Deliverable added: ${str(payload.title) ?? 'a deliverable'}`;
      case 'modification.discarded':
        return 'A draft modification was discarded — the contract is unchanged';
      // NOT `risk.closed` — it already has a richer label further down (with the title and the
      // closing note), and an earlier case in the same switch would shadow it silently.
      case 'wbs_node.created':
        return 'Work-breakdown item added';

      case 'cdrl.registered': {
        const dist = str(payload.distribution);
        return `CDRL ${str(payload.cdrlNumber) ?? ''} registered — ${str(payload.title) ?? 'a data item'}`
          + `${str(payload.frequency) && payload.frequency !== 'one_time' ? `, ${String(payload.frequency).replace('_', ' ')}` : ''}`
          + `${dist ? ` \u00b7 Distribution ${dist}` : ''}`;
      }
      case 'cdrl.submitted': {
        // LATE or EARLY, said plainly. "CDRL submitted" is the row nobody can act on; whether it
        // met the contract date is the only thing a program review asks.
        const late = typeof payload.daysLate === 'number' ? payload.daysLate : null;
        const when = late === null || late === 0 ? ''
          : late > 0 ? ` \u2014 ${late} day${late === 1 ? '' : 's'} late`
          : ` \u2014 ${-late} day${late === -1 ? '' : 's'} early`;
        const ref = str(payload.transmittalRef);
        return `Delivered to the customer: ${str(payload.title) ?? 'a deliverable'}`
          + `${str(payload.cdrlNumber) ? ` (CDRL ${str(payload.cdrlNumber)})` : ''}${when}`
          + `${ref ? ` \u00b7 ${ref}` : ''}`;
      }
      case 'invoice.drafted': {
        const n = typeof payload.total === 'number' ? payload.total : null;
        return `Invoice ${str(payload.invoiceNumber) ?? ''} drafted`
          + `${n === null ? '' : ` — ${n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}, not yet claimed`}`;
      }
      case 'invoice.submitted': {
        const n = typeof payload.total === 'number' ? payload.total : null;
        return `Invoice ${str(payload.invoiceNumber) ?? ''} submitted`
          + `${n === null ? '' : ` — ${n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`}`;
      }
      case 'invoice.paid': {
        // PART-paid is the normal case, and "Invoice paid" over a 90% payment is the sentence that
        // makes somebody stop chasing the withholding.
        const got = typeof payload.amount === 'number' ? payload.amount : null;
        const cash = got === null ? '' : ` — ${got.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} received`;
        return payload.settled === true
          ? `Invoice ${str(payload.invoiceNumber) ?? ''} settled${cash}`
          : `Payment against invoice ${str(payload.invoiceNumber) ?? ''}${cash} · still outstanding`;
      }
      case 'invoice.voided': {
        const freed = typeof payload.hoursReleased === 'number' ? payload.hoursReleased : 0;
        return `Invoice ${str(payload.invoiceNumber) ?? ''} voided`
          + `${str(payload.reason) ? ` — ${str(payload.reason)}` : ''}`
          + `${freed > 0 ? ` · ${freed} time entr${freed === 1 ? 'y' : 'ies'} released to bill again` : ''}`;
      }
      case 'modification.executed': {
        // What it MOVED, not that it happened. "Modification executed" six months later is a row
        // nobody can act on; the money and the dates are why anyone opens the feed.
        const applied = typeof payload.applied === 'number' ? payload.applied : 0;
        const added = typeof payload.clinsCreated === 'number' ? payload.clinsCreated : 0;
        const what = [
          applied - added > 0 ? `${applied - added} CLIN field${applied - added === 1 ? '' : 's'}` : null,
          added > 0 ? `${added} new CLIN${added === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(' and ');
        const pop = payload.movedPeriodOfPerformance === true
          ? ' · period of performance moved — rebaseline requested' : '';
        return `Modification ${str(payload.modNumber) ?? ''} executed`
          + `${what ? ` — ${what}` : ''}${pop}`;
      }
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
        // "Closed-out" is the fact that matters: this project was finished, and is not any more.
        return `Closed-out project reopened${str(payload.reason) ? ` — ${str(payload.reason)}` : ''}`;
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

      // ── The plan (mig 221) ────────────────────────────────────────────────────────────────
      case 'task.reassigned': {
        // WHO it moved to is the whole reason this event exists — "a task was reassigned" is a
        // sentence that makes a reader open the project to learn anything.
        const what = str(payload.title) ?? 'a task';
        const to = str(payload.to);
        return `Task handed over: ${what}${to ? ` — now ${to}` : ''}`;
      }
      case 'task.rescheduled': {
        const what = str(payload.title) ?? 'a task';
        const from = str(payload.from);
        const to = str(payload.to);
        return `Task moved: ${what}${from && to ? ` — ${from} → ${to}` : to ? ` — now due ${to}` : ''}`;
      }
      case 'task.reference_attached':
        return `Reference attached to ${str(payload.title) ?? 'a task'}`
          + `${str(payload.filename) ? ` — ${str(payload.filename)}` : ''}`;
      case 'task.reference_removed':
        return `Reference removed from ${str(payload.title) ?? 'a task'}`;
      case 'milestone.dependency_set':
        return str(payload.dependsOnId)
          ? `Milestone now follows another: ${str(payload.title) ?? 'a milestone'}`
          : `Milestone dependency cleared: ${str(payload.title) ?? 'a milestone'}`;

      // ── The conversation (mig 222) ────────────────────────────────────────────────────────
      case 'comment.posted': {
        // The EXCERPT, not just the fact. A feed row saying "a comment was posted" is a row
        // whose only function is to make somebody click.
        const on = str(payload.entityType);
        const where = !on || on === 'project' ? '' : ` on a ${on}`;
        const said = str(payload.excerpt);
        const n = typeof payload.mentioned === 'number' ? payload.mentioned : 0;
        const who = n > 0 ? ` · ${n} person${n === 1 ? '' : 's'} mentioned` : '';
        return `Comment${where}${said ? `: ${said}` : ''}${who}`;
      }
      case 'comment.resolved':
        return 'Comment thread resolved';
      case 'comment.reopened':
        return 'Comment thread reopened';
      case 'comment.edited':
        // "by its author" is the rule, not decoration — nobody else can, and a reader seeing an
        // edited comment should know it was not rewritten by somebody else.
        return 'Comment edited by its author';

      // ── The review gate (mig 223) ─────────────────────────────────────────────────────────
      case 'review.requested':
        return `Review requested on a ${str(payload.entityType) ?? 'deliverable'}`
          + `${str(payload.dueOn) ? ` — wanted by ${str(payload.dueOn)}` : ''}`;
      case 'review.approved':
        return `Review approved — the ${str(payload.entityType) ?? 'deliverable'} can be accepted`;
      case 'review.rejected':
        // The REASON. A rejection whose reason is not in the feed sends the reader hunting for
        // the one thing that tells them what to change.
        return `Review REJECTED: ${str(payload.reason) ?? 'no reason recorded'}`;
      case 'review.withdrawn':
        return 'Review request withdrawn';

      // ── Meetings (mig 226) ────────────────────────────────────────────────────────────────
      case 'meeting.recorded': {
        const n = typeof payload.attendees === 'number' ? payload.attendees : 0;
        return `Meeting recorded: ${str(payload.title) ?? 'a meeting'}`
          + `${str(payload.heldOn) ? ` (${str(payload.heldOn)})` : ''}`
          + `${n ? ` · ${n} attendee${n === 1 ? '' : 's'}` : ''}`;
      }
      case 'meeting.actions_raised': {
        // Both halves. Saying "5 raised" when one was refused is how the notes and the plan start
        // disagreeing about what was agreed.
        const raised = typeof payload.raised === 'number' ? payload.raised : 0;
        const refused = typeof payload.refused === 'number' ? payload.refused : 0;
        return `${raised} action item${raised === 1 ? '' : 's'} raised from `
          + `"${str(payload.title) ?? 'a meeting'}"${refused ? ` · ${refused} refused` : ''}`;
      }

      // ── The register (mig 225) ────────────────────────────────────────────────────────────
      case 'risk.raised':
        return `Risk raised: ${str(payload.title) ?? 'a risk'}`
          + `${typeof payload.score === 'number' ? ` — scored ${payload.score}/25` : ''}`;
      case 'issue.raised':
        return `Issue logged: ${str(payload.title) ?? 'an issue'}`;
      case 'risk.became_issue':
        // The transition a program review asks about, and the score it was rated at — which is the
        // register's whole claim to having been useful.
        return `A risk HAPPENED: ${str(payload.title) ?? 'a risk'}`
          + `${typeof payload.score === 'number' ? ` — we had it at ${payload.score}/25` : ''}`;
      case 'risk.rescored': {
        const from = typeof payload.from === 'number' ? payload.from : null;
        const to = typeof payload.to === 'number' ? payload.to : null;
        const dir = from !== null && to !== null ? (to > from ? 'up' : 'down') : '';
        return `Risk rescored ${dir}: ${str(payload.title) ?? 'a risk'}`
          + `${from !== null && to !== null ? ` — ${from} → ${to}` : ''}`;
      }
      case 'risk.closed':
        return `Risk closed: ${str(payload.title) ?? 'a risk'}`
          + `${str(payload.note) ? ` · ${str(payload.note)}` : ''}`;
      case 'issue.closed':
        return `Issue resolved: ${str(payload.title) ?? 'an issue'}`
          + `${str(payload.note) ? ` · ${str(payload.note)}` : ''}`;
      case 'risk.mitigation_planned':
        return `Mitigation planned: ${str(payload.title) ?? 'a mitigation'}`;

      // ── The customer's act, filed by us (mig 224) ─────────────────────────────────────────
      case 'acceptance_evidence.filed': {
        // "reports" is doing the work. This row must never read as the customer's own act — the
        // product has not met that person and verified nothing.
        const who = str(payload.customerName);
        const kind = str(payload.kind) ?? 'evidence';
        const on = str(payload.occurredOn);
        return `Customer acceptance evidence filed (${kind})`
          + `${who ? ` — reports ${who}` : ''}${on ? `, ${on}` : ''}`;
      }

      // ── The daily sweep ───────────────────────────────────────────────────────────────────
      case 'nudge_sweep.completed': {
        const n = typeof payload.notified === 'number' ? payload.notified
          : typeof payload.items === 'number' ? payload.items : null;
        return `Project reminders sent${n !== null ? ` — ${n} item${n === 1 ? '' : 's'}` : ''}`;
      }

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
  // ── working notes (the shared board, mig 244) ──────────────────────────────────────────────
  if (namespace === 'system' && type === 'note.created') {
    const who = str(payload.author);
    const where = str(payload.anchor);
    return `Note added${who ? ` by ${who.replace('_', ' ')}` : ''}${where ? ` on ${where}` : ''}`;
  }
  if (namespace === 'system' && type === 'note.advanced') {
    return `Note moved from ${str(payload.from) ?? '?'} to ${str(payload.to) ?? '?'}`;
  }
  if (namespace === 'system' && type === 'note.resolved') {
    return 'Note resolved';
  }

  return null;
}

/** The label a surface renders. Always a string: an unlabelled type still has to say something. */
export function describeEvent(ev: EventLike): string {
  return describeEventOrNull(ev) ?? humanizeType(ev.type);
}

export interface ActorLike {
  actorType?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  /** The person's display name, when the caller resolved the id against `users`. */
  actorName?: string | null;
}

/**
 * The system actors a customer can actually see in their own activity stream, in English.
 *
 * Measured, not imagined — these are the `actor_id` values present in `system_events`, and every
 * one of them was being rendered raw. Anything unmapped falls through to the humanizer rather than
 * to the token, so a new actor introduced tomorrow reads as "Some new worker", never
 * `some_new_worker`.
 */
const ACTOR_LABELS: Record<string, string> = {
  workflow_manager: 'Workflow automation',
  lifecycle_scheduler: 'Scheduled job',
  cron: 'Scheduled job',
  worker: 'Pipeline worker',
  fabric: 'Agent workforce',
  bridge: 'Opportunity bridge',
  'template-bridge': 'Template bridge',
  'public-apply': 'Public application form',
  claude_code: 'Claude Code session',
};

const ACTOR_TYPE_FALLBACK: Record<string, string> = {
  system: 'Automation',
  pipeline: 'Pipeline',
  agent: 'Agent workforce',
  user: 'A team member',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who did this, as a person would say it — and NEVER as an identifier.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────
 * The activity stream rendered `actorEmail ?? actorId ?? actorType ?? 'unknown'`, one line below
 * the `describeEvent` call that had already been fixed for exactly this reason. So a customer read
 * their own history as:
 *
 *     bd101904-582d-44db-ac2e-ce63eb341979 — Section saved
 *     workflow_manager                     — Portal provisioned
 *
 * The sentences had been humanized; the name beside them had not. Found by
 * `scripts/probe-customer-finish.mts`, which reads prose off the rendered page — 17 visible UUIDs
 * and 99 raw system tokens on one customer-facing route.
 *
 * ── AN UNRESOLVED ID IS "UNKNOWN", NOT THE ID ────────────────────────────────────────────────
 * Showing 36 hex characters to a customer who wants to know who touched their proposal tells them
 * nothing that "Unknown" does not, and costs them the impression that the product knows its own
 * business. The id is preserved in `title` — support keeps it, prose does not.
 *
 * Returns `{ label, title }`: `label` is always safe to render as text; `title` carries the raw
 * identifier when there is one worth keeping, or null.
 */
export function describeActor(a: ActorLike): { label: string; title: string | null } {
  const name = str(a.actorName);
  if (name) return { label: name, title: str(a.actorEmail) };

  const email = str(a.actorEmail);
  if (email) return { label: email, title: null };

  const id = str(a.actorId);
  const type = str(a.actorType);

  if (id && !UUID_RE.test(id)) {
    const mapped = ACTOR_LABELS[id];
    if (mapped) return { label: mapped, title: id };
    // `ingest:sbir_gov` → "SBIR.gov ingest". One rule, not a second map to keep in step.
    const ingest = /^ingest:(.+)$/.exec(id);
    if (ingest) return { label: `${ingest[1].replace(/_/g, '.').toUpperCase()} ingest`, title: id };
    return { label: humanizeType(id), title: id };
  }

  // A UUID (or nothing at all). Say what we know, keep what we cannot say.
  return { label: (type && ACTOR_TYPE_FALLBACK[type]) ?? 'Unknown', title: id };
}

/**
 * Does this event type have a WRITTEN label, as opposed to falling through to the humanizer?
 *
 * The obvious test — compare `describeEvent(...)` against the de-punctuated type — cannot answer
 * this, in both directions. With an empty payload every label shaped `X${optional}` collapses to
 * the bare X and looks like a fallback (that over-reported 38 types, most of which were fine). And
 * a GOOD sentence can legitimately coincide with the humanized form: "Preview generated" is
 * exactly what a person would write for `preview.generated`, and flagging it would push somebody
 * to make the wording worse to satisfy a check.
 *
 * So ask the function itself, through `describeEventOrNull`, which returns null exactly when it
 * would have fallen through to the humanizer. Exported for the oversight drive and the jargon
 * test, so neither has to keep its own copy of this map or guess at its shape.
 */
export function hasWrittenLabel(ev: EventLike): boolean {
  return describeEventOrNull(ev) !== null;
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
