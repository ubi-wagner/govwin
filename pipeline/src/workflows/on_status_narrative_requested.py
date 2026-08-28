"""
================================================================================
Workflow: OnStatusNarrativeRequested  (A2 — the paragraph a report cannot compute)
================================================================================

TRIGGER:    project:status_narrative.requested:end
            (somebody asked for a drafted narrative on a status report —
             POST /api/portal/[tenantSlug]/projects/[projectId]/draft-narrative.)

PURPOSE:    `status_narrator` writes the PROSE of a post-award status report. The
            report's tables are produced deterministically by
            `lib/projects/status-report.ts` — every figure read off a row — and
            they are not touched here. What the agent adds is the paragraph a
            project manager would otherwise type: what happened, what is in the
            way, and what happens next.

            THE GUARANTEE IS NOT THE PROMPT. One sentence can undo a
            correct-by-construction document: "approximately 65% through the
            period" reads perfectly beside a table saying 40%. So the agent's
            output passes a DETERMINISTIC fidelity check
            (`lib/projects/narrative-fidelity.ts`) before a person is offered it —
            every number in the prose must be one the system computed. The prompt
            says so as well, and is the weaker of the two on purpose.

STEPS:
    1. ai_status_narrator (AI_INVOKE)
       Action: tool.project.draft_status_narrative -> status_narrator
       Input: project_id from the request payload.
       Independent; a safe skip if the fabric is unavailable.

HITL LANDING (deliberately NOT a step):
    The narrative is STAGED, never written into the document by the engine. The
    workflow engine's invariants forbid a pipeline consumer of agent output, so
    the landing is frontend + human-triggered — the same read-on-review shape the
    full-draft cohort uses (docs/FULL_DRAFT_LANDING_DESIGN.md). A person reads the
    three paragraphs and accepts them, or does not.

    There is no NOTIFY step for the same reason: this is requested from a screen a
    person is already looking at, and mailing them about a draft they are waiting
    for is noise. (Contrast OnProjectHealthRequested, which can take longer and
    does notify.)

SAFETY:
    - TENANT-BOUND: tenant from the trusted task context; every read verifies the
      project belongs to it.
    - ADVISORY: `emit_narrative` returns persisted=false and writes nothing.
    - INJECTION-FENCED: every input is tenant-authored; all fenced.
    - NEVER DEAD-ENDS: an unavailable fabric is a safe skip and the person simply
      writes the paragraph themselves, which is what they did before.

CHANGE LOG:
    A2 — Initial implementation: status-report narrative drafting.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnStatusNarrativeRequested(Workflow):
    description = "Draft the narrative paragraphs of a post-award status report (advisory; figures are checked)"

    trigger = EventTrigger(
        namespace="project",
        type="status_narrative.requested",
        phase="end",
    )

    steps = [
        Step(
            name="ai_status_narrator",
            step_type=StepType.AI_INVOKE,
            action="tool.project.draft_status_narrative",
            input_map={"project_id": "payload.projectId"},
            timeout_minutes=10,
        ),
    ]
