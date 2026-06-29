"""
================================================================================
Workflow: ProjectCollaboration  (the generic project/opportunity HITL reaction)
================================================================================

THE CANONICAL PATTERN. This is the ONE generic, overlay-parameterized reaction
template that new project/opportunity automation should reuse — not another
bespoke On<Event> class. It generalizes OnProposalAdvancedToReview (park a human
gate, nudge it, resume on completion) and is launched the OnCmsContentRequested
way (emit its trigger event with an OVERLAY payload that carries the specifics).

TRIGGER:  proposal:project.collaboration_requested:single
          phase='single' ⇒ launchable on demand via lib/process/launch-template.ts
          (and by any bridge that emits the event — the create route for V1, the
          Stripe webhook when billing is live). Condition: the overlay names a
          proposal OR an opportunity to act on.

WHAT IT DOES:  parks a single, fully payload-parameterized human gate (a `tasks`
          ledger row: assignee, title, entity, nudge cadence, due) and resumes
          when that task is completed (or force-advanced, or a wait_for event
          fires). On resume it announces completion. It is a TRANSIENT reaction:
          park → resume → complete; never a weeks-long `running` row.

READS, NEVER WRITES, STATUS.  The overlay carries `stage` (and `proposalId`) for
          context and the task entity; this template references it but NEVER
          writes proposals.stage — advanceProposalStage stays the sole authority.
          The instance reacts to status; it does not own or drive it.

OVERLAY (payload) — frozen at launch, immutable forward (force-advance aside):
    proposalId        (uuid, optional)  — the project, when project-scoped
    opportunityId     (uuid, optional)  — the spine key; written to
                                          process_instances.opportunity_id so the
                                          control tower can chain/roll up by opp
    scope             ('opp'|'spotlight'|'project'|'contract') — written to
                                          process_instances.scope (the spine
                                          discriminator); defaults null if absent
    tenantId          (uuid, optional)  — the owning tenant (admin gate ⇒ null)
    stage             (text, optional)  — the project stage this gate sits at (context)
    taskType          (text, REQUIRED)  — the gate kind, e.g. "admin_review"
    taskTitle         (text)            — human-readable gate title
    assigneeRole      (text)            — role bucket, e.g. "rfp_admin"
    assigneeUser      (uuid, optional)  — a specific assignee (overrides the role)
    entityType        (text)            — e.g. "proposal" | "opportunity"
    entityRef         (uuid)            — the entity the assignee acts on
    nudgeDays         (int[])           — relative nudge cadence, e.g. [1,3,5]
    dueMinutes        (int)             — task due window (drives urgency + nudges)
    parkMinutes       (int, optional)   — instance park ceiling (the abandon
                                          backstop); overlay-driven so a weeks-long
                                          customer-build gate is not capped at the
                                          static default. Falls back to the step
                                          timeout (a generous 30-day backstop).
    completeTemplate  (text, optional)  — email template on completion; absent ⇒
                                          no email (system.notify degrades cleanly)

DESIGN NOTES:
    - One gate per instance, by design. The lifecycle has up to ~3 human gates
      (V1 → Locked), but each is driven by its OWN event (a stage advance, a
      purchase, a pin) — so the faithful model is one transient reaction per
      gate, launched reactively, NOT one long instance pre-chaining all stages
      (which would fight the gate machine's authority). Multi-gate = multi-launch.
    - assignee/title/entity/nudges/due are all resolved per-instance from the
      overlay via the same resolve_input paths as input_map (_create_task) — the
      static step stays generic; the payload carries the specifics.
    - The gate resumes via task completion (no wait_for needed). A reviewer who
      rejects force-fails the instance from the Process Ledger instead.
    - parkMinutes: the TASK's due_at/nudges (dueMinutes/nudgeDays) drive the human
      cadence; parkMinutes is only the instance's abandon backstop. They are
      decoupled on purpose — see manager.execute_instance.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger

# Instance park ceiling (abandon backstop) when the overlay omits parkMinutes:
# 30 days, generous enough that a normally-progressing gate never trips the
# paused-deadline sweep, while a truly-abandoned gate is eventually reaped.
_PARK_BACKSTOP_MINUTES = 43200


class ProjectCollaboration(Workflow):
    description = (
        "Generic project/opportunity HITL reaction: park one payload-parameterized "
        "human gate (tasks row + nudges), resume on completion, then notify. Launched "
        "with an overlay; reads proposals.stage, never writes it."
    )

    # NOTE: scope is NOT a class attribute. It is inherently per-launch (a purchase
    # bridge launches scope='opp'; the create-route launches scope='project'), so
    # create_instance reads it from the overlay (validated against the mig-088 CHECK).
    # The launcher MUST set payload.scope; absent ⇒ the instance is unscoped (null).

    trigger = EventTrigger(
        namespace="proposal",
        type="project.collaboration_requested",
        phase="single",
        # A launch must name something to act on — guards junk launches.
        condition=lambda p: bool(p.get("proposalId") or p.get("opportunityId")),
    )

    steps = [
        Step(
            name="collaborate",
            step_type=StepType.TODO,
            action="todo",
            # Every field resolves from the overlay (payload.X) per-instance.
            task_type="payload.taskType",
            task_title="payload.taskTitle",
            assignee_role="payload.assigneeRole",
            assignee_user="payload.assigneeUser",
            entity_type="payload.entityType",
            entity_ref="payload.entityRef",
            nudge_days="payload.nudgeDays",
            due_in_minutes="payload.dueMinutes",
            # Instance park ceiling. The overlay can extend it via payload.parkMinutes
            # (handled in manager.execute_instance); this static value is the fallback
            # abandon backstop, NOT the human-facing due date (that's dueMinutes).
            timeout_minutes=_PARK_BACKSTOP_MINUTES,
        ),
        Step(
            name="notify_done",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="collaborate",
            # completeTemplate absent ⇒ system.notify degrades to no-email (never a
            # hard failure), so a gate that needs no completion email just omits it.
            input_map={
                "channel": '"email"',
                "template": "payload.completeTemplate",
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
            },
        ),
    ]
