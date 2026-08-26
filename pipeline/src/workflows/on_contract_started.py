"""
================================================================================
Workflow: OnContractStarted
================================================================================

TRIGGER:    capture:contract.started:single
            Condition: payload.contractId is present (a contract entity exists).

PURPOSE:    The ONE bridge from the proposal spine into post-award delivery.

            When a proposal's outcome is recorded as awarded, the outcome route
            creates a `contracts` row and emits `capture:contract.started`. This
            workflow turns that into a human ToDo — "Set up delivery workspace"
            — and routes the tenant admin to it.

            It does NOT create the delivery project.

WHY NOT AUTO-CREATE, WHICH IS THE OBVIOUS THING TO DO:
    A delivery workspace is ANCHORED to two uploaded artifacts — the executed
    contract and the as-submitted proposal (docs/DELIVERY_MANAGEMENT_DESIGN.md).
    Not a pointer to `proposals`, even though we authored it: what lives there
    is a working copy that stayed editable after submission, so a deliverable
    tracing to it traces to something that can still change.

    A workspace created the instant an outcome is recorded would be anchored to
    NOTHING, which is precisely what the provenance model forbids. So the bridge
    raises work for a person, and `readiness()` refuses to baseline until both
    artifacts are actually there.

    This is the same shape as the ingest-provenance rule one domain over: *a
    value the product did not read from the source must never look like one it
    did.* An auto-created project would look exactly like a sourced one.

STEPS:
    1. todo_setup_delivery (TODO)
       Raises a `delivery_setup` task for tenant_admin against the contract.
       10-day timeout: award-to-kickoff is measured in weeks, not hours, and a
       gate that expires before the work is plausible is a gate that trains
       people to ignore it.

    2. notify_delivery_setup (NOTIFY)
       template=delivery_setup_ready. INDEPENDENT (no depends_on) — a failed
       notification must not leave the ToDo unraised, and a failed ToDo must not
       leave the admin uninformed. Either one alone still lands the customer in
       the right place.

HITL GATES:
    - The whole workflow IS the gate. Nothing downstream advances until a human
      opens the workspace and uploads the two artifacts.

ERROR HANDLING:
    - ToDo failure: the notification still fires (independent), and the contract
      row already exists — the customer can reach delivery from the portal.
    - Notification failure: the ToDo still stands in the work-item ledger with
      its own nudge schedule.
    - Neither dead-ends: there is no downstream step waiting on either.

FAULT TOLERANCE:
    - Idempotent: YES for the ToDo (closeTasksForEntity/dedup by entity ref);
      the notification uses CRM dedup by trigger_event_id.
    - A re-recorded outcome does not create a second contract (the route
      upserts), so this trigger does not fan out.

SAFETY:
    - No agent, no AI, no tenant descent. This workflow reads nothing and writes
      one task.

INSTANCES:
    - Customer Portal: fires on proposal outcome = awarded.
    - Admin Pipeline: N/A.

CHANGE LOG:
    D6 — Initial implementation: the award bridge into delivery management.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnContractStarted(Workflow):
    description = "Raise the delivery-workspace setup ToDo when a proposal is awarded"

    trigger = EventTrigger(
        namespace="capture",
        type="contract.started",
        phase="single",
        condition=lambda p: bool(p.get("contractId")),
    )

    steps = [
        # The gate. A person opens the workspace and uploads the executed contract and the
        # as-submitted proposal; nothing about delivery is real until they do.
        Step(
            name="todo_setup_delivery",
            step_type=StepType.TODO,
            action="todo",
            task_type='"delivery_setup"',
            task_title='"Set up delivery workspace"',
            assignee_role='"tenant_admin"',
            entity_type='"contract"',
            entity_ref="payload.contractId",
            # Ten days. Award-to-kickoff is measured in weeks; a gate that expires before the work
            # is plausible is a gate people learn to ignore.
            timeout_minutes=14400,
        ),
        # INDEPENDENT of the ToDo, deliberately. A failed notification must not leave the ToDo
        # unraised, and a failed ToDo must not leave the admin uninformed — either one alone still
        # lands the customer in the right place.
        Step(
            name="notify_delivery_setup",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "template": '"delivery_setup_ready"',
                "tenant_id": "payload.tenantId",
                "contract_id": "payload.contractId",
                "proposal_id": "payload.proposalId",
                "title": "payload.title",
            },
        ),
    ]
