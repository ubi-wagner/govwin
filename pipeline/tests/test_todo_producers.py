"""Producer wiring — real templates emit TODO steps that populate the queues.

The tasks machinery (053 + StepType.TODO) is only meaningful if a real Process
Template actually emits a TODO step. These tests lock that the two human-review
gates are TODOs with correct assignees + entity refs, so completing/parking them
produces rows in the right role's queue. Also guards that they still validate
and still carry their wait_for (dual resume: task-completion OR event).
"""
from workflows.base import StepType
from workflows.on_proposal_advanced import OnProposalAdvancedToReview
from workflows.on_source_change_detected import OnSourceChangeDetected


def _step(cls, name):
    return next(s for s in cls.steps if s.name == name)


def test_proposal_review_is_a_todo_for_the_tenant_admin():
    s = _step(OnProposalAdvancedToReview, "wait_for_review")
    assert s.step_type == StepType.TODO
    # literal assignee/title/type carry their quotes (resolve_input strips them);
    # what matters is the customer (tenant_admin) owns it and it points at the proposal.
    assert "tenant_admin" in s.assignee_role
    assert "proposal_review" in s.task_type
    assert s.entity_ref == "payload.proposalId"
    # dual-resume preserved: still resumes on the advance event too
    assert s.wait_for is not None
    assert s.wait_for.type == "proposal.advanced"


def test_source_review_is_a_todo_for_the_rfp_admin():
    s = _step(OnSourceChangeDetected, "wait_for_admin_review")
    assert s.step_type == StepType.TODO
    assert "rfp_admin" in s.assignee_role
    assert "source_review" in s.task_type
    assert s.entity_ref == "payload.sourceId"
    assert s.wait_for is not None
    assert s.wait_for.type == "source_diff.reviewed"


def test_both_templates_still_validate():
    # TODO steps require task_type + an assignee; on_timeout must resolve.
    assert OnProposalAdvancedToReview.validate() == []
    assert OnSourceChangeDetected.validate() == []
