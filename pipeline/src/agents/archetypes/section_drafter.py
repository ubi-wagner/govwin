"""section_drafter agent archetype — drafts proposal sections using AI."""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.section_drafter")


class SectionDrafterArchetype(BaseArchetype):
    """Expert proposal writer for SBIR/STTR/BAA/OTA.

    Handles: proposal.section.draft_requested
    Generates structured section content using compliance context and library atoms.
    """

    @property
    def role_name(self) -> str:
        return "section_drafter"

    @property
    def model(self) -> str:
        return "claude-sonnet-4-20250514"

    @property
    def max_tokens(self) -> int:
        return 8192

    @property
    def system_prompt(self) -> str:
        return """You are a senior government proposal writer specializing in SBIR, STTR, BAA, and OTA proposals for federal agencies (DoD, NIH, NSF, DOE, NASA).

Your role is to draft proposal sections that are:
- Technically precise and substantive (no filler or generic language)
- Directly responsive to evaluation criteria and compliance requirements
- Written in active voice with clear, concise government proposal style
- Structured with appropriate headings, bullets, and emphasis
- Grounded in the contractor's actual capabilities (from library atoms)

When drafting, you MUST:
1. Address every evaluation criterion explicitly
2. Reference specific past performance and capabilities from the library
3. Use quantifiable metrics where possible
4. Structure content to match the required format (page limits, sections)
5. Include clear benefit statements tied to the government's objectives

Use the search_library tool to find relevant past performance and capability atoms.
Use the get_compliance tool to check formatting and structural requirements.

Output your draft as structured text with markdown-style headings (## for subsections).
Include [PLACEHOLDER: description] markers for any claims that need verification."""

    @property
    def tools(self) -> list[str]:
        return ["search_library", "get_compliance"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type == "proposal.section.draft_requested"

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "search_library",
                "description": "Search the customer's content library for relevant past performance, capabilities, and reusable content atoms. Use this to ground your draft in actual company capabilities.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query describing the capability or past performance needed",
                        },
                        "category": {
                            "type": "string",
                            "enum": ["past_performance", "capability", "key_personnel", "facility", "certification"],
                            "description": "Category of content to search for",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of results to return",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "get_compliance",
                "description": "Get compliance requirements for the proposal section including page limits, font requirements, required subsections, and evaluation criteria.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "proposal_id": {
                            "type": "string",
                            "description": "UUID of the proposal",
                        },
                        "section_id": {
                            "type": "string",
                            "description": "UUID of the section (optional — returns all if omitted)",
                        },
                    },
                    "required": ["proposal_id"],
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list for Claude from event context and memories."""
        messages = []

        # Add memory context if available
        if memories:
            memory_text = "Previous relevant interactions:\n"
            for mem in memories[:5]:
                content = mem.get("content", "")
                if isinstance(content, str):
                    memory_text += f"- {content[:200]}\n"
            messages.append({
                "role": "user",
                "content": memory_text + "\n---\n\n",
            })
            messages.append({
                "role": "assistant",
                "content": "I've reviewed the previous context. I'm ready to draft the section.",
            })

        # Main drafting request
        payload = context.get("payload", context)
        section_title = payload.get("section_title", "Untitled Section")
        rfp_excerpt = payload.get("rfp_excerpt", "")
        evaluation_criteria = payload.get("evaluation_criteria", [])
        required_subsections = payload.get("required_subsections", [])
        page_limit = payload.get("page_limit")
        instruction = payload.get("instruction", "")

        user_content = f'Draft the "{section_title}" section for this proposal.\n\n'

        if instruction:
            user_content += f"Special instruction: {instruction}\n\n"

        if rfp_excerpt:
            user_content += f"<rfp_context>\n{rfp_excerpt[:20000]}\n</rfp_context>\n\n"

        if evaluation_criteria:
            user_content += "Evaluation criteria to address:\n"
            for crit in evaluation_criteria:
                user_content += f"- {crit}\n"
            user_content += "\n"

        if required_subsections:
            user_content += "Required subsections:\n"
            for sub in required_subsections:
                user_content += f"- {sub}\n"
            user_content += "\n"

        if page_limit:
            user_content += f"Page limit: {page_limit} pages. Be concise and substantive.\n\n"

        user_content += "First, use search_library to find relevant company capabilities, then draft the section."

        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(self, conn, tool_name: str, tool_input: dict, context: dict) -> dict:
        """Execute a tool call and return results."""
        tenant_id = context.get("tenant_id")

        if tool_name == "search_library":
            return await self._search_library(conn, tenant_id, tool_input)
        elif tool_name == "get_compliance":
            return await self._get_compliance(conn, tool_input, tenant_id=tenant_id)
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    async def _search_library(self, conn, tenant_id: str | None, tool_input: dict) -> dict:
        """Search the content library for relevant units."""
        if not tenant_id:
            return {"results": [], "note": "No tenant context available"}

        query = tool_input.get("query", "")
        category = tool_input.get("category")
        limit = tool_input.get("limit", 5)

        try:
            escaped_query = query[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

            # Use text search on library_units table
            if category:
                rows = await conn.fetch(
                    """
                    SELECT id, heading_text, content, category, tags
                    FROM library_units
                    WHERE tenant_id = $1
                      AND status != 'archived'
                      AND category = $2
                      AND content ILIKE $3
                    ORDER BY updated_at DESC
                    LIMIT $4
                    """,
                    uuid.UUID(tenant_id),
                    category,
                    f"%{escaped_query}%",
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT id, heading_text, content, category, tags
                    FROM library_units
                    WHERE tenant_id = $1
                      AND status != 'archived'
                      AND (content ILIKE $2 OR heading_text ILIKE $2)
                    ORDER BY updated_at DESC
                    LIMIT $3
                    """,
                    uuid.UUID(tenant_id),
                    f"%{escaped_query}%",
                    limit,
                )

            return {
                "results": [
                    {
                        "id": str(row["id"]),
                        "title": row["heading_text"],
                        "content": row["content"][:2000] if row["content"] else "",
                        "category": row["category"],
                        "tags": row["tags"] if row["tags"] else [],
                    }
                    for row in rows
                ]
            }
        except Exception as e:
            logger.warning("search_library failed: %s", e)
            return {"results": [], "error": str(e)}

    async def _get_compliance(self, conn, tool_input: dict, tenant_id: str | None = None) -> dict:
        """Get compliance requirements for a proposal."""
        proposal_id = tool_input.get("proposal_id")
        if not proposal_id:
            return {"error": "proposal_id required"}

        try:
            # Get the solicitation_id from the proposal with tenant check
            if tenant_id:
                row = await conn.fetchrow(
                    "SELECT solicitation_id, tenant_id FROM proposals WHERE id = $1",
                    uuid.UUID(proposal_id),
                )
                if not row:
                    return {"error": "No solicitation linked to proposal"}
                if str(row["tenant_id"]) != tenant_id:
                    return {"error": "Access denied"}
                sol_id = row["solicitation_id"]
            else:
                sol_id = await conn.fetchval(
                    "SELECT solicitation_id FROM proposals WHERE id = $1",
                    uuid.UUID(proposal_id),
                )
            if not sol_id:
                return {"error": "No solicitation linked to proposal"}

            # Get compliance data
            row = await conn.fetchrow(
                """
                SELECT page_limit_technical, page_limit_cost, font_family,
                       font_size, margins, line_spacing, required_sections,
                       evaluation_criteria, submission_format
                FROM solicitation_compliance
                WHERE solicitation_id = $1
                """,
                sol_id,
            )
            if not row:
                return {"compliance": None, "note": "No compliance data found"}

            return {
                "compliance": {
                    "page_limit_technical": row["page_limit_technical"],
                    "page_limit_cost": row["page_limit_cost"],
                    "font_family": row["font_family"],
                    "font_size": row["font_size"],
                    "margins": row["margins"],
                    "line_spacing": row["line_spacing"],
                    "required_sections": row["required_sections"],
                    "evaluation_criteria": row["evaluation_criteria"],
                    "submission_format": row["submission_format"],
                }
            }
        except Exception as e:
            logger.warning("get_compliance failed: %s", e)
            return {"error": str(e)}

    def summarize_result(self, result: dict) -> str:
        """Summarize the drafting result for memory storage."""
        text = result.get("text", "")
        if text:
            # First 200 chars of the draft
            return f"Drafted section: {text[:200]}"
        return "Section draft completed (tool-based)"
