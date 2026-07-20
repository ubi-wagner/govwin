"""
================================================================================
Workflow: OnContentResurfaceRequested  (our-org CMS — scheduled content scout)
================================================================================

TRIGGER:    library:content.resurface_requested:single
            Emitted on a cadence by the SHARED cron manager (a run_type='event' row
            in pipeline_schedules → ingest.dispatcher.tick_schedules). UTC-canonical.

PURPOSE:    Run the content_curator (the social/web content SCOUT) over the latest
            crawler findings (scout_findings, purpose=content) and email a curated
            reshare list to the team inbox for approval. Advisory — a human approves
            before anything is posted.

STEPS:
    1. ai_content_curate (AI_INVOKE, tool.content.curate → content_curator)
       Reads new scout_findings, drafts repost-worthy reshares. Advisory.
    2. email_curation (NOTIFY → to_email eric@rfppipeline.com, template
       content_reshare_ready). INDEPENDENT so a skipped agent never dead-ends.

SAFETY: platform-scope; injection-fenced (crawled text is untrusted); never
        auto-posts. The crawler worker (writes scout_findings) is the producer.

CHANGE LOG:
    (POD 1 / our-org CMS) — Initial implementation.
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnContentResurfaceRequested(Workflow):
    description = "Curate crawler content findings into reshare drafts, emailed for approval"

    trigger = EventTrigger(
        namespace="library",
        type="content.resurface_requested",
        phase="single",
    )

    steps = [
        Step(
            name="ai_content_curate",
            step_type=StepType.AI_INVOKE,
            action="tool.content.curate",
            input_map={},  # platform-scope; the agent reads scout_findings itself
            timeout_minutes=10,
        ),
        Step(
            name="email_curation",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "template": '"content_reshare_ready"',
                "to_role": '"rfp_admin"',
                "to_email": '"eric@rfppipeline.com"',
            },
        ),
    ]
