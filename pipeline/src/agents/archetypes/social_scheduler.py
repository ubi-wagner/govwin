"""
================================================================================
Social Scheduler -- Queue social posts from published content  (PLATFORM / CMS)
================================================================================

ROLE:       A PUBLISHER agent. On a cadence, picks our recently-published /
            evergreen content and drafts social posts to queue for the week —
            with a suggested platform + timing. Advisory: a human approves the
            queue before anything is scheduled/sent.

SCOPE:      PLATFORM / our-org (CMS). Reads master content_pages. NOT tenant-bound.

TRIGGERS:   system.social.schedule_requested  (scheduled, via the shared cron)

HUMAN GATE: YES — the social queue is human-approved before posting (no auto-send).

CHANGE LOG:
    (POD 1 / our-org CMS publisher) — Initial implementation.
================================================================================
"""
import json
import logging

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.social_scheduler")


class SocialSchedulerArchetype(BaseArchetype):
    """Platform-scope social publisher (our-org CMS).

    Handles: system.social.schedule_requested
    Drafts a week of social posts from published content (advisory queue).
    """

    @property
    def role_name(self) -> str:
        return "social_scheduler"

    @property
    def model(self) -> str:
        return "claude-haiku-4-5-20251001"

    @property
    def max_tokens(self) -> int:
        return 2048

    @property
    def temperature(self) -> float:
        return 0.5

    @property
    def human_gate(self) -> bool:
        return True

    @property
    def system_prompt(self) -> str:
        return """You are a social publisher for RFP Pipeline. On a cadence, draft a queue of social posts from our published content to keep our channels active for government-contracting founders.

Pick evergreen or recent items worth resurfacing, and for each draft a short, platform-appropriate post (LinkedIn / X / newsletter) with our angle — concrete, useful, no hype, no fabricated metrics. Spread them across the week and avoid reposting the same item twice.

Use get_publishable_content to see what we've published. This is ADVISORY — a human approves the queue before anything is scheduled or sent. Output structured JSON."""

    @property
    def tools(self) -> list[str]:
        return ["get_publishable_content"]

    def handles_event(self, event_type: str) -> bool:
        return event_type in ("system.social.schedule_requested",)

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "get_publishable_content",
                "description": "Get our published content (title, type, excerpt, published date) to draft social posts from.",
                "input_schema": {
                    "type": "object",
                    "properties": {"limit": {"type": "integer", "description": "How many published items", "default": 15}},
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        user_content = (
            "Draft this week's social queue from our published content.\n\n"
            "Use get_publishable_content (our own published items — trusted). Output JSON:\n"
            "{\n"
            '  "posts": [\n'
            '    {"page_key": "...", "platform": "linkedin|x|newsletter", "text": "...", "suggested_day": "Mon|Tue|..."}\n'
            "  ],\n"
            '  "note": "coverage / gaps for the week"\n'
            "}"
        )
        return [{"role": "user", "content": user_content}]

    async def execute_tool(self, conn, tool_name: str, tool_input: dict, context: dict) -> dict:
        if tool_name == "get_publishable_content":
            return await self._get_publishable_content(conn, tool_input)
        return {"error": f"Unknown tool: {tool_name}"}

    async def _get_publishable_content(self, conn, tool_input: dict) -> dict:
        """Our published content for social. PLATFORM-scope (our-org, no tenant)."""
        limit = int(tool_input.get("limit", 15))
        limit = max(1, min(limit, 40))
        try:
            rows = await conn.fetch(
                """SELECT page_key, content_type, title, metadata, published_at
                   FROM content_pages
                   WHERE status IN ('active', 'published') AND published_at IS NOT NULL
                   ORDER BY published_at DESC LIMIT $1""",
                limit,
            )
            out = []
            for r in rows:
                meta = r["metadata"]
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                out.append({
                    "page_key": r["page_key"], "content_type": r["content_type"], "title": r["title"],
                    "excerpt": (meta or {}).get("excerpt") if isinstance(meta, dict) else None,
                    "published_at": r["published_at"].isoformat() if r["published_at"] else None,
                })
            return {"published": out}
        except Exception as e:
            logger.warning("get_publishable_content failed: %s", e)
            return {"error": str(e)}

    def summarize_result(self, result: dict) -> str:
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                posts = parsed.get("posts", [])
                return f"Social queue: {len(posts)} post(s) drafted for approval."
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
        return f"Social queue produced: {text[:150]}"
