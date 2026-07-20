"""
================================================================================
Workflow: OnSolicitationUpdateScan  (scout expansion — proactive update watcher)
================================================================================

TRIGGER:    finder:solicitation.update_scan_requested:single
            Emitted on a cadence (every 6h) by the SHARED cron manager
            (run_type='event' row in pipeline_schedules → tick_schedules). UTC.

PURPOSE:    "Look for updates." Rather than only reacting to a source-change event,
            this proactively re-scans recently-updated solicitations for
            compliance-affecting AMENDMENTS (close-date changes, new requirements,
            new topics) and flags the delta for the admin — so a mid-flight change
            never slips through. Reuses the amendment_monitor agent (a WATCHER).

STEPS:
    1. ai_amendment_scan (AI_INVOKE, tool.solicitation.amendment_delta → amendment_monitor)
       Reads recently-updated solicitations; flags compliance-affecting amendments. Advisory.
    2. notify_admin (NOTIFY → rfp_admin, template amendment_delta_ready). INDEPENDENT.

SAFETY: platform-scope; injection-fenced (raw solicitation text); advisory only. The
        watcher's runs + findings carry history/outcomes (scout_runs / scout_findings).

CHANGE LOG:
    (scout expansion) — Initial implementation. Proactive counterpart to the reactive
    OnSourceChangeDetected → amendment_monitor path.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnSolicitationUpdateScan(Workflow):
    description = "Proactively re-scan active solicitations for compliance-affecting updates"

    trigger = EventTrigger(
        namespace="finder",
        type="solicitation.update_scan_requested",
        phase="single",
    )

    steps = [
        Step(
            name="ai_amendment_scan",
            step_type=StepType.AI_INVOKE,
            action="tool.solicitation.amendment_delta",
            input_map={},  # platform-scope; the agent reads recently-updated solicitations itself
            timeout_minutes=10,
        ),
        Step(
            name="notify_admin",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "template": '"amendment_delta_ready"',
                "to_role": '"rfp_admin"',
            },
        ),
    ]
