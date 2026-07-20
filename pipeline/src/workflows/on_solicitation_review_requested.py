"""
================================================================================
Workflow: OnSolicitationReviewRequested  (POD 4 — admin-side automation)
================================================================================

TRIGGER:    finder:solicitation.triaged:end
            Condition: payload.toState == "review_requested"
            (i.e. the `request_review` transition — an rfp_admin finished curating
             and submitted the solicitation for review, BEFORE push.)

PURPOSE:    A PRE-RELEASE QA gate for our own curation. When curation is submitted
            for review, the curation_qa agent runs an ADVISORY quality-control pass
            (completeness, compliance-matrix + master-skeleton sanity, customer-
            readiness) and routes the findings to the reviewer so problems are
            caught BEFORE `solicitation.push` puts the opportunity in customers'
            Spotlight.

            This is an ADMIN-SIDE automation workflow — most of our automation has
            lived on the tenant side; this is the curation counterpart to the
            tenant proposal-review gate.

STEPS:
    1. ai_curation_qa (AI_INVOKE)
       Action: tool.curation.qa  → curation_qa (platform-scope)
       Input: solicitation_id from the triage payload.
       Output: QA report (ready_to_release, blocking_issues, advisories), or
               skipped if the fabric/API key is unavailable (V1).
       Timeout: 10 minutes
       Independent (no depends_on) — advisory; the reviewer still reviews.

    2. notify_reviewer (NOTIFY)
       Action: system.notify → rfp_admin, template curation_qa_ready.
       INDEPENDENT of the agent step, so a skipped/failed QA never dead-ends the
       review gate — the reviewer is routed either way.

HITL GATE:
    - The human reviewer approves / returns-to-curation / pushes. The QA report is
      advisory input to that decision; it never changes status or pushes.

SAFETY (#117/#120):
    - Platform-scope (our-org QC); no tenant to bind. The agent still runs under
      the fabric runaway/dead-end caps and the injection fence (raw solicitation
      text is delimited as untrusted). Advisory only — never auto-applied.

CHANGE LOG:
    #130 (POD 4) — Initial implementation: pre-release curation QA gate.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnSolicitationReviewRequested(Workflow):
    description = "Run an advisory pre-release QA pass when curation is submitted for review"

    trigger = EventTrigger(
        namespace="finder",
        type="solicitation.triaged",
        phase="end",
        condition=lambda p: p.get("toState") == "review_requested",
    )

    steps = [
        # AI actor (#130): curation_qa reviews the curated solicitation + the master agents'
        # matrix/skeleton output before push — ADVISORY. Independent so a skip never blocks review.
        Step(
            name="ai_curation_qa",
            step_type=StepType.AI_INVOKE,
            action="tool.curation.qa",
            input_map={"solicitation_id": "payload.solicitationId"},
            timeout_minutes=10,
        ),
        # Route the reviewer to review the QA findings (or review manually). INDEPENDENT of the
        # agent step so a failed/skipped QA never dead-ends the release gate.
        Step(
            name="notify_reviewer",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "to_role": '"rfp_admin"',
                "template": '"curation_qa_ready"',
                "solicitation_id": "payload.solicitationId",
            },
        ),
    ]
