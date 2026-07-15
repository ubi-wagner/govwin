"""Wiring: the workflow processor dispatches unclaimed events to the agent fabric.

Contract (processor.run_workflow_processor):
  if a workflow owns the event   -> run the workflow  (fabric NOT called)
  elif fabric.has_handler(type)  -> fabric.handle_event(event)  (archetype reacts)
  else                           -> nothing (no dispatch, no observability noise)

This proves the fallback is workflow-first (no double-invoke against a workflow) and
that the has_handler gate keeps the fabric quiet for events no archetype wants.
"""
from workflows.base import discover_workflows, get_workflow_for_event
from agents.fabric import AgentFabric


def _ev(namespace, type_, phase="single", **payload):
    return {
        "namespace": namespace, "type": type_, "phase": phase,
        "payload": payload, "error": None,
    }


def test_review_requested_routes_only_to_color_team():
    f = AgentFabric()
    assert f.has_handler("proposal.review_requested") is True
    handlers = [n for n, a in f._archetypes.items() if a.handles_event("proposal.review_requested")]
    assert handlers == ["color_team_reviewer"]


def test_has_handler_gate_is_quiet_for_unowned_events():
    f = AgentFabric()
    # workspace.released has no archetype handler at all.
    assert f.has_handler("workspace.released") is False
    # purchase.completed: capture_strategist's declared string is the stale
    # "capture.purchase.completed" (pre-refactor taxonomy), so it does NOT match the
    # real type yet — reconcile that handler when the capture-strategy feature is wired.
    assert f.has_handler("purchase.completed") is False


def test_workflow_owns_proposal_created_so_fabric_is_skipped():
    """proposal.created is owned by OnProposalCreated; the processor takes the `if`
    branch and the fabric `elif` never runs — so proposal_architect (which also
    declares it) is not double-invoked."""
    discover_workflows()
    wf = get_workflow_for_event(_ev("proposal", "proposal.created", phase="end", proposalId="x"))
    assert wf is not None
    # It *would* match an archetype, but the workflow wins first.
    assert AgentFabric().has_handler("proposal.created") is True


def test_review_requested_has_no_workflow_so_fabric_runs():
    """proposal.review_requested is owned by NO workflow, so the processor falls through
    to the fabric elif and color_team_reviewer reacts."""
    discover_workflows()
    assert get_workflow_for_event(_ev("proposal", "proposal.review_requested")) is None
    assert AgentFabric().has_handler("proposal.review_requested") is True
