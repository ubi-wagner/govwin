"""
================================================================================
Workflow: OnProjectHealthRequested  (A1 — post-award milestone health)
================================================================================

TRIGGER:    project:health.assessment_requested:end
            (a tenant_admin hit "Assess health" on a project —
             POST /api/portal/[tenantSlug]/projects/[projectId]/assess-health.)

PURPOSE:    Run the post-award MANAGER over a project. `project_manager` reads the
            milestones (frozen baseline against current forecast), the open and
            blocked checklist, the deliverables that have not reached the
            customer, and the open risk register, and returns ONE advisory health
            assessment: per milestone a band, the evidence behind it, and a
            suggested next step.

            The post-award counterpart to OnFullDraftRequested (proposal_manager
            plans a draft) and OnIngestAssessmentRequested (rfp_ingest_manager
            plans an ingest). This one plans nothing: it assesses.

            WHY AN AGENT AT ALL. Every input is already computed deterministically
            — variance is arithmetic and `rollup.ts` already reports it without a
            model. What SQL cannot do is read a blocked task's reason beside a
            slipping forecast beside an open risk and say "these are one problem".
            That judgement is the whole contribution, and it is exactly the kind a
            person must be able to disagree with — hence advisory.

STEPS:
    1. ai_project_manager (AI_INVOKE)
       Action: tool.project.assess_health -> project_manager (tenant-scope)
       Input: project_id from the request payload.
       Output: the health assessment, or safe-skipped if the fabric / API key is
               unavailable. Independent (no depends_on).

    2. notify_requester (NOTIFY)
       Action: system.notify -> tenant_admin, template project_health_ready.
       INDEPENDENT of the agent step, so a skipped or failed assessment never
       dead-ends the person who asked — they are routed to the project either way.

HITL GATE:
    - There is no gate to pass, because nothing advances. The assessment is read
      by a person who then moves a date, unblocks a task, or does nothing. It
      never changes a milestone status, never creates a ToDo, never rebaselines.

SAFETY:
    - TENANT-BOUND: the agent's tenant comes from the trusted task context; no
      tool schema carries a tenant_id, and every read verifies the project
      belongs to that tenant before returning a row.
    - ADVISORY: `emit_health_assessment` returns persisted=false and writes no
      business table.
    - INJECTION-FENCED: milestone titles, task titles, blocked reasons and risk
      text are tenant-authored and therefore untrusted; all are delimited with
      the canonical markers and a forged closing marker is neutralised.
    - RUNAWAY/DEAD-END: the fabric's caps apply, and an unavailable fabric is a
      SAFE SKIP — step 2 routes the person regardless.

CHANGE LOG:
    A1 — Initial implementation: post-award advisory milestone health.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnProjectHealthRequested(Workflow):
    description = "Run the advisory post-award health manager when a tenant admin requests a project assessment"

    trigger = EventTrigger(
        namespace="project",
        type="health.assessment_requested",
        phase="end",
    )

    steps = [
        # AI actor: project_manager assesses milestone health — ADVISORY. Independent, so a skip
        # never blocks the person who asked.
        Step(
            name="ai_project_manager",
            step_type=StepType.AI_INVOKE,
            action="tool.project.assess_health",
            input_map={"project_id": "payload.projectId"},
            timeout_minutes=10,
        ),
        # Route them back to the project. INDEPENDENT of the agent step, for the same reason it is
        # independent in the ingest workflow: a failed assessment must not leave somebody waiting
        # for a mail that a dependency chain has quietly cancelled.
        Step(
            name="notify_requester",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "to_role": '"tenant_admin"',
                "template": '"project_health_ready"',
                "project_id": "payload.projectId",
            },
        ),
    ]
