"""
================================================================================
Workflow: OnCmsContentRequested  (CMS content vertical — keystone proof)
================================================================================

TRIGGER:  library:content.requested:single   (condition: payload.title present)
          Launched by emitting this event with an OVERLAY payload — the frozen
          per-launch parameters. namespace=library per CLAUDE.md's canonical
          "library (content)" mapping (the library.* TOOL events are a separate
          concern; these are content-lifecycle events).

PURPOSE:  Prove the keystone end to end on the smallest real content chain:
          launch-with-overlay -> seed/AI draft -> HUMAN REVIEW (a ToDo gate written
          to the unified tasks ledger + nudged on the overlay's cadence) -> publish
          -> notify. The template is code (this file; revision control = filename);
          the process_templates catalog row is its activation/audit switch; the
          overlay is process_instances.payload, frozen at create and immutable
          forward (force-advance aside).

STEPS:
    1. draft_content   (ACTION) — write a DRAFT content_pages version from the overlay.
    2. review          (TODO)   — park; write a content_publish task for rfp_admin,
                                  nudged on the overlay cadence. Completing the task
                                  = approval -> resume from the next step.
    3. publish_content (ACTION, depends_on review) — promote the approved draft to
                                  active (archiving the prior active + sibling drafts).
    4. notify_author   (NOTIFY, depends_on publish_content) — announce publication.

OVERLAY (payload) fields:
    title (required), brief, contentType, slug, excerpt, author, tags[], createdBy,
    nudgeDays[] (e.g. [1,3] days-before-due), reviewDueMinutes (task due window).

DESIGN NOTES:
    - assignee_role is the literal "rfp_admin" (not payload-driven): the engine has
      no "payload value OR default" resolution, and a missing payload field would
      make _create_task fall back to the raw path string. rfp_admin owns content
      curation; an overlay-selectable reviewer is a follow-up once the engine grows
      a defaulting resolver.
    - The review ToDo resumes via task completion (no wait_for) — completing it is
      the approval. A reviewer who rejects cancels / force-fails the instance from
      the Process Ledger rather than publishing.
    - notify_author emits system:notification.requested with template
      "content_published"; adding that template to services/cms/src/templates.py is
      a follow-up (a missing template degrades to no-email, never a hard failure).
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnCmsContentRequested(Workflow):
    description = (
        "CMS content vertical: draft a content_pages version from the launch "
        "overlay, park at a human review ToDo, then publish on approval and notify."
    )

    trigger = EventTrigger(
        namespace="library",
        type="content.requested",
        phase="single",
        # A launch must name what to write; guards junk launches with no title.
        condition=lambda payload: bool(payload.get("title")),
    )

    steps = [
        # AI actor (our-org CMS): the content_generator drafts web + social copy from the brief,
        # grounded in our published voice — ADVISORY input to the human review. Independent (no
        # depends_on) so it runs alongside the deterministic draft and never blocks the pipeline.
        # Outbound content is human-approved before publish (brand-voice guardrail).
        Step(
            name="ai_content_generate",
            step_type=StepType.AI_INVOKE,
            action="tool.content.generate",
            input_map={
                "title": "payload.title",
                "brief": "payload.brief",
                "contentType": "payload.contentType",
                "tags": "payload.tags",
            },
            timeout_minutes=10,
        ),
        Step(
            name="draft_content",
            action="workflows.actions.cms_content.draft_content",
            step_type=StepType.ACTION,
            input_map={
                "title": "payload.title",
                "brief": "payload.brief",
                "content_type": "payload.contentType",
                "slug": "payload.slug",
                "excerpt": "payload.excerpt",
                "author": "payload.author",
                "tags": "payload.tags",
                "created_by": "payload.createdBy",
            },
            timeout_minutes=10,
        ),
        Step(
            name="review",
            step_type=StepType.TODO,
            action="todo",
            depends_on="draft_content",
            task_type='"content_publish"',
            task_title='"Review & approve content for publication"',
            assignee_role='"rfp_admin"',
            entity_type='"content_pages"',
            entity_ref="step.draft_content.result.contentId",
            nudge_days="payload.nudgeDays",
            due_in_minutes="payload.reviewDueMinutes",
            timeout_minutes=4320,  # 72h park window for the review gate
        ),
        Step(
            name="publish_content",
            action="workflows.actions.cms_content.publish_content",
            step_type=StepType.ACTION,
            depends_on="review",
            input_map={
                "content_id": "step.draft_content.result.contentId",
                "slug": "step.draft_content.result.slug",
            },
            timeout_minutes=5,
        ),
        Step(
            name="notify_author",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="publish_content",
            input_map={
                "channel": '"email"',
                "template": '"content_published"',
                "slug": "step.publish_content.result.slug",
            },
        ),
    ]
