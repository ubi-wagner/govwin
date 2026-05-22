"""color_team_reviewer agent archetype — evaluates proposals against criteria."""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.color_team_reviewer")


class ColorTeamReviewerArchetype(BaseArchetype):
    """Red/Pink/Gold team reviewer for government proposals.

    Handles: proposal.review_requested
    Evaluates proposal sections against evaluation criteria and compliance requirements.
    Produces structured review with scores, strengths, weaknesses, and recommendations.
    """

    @property
    def role_name(self) -> str:
        return "color_team_reviewer"

    @property
    def model(self) -> str:
        return "claude-sonnet-4-20250514"

    @property
    def max_tokens(self) -> int:
        return 8192

    @property
    def system_prompt(self) -> str:
        return """You are an expert government proposal reviewer conducting a formal color team review (Red/Pink/Gold team). You have 20+ years of experience evaluating federal proposals for SBIR, STTR, BAA, and OTA opportunities.

Your review methodology:
1. COMPLIANCE CHECK: Verify all mandatory requirements are addressed
2. EVALUATION SCORING: Score against each evaluation criterion (Outstanding/Good/Acceptable/Marginal/Unacceptable)
3. STRENGTHS: Identify compelling differentiators and well-articulated value
4. WEAKNESSES: Identify gaps, vague claims, unsupported assertions
5. RISKS: Flag potential disqualification issues or significant deficiencies
6. RECOMMENDATIONS: Provide specific, actionable improvement suggestions

Scoring rubric:
- Outstanding (Blue): Exceeds requirements, innovative approach, very high confidence of success
- Good (Green): Fully meets requirements, clear strengths, high confidence
- Acceptable (Yellow): Meets minimum requirements, no significant weaknesses
- Marginal (Orange): Partially meets requirements, significant weaknesses present
- Unacceptable (Red): Fails to meet requirements, major deficiencies

You MUST be specific in your feedback. Reference exact text from the proposal.
Generic feedback like "could be stronger" is not acceptable — explain HOW.

Use get_eval_criteria to understand what the government is looking for.
Use get_compliance_matrix to check if all requirements are addressed."""

    @property
    def tools(self) -> list[str]:
        return ["get_eval_criteria", "get_compliance_matrix"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type == "proposal.review_requested"

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "get_eval_criteria",
                "description": "Get the evaluation criteria for this proposal's solicitation. Returns the criteria, their relative weights, and any scoring guidance from the solicitation.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "proposal_id": {
                            "type": "string",
                            "description": "UUID of the proposal to review",
                        },
                    },
                    "required": ["proposal_id"],
                },
            },
            {
                "name": "get_compliance_matrix",
                "description": "Get the compliance requirements matrix for this proposal, showing which requirements have been addressed and which are missing.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "proposal_id": {
                            "type": "string",
                            "description": "UUID of the proposal to review",
                        },
                    },
                    "required": ["proposal_id"],
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list for Claude from event context and memories."""
        messages = []

        # Add memory context (previous reviews for this tenant)
        if memories:
            memory_text = "Previous review patterns for this team:\n"
            for mem in memories[:3]:
                content = mem.get("content", "")
                if isinstance(content, str):
                    memory_text += f"- {content[:150]}\n"
            messages.append({
                "role": "user",
                "content": memory_text + "\n---\n\n",
            })
            messages.append({
                "role": "assistant",
                "content": "I've noted the previous review patterns. I'll maintain consistency while providing fresh analysis.",
            })

        # Main review request
        payload = context.get("payload", context)
        proposal_id = payload.get("proposal_id", "")
        section_text = payload.get("section_text", "")
        section_title = payload.get("section_title", "Full Proposal")
        review_type = payload.get("review_type", "red_team")
        rfp_title = payload.get("rfp_title", "")

        review_labels = {
            "red_team": "Red Team (final pre-submission review — focus on win themes and compliance)",
            "pink_team": "Pink Team (mid-development review — focus on responsiveness and structure)",
            "gold_team": "Gold Team (executive review — focus on strategy and pricing alignment)",
        }

        user_content = f"Conduct a {review_labels.get(review_type, review_type)} review.\n\n"

        if rfp_title:
            user_content += f"RFP: {rfp_title}\n"
        user_content += f"Section: {section_title}\n"
        user_content += f"Proposal ID: {proposal_id}\n\n"

        if section_text:
            user_content += f"<proposal_section>\n{section_text[:30000]}\n</proposal_section>\n\n"

        user_content += """First, use get_eval_criteria and get_compliance_matrix to understand the requirements.

Then provide your review in this structure:
1. Overall Score (Outstanding/Good/Acceptable/Marginal/Unacceptable)
2. Compliance Status (compliant/partially compliant/non-compliant)
3. Strengths (specific, with quotes from the text)
4. Weaknesses (specific, with recommendations)
5. Risks (potential disqualification or scoring issues)
6. Priority Recommendations (ordered by impact)"""

        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(self, conn, tool_name: str, tool_input: dict, context: dict) -> dict:
        """Execute a tool call and return results."""
        if tool_name == "get_eval_criteria":
            return await self._get_eval_criteria(conn, tool_input)
        elif tool_name == "get_compliance_matrix":
            return await self._get_compliance_matrix(conn, tool_input)
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    async def _get_eval_criteria(self, conn, tool_input: dict) -> dict:
        """Get evaluation criteria for the proposal's solicitation."""
        proposal_id = tool_input.get("proposal_id")
        if not proposal_id:
            return {"error": "proposal_id required"}

        try:
            sol_id = await conn.fetchval(
                "SELECT solicitation_id FROM proposals WHERE id = $1",
                uuid.UUID(proposal_id),
            )
            if not sol_id:
                return {"criteria": [], "note": "No solicitation linked"}

            row = await conn.fetchrow(
                """
                SELECT evaluation_criteria, required_sections
                FROM solicitation_compliance
                WHERE solicitation_id = $1
                """,
                sol_id,
            )
            if not row:
                return {"criteria": [], "note": "No compliance data found"}

            return {
                "evaluation_criteria": row["evaluation_criteria"] or [],
                "required_sections": row["required_sections"] or [],
            }
        except Exception as e:
            logger.warning("get_eval_criteria failed: %s", e)
            return {"error": str(e)}

    async def _get_compliance_matrix(self, conn, tool_input: dict) -> dict:
        """Get the compliance matrix showing addressed/unaddressed requirements."""
        proposal_id = tool_input.get("proposal_id")
        if not proposal_id:
            return {"error": "proposal_id required"}

        try:
            # Get proposal sections with their requirement mappings
            sections = await conn.fetch(
                """
                SELECT id, section_number, title, requirement_ids, status, ai_confidence
                FROM proposal_sections
                WHERE proposal_id = $1
                ORDER BY section_number ASC
                """,
                uuid.UUID(proposal_id),
            )

            # Get compliance requirements from the linked solicitation
            sol_id = await conn.fetchval(
                "SELECT solicitation_id FROM proposals WHERE id = $1",
                uuid.UUID(proposal_id),
            )

            compliance = None
            if sol_id:
                row = await conn.fetchrow(
                    """
                    SELECT page_limit_technical, required_sections,
                           required_documents, evaluation_criteria,
                           font_family, font_size, submission_format
                    FROM solicitation_compliance
                    WHERE solicitation_id = $1
                    """,
                    sol_id,
                )
                if row:
                    compliance = dict(row)

            return {
                "sections": [
                    {
                        "id": str(s["id"]),
                        "section_number": s["section_number"],
                        "title": s["title"],
                        "requirement_ids": s["requirement_ids"] or [],
                        "status": s["status"],
                        "ai_confidence": float(s["ai_confidence"]) if s["ai_confidence"] else None,
                    }
                    for s in sections
                ],
                "compliance_requirements": compliance,
            }
        except Exception as e:
            logger.warning("get_compliance_matrix failed: %s", e)
            return {"error": str(e)}

    def summarize_result(self, result: dict) -> str:
        """Summarize the review result for memory storage."""
        text = result.get("text", "")
        if "Outstanding" in text:
            return "Review: Outstanding — proposal exceeds requirements"
        elif "Good" in text:
            return "Review: Good — proposal meets requirements with strengths"
        elif "Acceptable" in text:
            return "Review: Acceptable — meets minimum requirements"
        elif "Marginal" in text:
            return "Review: Marginal — significant weaknesses identified"
        elif "Unacceptable" in text:
            return "Review: Unacceptable — major deficiencies found"
        return f"Review completed: {text[:150]}"
