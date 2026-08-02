"""
================================================================================
Workflow: OnIngestAssessmentRequested  (Admin-agent Phase 1 — ingest orchestration)
================================================================================

TRIGGER:    finder:ingest.assessment_requested:end
            (an rfp_admin hit "Assess ingest readiness" on a curated solicitation —
             POST /api/admin/rfp-curation/[solId]/assess-ingest.)

PURPOSE:    Run the ingest MANAGER over a curated solicitation. rfp_ingest_manager
            reads the ingest state (shred/extract -> compliance matrix -> master
            skeleton), infers the pipeline STAGE, and returns an ADVISORY
            coordination plan: which specialist agents (ingest_analyst /
            matrix_stager / skeleton_architect / curation_qa) to run next, what is
            blocking release, and a prioritized next-action plan for the admin.

            The platform-scope, admin-invoked counterpart to the tenant-side
            OnFullDraftRequested (proposal_manager plans a draft; this plans an
            ingest). No tenant to bind (our-org data). Advisory only — the admin
            runs the recommended agents / requests review / pushes.

STEPS:
    1. ai_ingest_manager (AI_INVOKE)
       Action: tool.ingest.assess  -> rfp_ingest_manager (platform-scope)
       Input: solicitation_id from the request payload.
       Output: the readiness report + agent_plan, or safe-skipped if the
               fabric / API key is unavailable.
       Independent (no depends_on) — advisory; the admin still decides.

    2. notify_admin (NOTIFY)
       Action: system.notify -> rfp_admin, template ingest_assessment_ready.
       INDEPENDENT of the agent step, so a skipped/failed assessment never
       dead-ends the admin — they are routed either way.

HITL GATE:
    - The admin runs the recommended agents, requests review, or pushes. The
      report is advisory input; it never runs an agent, changes status, or pushes.

SAFETY (Phase 1):
    - Platform-scope (our-org ops); no tenant to bind. The agent runs under the
      fabric runaway/dead-end caps and the mandatory injection fence (raw
      solicitation text is delimited as untrusted). Advisory only — never
      auto-applied, never a business-table write. docs/ADMIN_AGENT_DESIGN.md.

CHANGE LOG:
    Phase 1 — Initial implementation: admin-invoked ingest orchestration manager.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnIngestAssessmentRequested(Workflow):
    description = "Run the advisory ingest-orchestration manager when an admin requests an ingest assessment"

    trigger = EventTrigger(
        namespace="finder",
        type="ingest.assessment_requested",
        phase="end",
    )

    steps = [
        # AI actor: rfp_ingest_manager assesses the ingest pipeline stage + recommends the
        # specialist-agent plan — ADVISORY. Independent so a skip never blocks the admin.
        Step(
            name="ai_ingest_manager",
            step_type=StepType.AI_INVOKE,
            action="tool.ingest.assess",
            input_map={"solicitation_id": "payload.solicitationId"},
            timeout_minutes=10,
        ),
        # Route the admin to the readiness report (or act manually). INDEPENDENT of the agent
        # step so a failed/skipped assessment never dead-ends the admin.
        Step(
            name="notify_admin",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "to_role": '"rfp_admin"',
                "template": '"ingest_assessment_ready"',
                "solicitation_id": "payload.solicitationId",
            },
        ),
    ]
