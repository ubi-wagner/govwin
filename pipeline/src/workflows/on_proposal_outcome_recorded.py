"""
================================================================================
Workflow: OnProposalOutcomeRecorded (PIPE-16)
================================================================================

TRIGGER:    proposal:outcome.recorded:end
            (emitted by the portal outcome route when a proposal is marked
            as awarded / lost / withdrawn)

PURPOSE:    When a proposal outcome is recorded, run OutcomeAttributor to
            trace the win/loss back to contributing agent tasks, creating
            episodic memories and updating agent_performance metrics. Advisory
            only — never modifies proposal stage or business tables.

STEPS:
    1. attribute_outcome (ACTION)
       Action: workflows.actions.attribute_outcome.attribute_outcome
       Input: tenant_id, proposal_id, outcome, notes from event payload
       Output: total_tasks, acceptance_rate, roles_attributed, memory_created
               (or skipped=True on degraded path)
       Retry: 0
       Timeout: 10 minutes
       On Failure: Log error, emit step_failed. Advisory — no user impact.

HITL GATES: None (fully automated)

ADVISORY ONLY:
    OutcomeAttributor writes to episodic_memories and agent_performance only.
    It does NOT modify proposals, proposal_sections, or other business tables.

CHANGE LOG:
    PIPE-16 (2026-06-23) — Initial implementation
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow


class OnProposalOutcomeRecorded(Workflow):
    """Attribute proposal outcome to contributing agents (learning flywheel)."""

    description = "Run OutcomeAttributor when a proposal outcome is recorded"

    trigger = EventTrigger(
        namespace="proposal",
        type="outcome.recorded",
        phase="end",
    )

    steps = [
        Step(
            name="attribute_outcome",
            step_type=StepType.ACTION,
            action="workflows.actions.attribute_outcome.attribute_outcome",
            input_map={
                "tenant_id": "payload.tenantId",
                "proposal_id": "payload.proposalId",
                "outcome": "payload.outcome",
                "notes": "payload.notes",
            },
            timeout_minutes=10,
        ),
    ]
