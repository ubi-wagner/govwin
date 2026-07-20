"""
================================================================================
Workflow: OnSocialScheduleRequested  (our-org CMS — scheduled social publisher)
================================================================================

TRIGGER:    system:social.schedule_requested:single
            Emitted on a cadence by the SHARED cron manager (run_type='event' row in
            pipeline_schedules → ingest.dispatcher.tick_schedules). UTC-canonical.

PURPOSE:    Run the social_scheduler (a PUBLISHER agent) to draft a week of social
            posts from our published content and email the queue to the team inbox
            for approval. Advisory — a human approves before anything is scheduled/sent.

STEPS:
    1. ai_social_schedule (AI_INVOKE, tool.social.schedule → social_scheduler)
       Reads published content_pages, drafts platform-appropriate posts. Advisory.
    2. email_social_queue (NOTIFY → to_email eric@rfppipeline.com, template
       social_queue_ready). INDEPENDENT so a skipped agent never dead-ends.

SAFETY: platform-scope; never auto-posts (human-approve-before-send).

CHANGE LOG:
    (POD 1 / our-org CMS) — Initial implementation.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnSocialScheduleRequested(Workflow):
    description = "Draft a week of social posts from published content, emailed for approval"

    trigger = EventTrigger(
        namespace="system",
        type="social.schedule_requested",
        phase="single",
    )

    steps = [
        Step(
            name="ai_social_schedule",
            step_type=StepType.AI_INVOKE,
            action="tool.social.schedule",
            input_map={},  # platform-scope; the agent reads published content itself
            timeout_minutes=10,
        ),
        Step(
            name="email_social_queue",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "template": '"social_queue_ready"',
                "to_role": '"rfp_admin"',
                "to_email": '"eric@rfppipeline.com"',
            },
        ),
    ]
