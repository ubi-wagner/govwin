"""
================================================================================
Workflow: OnProposalSectionEdited (PIPE-15)
================================================================================

TRIGGER:    proposal:section.saved:single
            (emitted by the portal section-save route and admin section route)

PURPOSE:    When a human saves a proposal section, run DiffAnalyzer against the
            previous (agent-drafted) content to capture edit metrics. The result
            is an episodic memory — purely advisory, never auto-applied. This
            closes the "edit feedback loop" for the learning flywheel.

STEPS:
    1. analyze_diff (ACTION)
       Action: workflows.actions.analyze_section_diff.analyze_section_diff
       Input: tenant_id, proposal_id, section_id, original, edited, agent_role
       Output: edit_type, edit_percentage, lines_added, lines_removed,
               memory_created (or skipped=True on degraded path)
       Retry: 0
       Timeout: 5 minutes
       On Failure: Log error, emit step_failed. Advisory — no impact on user.

HITL GATES: None (fully automated)

ADVISORY ONLY:
    DiffAnalyzer writes to episodic_memories only. It does NOT modify
    proposal_sections or any other business table.

CHANGE LOG:
    PIPE-15 (2026-06-23) — Initial implementation
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow


class OnProposalSectionEdited(Workflow):
    """Capture edit diffs when a proposal section is saved (learning flywheel)."""

    description = "Run DiffAnalyzer when a proposal section is saved by a human"

    trigger = EventTrigger(
        namespace="proposal",
        type="section.saved",
        phase="single",
    )

    steps = [
        Step(
            name="analyze_diff",
            step_type=StepType.ACTION,
            action="workflows.actions.analyze_section_diff.analyze_section_diff",
            input_map={
                "tenant_id": "payload.tenantId",
                "proposal_id": "payload.proposalId",
                "section_id": "payload.sectionId",
                # original / edited content: the save route should include
                # these in the event payload when an agent-drafted section
                # is edited. If absent, DiffAnalyzer degrades gracefully.
                "original": "payload.originalContent",
                "edited": "payload.content",
                "agent_role": "payload.agentRole",
            },
            timeout_minutes=5,
        ),
    ]
