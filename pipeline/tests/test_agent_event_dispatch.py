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


def test_handles_event_sees_the_BARE_type_so_prefixed_declarations_are_inert():
    """`system_events.type` carries NO namespace prefix — namespace is its own column.

    The processor passes `event["type"]` straight to has_handler/handles_event, so an
    archetype declaring `finder.solicitation.triaged` can never match the real type
    `solicitation.triaged`. Those declarations are inert; the archetype is reached via an
    AI_INVOKE step or an agent_task_queue producer instead. Pinned so nobody "fixes" the
    fallback by prefixing the dispatch key and silently wakes ~32 dormant archetypes at once
    (CLAUDE.md: agents are woken ONE AT A TIME).
    """
    f = AgentFabric()
    assert f.has_handler("solicitation.triaged") is False       # the type actually emitted
    assert f.has_handler("finder.solicitation.triaged") is True  # curation_qa's inert string
    assert f.has_handler("scoring.completed") is False
    assert f.has_handler("section.drafted") is False


def test_librarian_declines_a_fallback_dispatch_with_no_cocoon():
    """The librarian is the ONE archetype the fallback can actually reach (it registers the
    bare `package.atomized` / `document.locked` forms).

    The upload routes emit `library:package.atomized` AND enqueue an explicit librarian task
    carrying the cocoonId — so the fallback was a SECOND invocation per upload whose prompt read
    "Catalog the atoms of package (cocoon) ." (the event payload is
    {filesProcessed, totalAtoms, source} — no cocoonId). handles_dispatch now requires the id.
    """
    lib = AgentFabric()._archetypes["librarian"]
    # type matches, but the real emitted payload names no cocoon → decline
    assert lib.handles_event("package.atomized") is True
    assert lib.handles_dispatch(
        _ev("library", "package.atomized", filesProcessed=1, totalAtoms=7, source="upload_auto")
    ) is False
    # document.locked (both emitters) carries no cocoonId either
    assert lib.handles_dispatch(_ev("proposal", "document.locked", proposalId="p1")) is False
    # a payload that DOES name a cocoon is a real catalog request → still dispatches
    assert lib.handles_dispatch(_ev("library", "package.atomized", cocoonId="c1")) is True
    assert lib.handles_dispatch(_ev("library", "package.atomized", cocoon_id="c1")) is True
    # and an unrelated type is still declined outright
    assert lib.handles_dispatch(_ev("proposal", "proposal.created", cocoonId="c1")) is False


def test_handles_dispatch_defaults_to_handles_event_for_every_other_archetype():
    """The new hook must be a no-op everywhere it is not overridden."""
    f = AgentFabric()
    for name, a in f._archetypes.items():
        if name == "librarian":
            continue
        for t in ("proposal.review_requested", "proposal.created", "workspace.released"):
            assert a.handles_dispatch(_ev("x", t)) is a.handles_event(t), f"{name} on {t}"
