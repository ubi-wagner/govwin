"""
================================================================================
Workflow: OnOpsDigestRequested  (POD 4 — first SCHEDULED admin automation)
================================================================================

TRIGGER:    system:ops.digest_requested:single
            Emitted on a schedule by run_ops_digest_scheduler (pipeline main loop)
            — NOT by a user action. The workflow engine is otherwise event-only;
            this is the bridge from "on a schedule" to "an event fires".

PURPOSE:    Compile and deliver the periodic ops health digest to the master_admin:
            agent-workforce usage, pipeline health (triage backlog, curation-pending,
            SLA breaches), and alerts. The ops_digest agent reads cross-tenant
            AGGREGATES at our authority (platform-scope; bypass connection).

STEPS:
    1. ai_ops_digest (AI_INVOKE)
       Action: tool.ops.digest → ops_digest (platform-scope, tenant_id=None)
       Output: the digest JSON (advisory), or skipped if the fabric/API key is
               unavailable (V1). Timeout 10 minutes.
    2. notify_master_admin (NOTIFY)
       Action: system.notify → to_role master_admin, template ops_digest_ready.
       INDEPENDENT of the agent step so a skipped/failed digest never dead-ends;
       the full digest is surfaced in /admin/agents from the agent-output event.

SAFETY:
    - Platform-scope: reads only AGGREGATE counts/metrics — no untrusted free text
      enters the prompt, so there is no injection surface. Advisory; mutates nothing.
    - No dead-end: unmapped/failed AI_INVOKE = safe skip; notify is independent.

ADMIN NOTES:
    - Cadence tunable via OPS_DIGEST_INTERVAL_HOURS (default 24h). Single-replica
      assumption; the processor dedups by trigger_event_id.

CHANGE LOG:
    #131 (POD 4) — Initial implementation: scheduled ops digest.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnOpsDigestRequested(Workflow):
    description = "Compile + deliver the scheduled ops health digest to master_admin"

    trigger = EventTrigger(
        namespace="system",
        type="ops.digest_requested",
        phase="single",
    )

    steps = [
        Step(
            name="ai_ops_digest",
            step_type=StepType.AI_INVOKE,
            action="tool.ops.digest",
            input_map={},  # platform-scope; the agent reads cross-tenant aggregates itself
            timeout_minutes=10,
        ),
        Step(
            name="notify_master_admin",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "to_role": '"master_admin"',
                "template": '"ops_digest_ready"',
            },
        ),
    ]
