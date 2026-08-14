"""
================================================================================
Workflow: OnOpportunitiesDetected  (Scouting Spine M2 — detection → alert)
================================================================================

TRIGGER:    finder:opportunities.detected:single
            Condition: None (any rollup emitted means >=1 new triage row was
            created — the producer only emits when there is a new triage row,
            so the workflow can fire once per detection with no extra guard).
            PRODUCERS (both emit finder:opportunities.detected):
              - pipeline/src/ingest/base.py — a batch ingest/scout RUN
                (result.new_solicitations > 0), one event per run.
              - frontend lib/intake.stageIntake — a single staged NOTICE
                (the admin intake form AND the #176 scout releaseAsNew path
                both funnel through it), one event per staged opportunity.
                This is what wakes opportunity_scout live in the portal path.

PURPOSE:    A scheduled ingest or scout run silently fills the triage queue.
            This workflow turns the single per-run detection rollup
            (finder:opportunities.detected, contract C2.a) into an explicit
            ALERT: it emails the rfp_admin that new opportunities are waiting
            AND parks a triage ToDo on the unified `tasks` ledger so the work
            is tracked, assignable, and auditable. This is the alerting nerve
            between SENSE/DETECT and CURATE — new finds announce themselves
            instead of accumulating unseen.

DETECTION EVENT PAYLOAD (C2.a — emitted by base.py after a run):
    source            — source label (e.g. "sam", "sbir", "dsip")
    runId             — the ingest.run.start event id (correlation handle)
    newSolicitations  — count of NEW curated_solicitations(status='new')
    newTopics         — count of NEW topic opportunities created this run
    sampleTitles[]    — up to 5 titles for the email/ToDo preview

STEPS:
    1. notify_rfp_admin (NOTIFY)
       Action: system.notify
       Input: channel=email, template=new_opportunities_to_triage,
              to_role=rfp_admin, plus source + newSolicitations + newTopics +
              sampleTitles forwarded straight from the detection payload as
              template variables (the field names match the template in
              services/cms/src/templates.py exactly).
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes (default)
       On Failure: Log error, emit step_failed. Admin still sees the new
                   solicitations in the triage queue + the ToDo from step 2.
                   A missing/unrenderable template surfaces loud
                   (system:notification.failed) per C2.c — never a silent skip.
       Event Emitted: system:notification.requested (single)

    2. triage_todo (TODO)
       Action: todo
       Writes one row to the `tasks` ledger (C2.b):
         task_type     = triage_new_opportunities
         assignee_role = rfp_admin
         entity_type   = source
         title         = "Triage N new opportunities from <source>"
         params        = the counts (carried via the frozen instance payload)
       The ToDo resumes via task completion (no wait_for) — completing it is
       the "triaged" signal. There is no downstream step; the workflow ends
       when the task is closed.
       Retry: 0
       Timeout: 4320 minutes (72h park window before the gate goes stale)
       On Failure: A task-write failure does NOT crash the park (the engine's
                   _create_task logs + continues); the instance still parks.
       Event Emitted: system:task.created (single)

HITL GATES:
    - Step 2 (triage_todo): an rfp_admin must work the triage queue and
      complete the ToDo. Resume = task completion (no resume event).

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next independent step.
    - Notification failure: Logged; does not block the ToDo. A render-miss is
      raised loud as system:notification.failed by the CMS event_listener.
    - Workflow failure: Emit system:workflow.failed event with full context.
    - Database failure: Retry once, then fail step with error event.

FAULT TOLERANCE:
    - Idempotent: the PRODUCER emits exactly one detected event per run, and
      the processor dedups by trigger_event_id — so one run yields at most one
      instance, hence one notification + one ToDo. Re-emitting the same event
      id does not double-create.
    - Partial completion: if NOTIFY succeeds but the ToDo write degrades, the
      admin still gets the email; if the email fails, the ToDo still exists.
    - Duplicate detection: processor-level dedup by trigger_event_id.

INSTANCES:
    - Admin Pipeline: Fires when an ingester/scout run created >=1 new triage
      row and emitted finder:opportunities.detected:single (see base.py / T2.1).
    - Customer Portal: Not applicable (triage is admin-only).
    - CMS: Renders the new_opportunities_to_triage email (T2.3).

COST:
    - AI tokens: 0 (notify + ledger write only, no AI invocation).
    - Compute: sub-second.

CHANGE LOG:
    Scouting Spine M2 / T2.2 (2026-06-14) — Initial implementation: detection
        rollup -> NOTIFY (new_opportunities_to_triage) + TODO
        (triage_new_opportunities). Registered via package auto-discovery;
        process_templates catalog row seeded by migration 065.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnOpportunitiesDetected(Workflow):
    description = (
        "When a scouting/ingest run detects new opportunities, alert the rfp "
        "admin (email) and park a triage ToDo on the tasks ledger."
    )

    trigger = EventTrigger(
        namespace="finder",
        type="opportunities.detected",
        phase="single",
    )

    steps = [
        # AI actor (#128, Batch A — PLATFORM-SCOPE, tenant_id=None): the opportunity_scout reads
        # the newly-detected triage rows and prioritizes them for the admin — ADVISORY (never
        # dismisses/promotes). Independent (no depends_on) so a failure never blocks the alert +
        # triage ToDo. Injection-fenced (raw external titles/summaries).
        Step(
            name="ai_opportunity_scout",
            step_type=StepType.AI_INVOKE,
            action="tool.opportunity.scout",
            input_map={"source": "payload.source", "newSolicitations": "payload.newSolicitations"},
            timeout_minutes=10,
        ),
        Step(
            name="notify_rfp_admin",
            step_type=StepType.NOTIFY,
            action="system.notify",
            # Forward the detection counts straight through as template
            # variables; key names match the new_opportunities_to_triage
            # template (services/cms/src/templates.py) and the C2.a payload.
            input_map={
                "channel": '"email"',
                "template": '"new_opportunities_to_triage"',
                "to_role": '"rfp_admin"',
                "source": "payload.source",
                "newSolicitations": "payload.newSolicitations",
                "newTopics": "payload.newTopics",
                "sampleTitles": "payload.sampleTitles",
            },
        ),
        Step(
            name="triage_todo",
            step_type=StepType.TODO,
            action="todo",
            depends_on="notify_rfp_admin",
            # An rfp_admin ToDo: work the triage queue for this run's source.
            # assignee_role is the literal "rfp_admin" (the engine has no
            # "payload OR default" resolver; a missing payload field would make
            # _create_task fall back to the raw path string). Resumes on task
            # completion — there is no downstream step, so closing the task ends
            # the instance.
            task_type='"triage_new_opportunities"',
            task_title='"Triage new opportunities from source"',
            assignee_role='"rfp_admin"',
            entity_type='"source"',
            entity_ref="payload.source",
            timeout_minutes=4320,  # 72h park window for the triage gate
        ),
    ]
