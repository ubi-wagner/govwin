"""Fix 2 — workflow NOTIFY templates render (Launch Review #2).

6 NOTIFY-step templates were absent from TEMPLATES, so render_template returned
None and the CMS handler sent nothing (silent no-send). After migration 052 made
the NOTIFY steps the sole notification owners, this meant rfp_admin stopped being
notified on RFP upload / source change (the 052 regression). These tests lock
that every workflow NOTIFY template now renders, and the pre-existing ones still do.
"""
from src.templates import render_template

WORKFLOW_NOTIFY_TEMPLATES = [
    "rfp_ready_for_curation",
    "review_ready",
    "proposal_final_ready",
    "admin_proposal_review_required",
    "spotlight_new_topics",
    "source_scout_changes",
]

_SAMPLE = {
    "solicitationId": "sol-1",
    "proposalTitle": "Acme Proposal",
    "proposalId": "p-1",
    "sourceName": "AF CSO Portal",
    "draftsCreated": 3,
    "documentCount": 2,
    "textExtracted": True,
}


def test_all_workflow_notify_templates_render():
    for name in WORKFLOW_NOTIFY_TEMPLATES:
        html = render_template(name, _SAMPLE)
        assert html, f"{name} renders None -> silent no-send"
        assert "<" in html


def test_templates_render_even_with_empty_payload():
    # Defensive p.get() must never crash / return None on missing fields.
    for name in WORKFLOW_NOTIFY_TEMPLATES:
        assert render_template(name, {}), f"{name} failed on empty payload"


def test_052_regression_rfp_and_source_notifications_restored():
    assert render_template("rfp_ready_for_curation", _SAMPLE)
    assert render_template("source_scout_changes", _SAMPLE)


def test_preexisting_templates_unbroken():
    for name in ["new_rfp_uploaded", "welcome_accepted", "admin_notification",
                 "source_change_detected", "stage_advanced"]:
        assert render_template(name, _SAMPLE), f"{name} regressed"
