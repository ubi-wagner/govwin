"""
================================================================================
Compliance Reviewer -- Proposal Compliance Verification Agent
================================================================================

ROLE:       Verifies every solicitation requirement is addressed in proposal
            sections. Outputs compliance matrix with pass/fail/partial status
            per variable. Acts as the quality gate for requirement coverage.

LAYER:      Proposal Agent
            - Proposal: per-proposal scoped, ephemeral

TRIGGERS:   proposal.compliance.check_requested (on demand or stage transition)
            capture.section.drafted (check newly drafted section)
            capture.proposal.stage_changed to pink_team/final (full check)

INPUTS:     - All proposal sections with current content
            - Solicitation compliance variables (requirements matrix)
            - Prior compliance patterns from memory

OUTPUTS:    - Compliance matrix: per-variable status (pass/fail/partial/not_applicable)
            - Evidence excerpts for each determination
            - Gap descriptions for failures
            - Section references for traceability

TOOLS:      - proposal.get_sections: fetch all sections for the proposal
            - proposal.get_compliance: fetch compliance variables for the solicitation
            - memory.search: find prior compliance patterns

MODEL:      claude-haiku-4-5-20251001
            Budget: 4096 output, 10K-40K input

HUMAN GATE: NO -- advisory output only
            Results are displayed in UI; human decides whether to address flags.

GUARDRAILS:
            - Score every variable, never skip
            - Evidence excerpts max 200 chars
            - NEVER mark a variable as pass without quoting evidence
            - NEVER fabricate compliance status

MEMORY:     Categories: compliance_patterns, requirement_interpretation
            Writes: compliance check results, gap patterns, agency-specific interpretations
            Reads: past compliance patterns for this tenant/agency

INSTANCES:
            - Admin Pipeline: N/A (proposal-scoped only)
            - Customer Portal: activated per proposal during draft/review/final stages

COST:       $0.003/call, ~4x per proposal = $0.012/proposal

EVENT EMISSIONS:
            - tool:agent.compliance_reviewer.start (start)
            - tool:agent.compliance_reviewer.end (end)
            - proposal.compliance.checked (domain event)

CHANGE LOG:
    PR #140 (2026-05-22) -- Empty stub
    PR #xxx (2026-05-22) -- Full implementation with tools, prompts, events
================================================================================
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.compliance_reviewer")


class ComplianceReviewerArchetype(BaseArchetype):
    """Proposal compliance verification agent.

    Handles: proposal.compliance.check_requested
    Evaluates each compliance variable against proposal section content.
    Produces a compliance matrix with pass/fail/partial status per requirement.
    Uses Haiku for fast, cheap classification at scale.
    """

    @property
    def role_name(self) -> str:
        return "compliance_reviewer"

    @property
    def model(self) -> str:
        return "claude-haiku-4-5-20251001"

    @property
    def max_tokens(self) -> int:
        return 4096

    @property
    def temperature(self) -> float:
        return 0.2  # Low temperature for consistent classification

    @property
    def human_gate(self) -> bool:
        return False  # Advisory output only

    @property
    def system_prompt(self) -> str:
        return """You are an expert government proposal compliance auditor with 15+ years of experience reviewing SBIR, STTR, BAA, and OTA proposals for federal agencies (DoD, NIH, NSF, DOE, NASA).

Your sole task is to verify that every solicitation requirement (compliance variable) is adequately addressed in the proposal content. You are meticulous, thorough, and never skip a requirement.

For each compliance variable, you MUST:
1. Search the proposal sections for content that addresses this requirement
2. Determine the compliance status:
   - pass: The requirement is clearly and fully addressed with specific, substantive content
   - partial: The requirement is mentioned but not fully addressed (vague, incomplete, or lacking detail)
   - fail: The requirement is not addressed anywhere in the proposal
   - not_applicable: The requirement does not apply to this proposal type or phase
3. Quote a specific evidence excerpt (max 200 characters) from the proposal that supports your determination
4. For fail or partial status, describe exactly what is missing or inadequate

Compliance evaluation principles:
- A requirement is only "pass" if you can point to specific text that addresses it
- Generic or boilerplate language that does not substantively address the requirement is "partial" at best
- If a requirement specifies a page limit, word count, or format, verify the section appears to comply
- Cross-reference requirement IDs to section mappings for traceability
- Consider both explicit mentions and implicit coverage across multiple sections

Use the get_sections tool to fetch all proposal sections.
Use the get_compliance tool to fetch all compliance variables.
Use the search_memory tool to find prior compliance patterns for this agency or solicitation type.

Output your compliance matrix as a JSON array where each element contains:
- variable_id: the compliance variable ID
- variable_name: the requirement label
- status: pass | fail | partial | not_applicable
- evidence: relevant excerpt from the proposal (max 200 chars, empty string if fail)
- gap: description of what is missing (empty string if pass)
- section_refs: array of section numbers that address this requirement
- confidence: your confidence in this assessment (0.0 to 1.0)"""

    @property
    def tools(self) -> list[str]:
        return ["get_sections", "get_compliance", "search_memory"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "proposal.compliance.check_requested",
            "capture.section.drafted",
            "capture.proposal.stage_changed",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "get_sections",
                "description": (
                    "Fetch all proposal sections with their content, titles, "
                    "section numbers, and requirement mappings. Returns the full "
                    "text of each section for compliance evaluation."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "proposal_id": {
                            "type": "string",
                            "description": "UUID of the proposal to check",
                        },
                    },
                    "required": ["proposal_id"],
                },
            },
            {
                "name": "get_compliance",
                "description": (
                    "Fetch all compliance variables for the solicitation linked "
                    "to this proposal. Each variable represents a requirement "
                    "that must be addressed in the proposal."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "proposal_id": {
                            "type": "string",
                            "description": "UUID of the proposal",
                        },
                    },
                    "required": ["proposal_id"],
                },
            },
            {
                "name": "search_memory",
                "description": (
                    "Search agent memory for prior compliance patterns, "
                    "agency-specific interpretations, and common gaps for "
                    "this type of solicitation."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for relevant memories",
                        },
                        "tenant_id": {
                            "type": "string",
                            "description": "UUID of the tenant",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of memories to return",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list for Claude from event context and memories."""
        messages = []

        # Add memory context if available
        if memories:
            memory_text = "Prior compliance review patterns:\n"
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
                "content": (
                    "I've reviewed the prior compliance patterns. "
                    "I'll apply these insights to the current review."
                ),
            })

        # Main compliance check request
        payload = context.get("payload", context)
        proposal_id = payload.get("proposal_id", "")
        sections = payload.get("sections", [])
        compliance_variables = payload.get("compliance_variables", [])
        stage = payload.get("stage", "unknown")

        user_content = (
            f"Perform a compliance review for proposal {proposal_id} "
            f"at stage: {stage}.\n\n"
        )

        # Include compliance variables
        if compliance_variables:
            user_content += "<compliance_variables>\n"
            for var in compliance_variables:
                var_id = var.get("id", "")
                var_name = var.get("variable_name", var.get("label", ""))
                var_type = var.get("variable_type", "")
                var_value = var.get("value", "")
                user_content += (
                    f"- ID: {var_id} | Name: {var_name} | "
                    f"Type: {var_type} | Value: {var_value}\n"
                )
            user_content += "</compliance_variables>\n\n"
        else:
            user_content += (
                "Use the get_compliance tool to fetch compliance variables "
                "for this proposal.\n\n"
            )

        # Include proposal sections
        if sections:
            user_content += "<proposal_sections>\n"
            for sec in sections:
                sec_num = sec.get("section_number", "")
                sec_title = sec.get("title", "")
                sec_content = sec.get("content", "")
                user_content += (
                    f"--- Section {sec_num}: {sec_title} ---\n"
                    f"--- BEGIN USER CONTENT ---\n"
                    f"{sec_content[:15000]}\n"
                    f"--- END USER CONTENT ---\n\n"
                )
            user_content += "</proposal_sections>\n\n"
        else:
            user_content += (
                "Use the get_sections tool to fetch all proposal sections.\n\n"
            )

        user_content += """Evaluate each compliance variable against the proposal content. For each variable provide:
- variable_id: the compliance variable ID
- variable_name: the requirement label
- status: pass | fail | partial | not_applicable
- evidence: relevant excerpt from the proposal (max 200 chars)
- gap: what is missing (if fail or partial)
- section_refs: which section numbers address this requirement
- confidence: your confidence in this assessment (0.0 to 1.0)

Output a JSON object with:
{
  "compliance_matrix": [...],
  "summary": {
    "total_variables": N,
    "pass_count": N,
    "fail_count": N,
    "partial_count": N,
    "not_applicable_count": N,
    "overall_compliance_pct": N
  },
  "critical_gaps": ["list of most important missing requirements"],
  "recommendations": ["list of priority actions to improve compliance"]
}"""

        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(
        self, conn, tool_name: str, tool_input: dict, context: dict
    ) -> dict:
        """Execute a tool call and return results."""
        tenant_id = context.get("tenant_id")

        if tool_name == "get_sections":
            return await self._get_sections(conn, tool_input, tenant_id)
        elif tool_name == "get_compliance":
            return await self._get_compliance(conn, tool_input, tenant_id)
        elif tool_name == "search_memory":
            return await self._search_memory(conn, tool_input, tenant_id)
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    async def _get_sections(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Fetch all proposal sections with content."""
        proposal_id = tool_input.get("proposal_id")
        if not proposal_id:
            return {"error": "proposal_id required"}

        try:
            # Verify tenant access
            if tenant_id:
                owner = await conn.fetchval(
                    "SELECT tenant_id FROM proposals WHERE id = $1",
                    uuid.UUID(proposal_id),
                )
                if owner and str(owner) != tenant_id:
                    return {"error": "Access denied", "code": "FORBIDDEN"}

            rows = await conn.fetch(
                """
                SELECT id, section_number, title, content, status,
                       requirement_ids, ai_confidence, page_allocation
                FROM proposal_sections
                WHERE proposal_id = $1
                ORDER BY section_number ASC
                """,
                uuid.UUID(proposal_id),
            )

            return {
                "sections": [
                    {
                        "id": str(row["id"]),
                        "section_number": row["section_number"],
                        "title": row["title"],
                        "content": row["content"][:15000] if row["content"] else "",
                        "status": row["status"],
                        "requirement_ids": row["requirement_ids"] or [],
                        "ai_confidence": (
                            float(row["ai_confidence"])
                            if row["ai_confidence"]
                            else None
                        ),
                        "page_allocation": row["page_allocation"],
                    }
                    for row in rows
                ],
                "total_sections": len(rows),
            }
        except Exception as e:
            logger.warning("get_sections failed: %s", e)
            return {"error": str(e)}

    async def _get_compliance(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Fetch compliance variables for the proposal's solicitation."""
        proposal_id = tool_input.get("proposal_id")
        if not proposal_id:
            return {"error": "proposal_id required"}

        try:
            # Get the solicitation_id from the proposal
            row = await conn.fetchrow(
                "SELECT solicitation_id, tenant_id FROM proposals WHERE id = $1",
                uuid.UUID(proposal_id),
            )
            if not row:
                return {"error": "Proposal not found"}

            if tenant_id and str(row["tenant_id"]) != tenant_id:
                return {"error": "Access denied", "code": "FORBIDDEN"}

            sol_id = row["solicitation_id"]
            if not sol_id:
                return {"variables": [], "note": "No solicitation linked to proposal"}

            # Get compliance variables
            variables = await conn.fetch(
                """
                SELECT id, variable_name, variable_type, value, confidence
                FROM solicitation_compliance
                WHERE solicitation_id = $1
                ORDER BY variable_name ASC
                """,
                sol_id,
            )

            return {
                "variables": [
                    {
                        "id": str(v["id"]),
                        "variable_name": v["variable_name"],
                        "variable_type": v["variable_type"],
                        "value": v["value"],
                        "confidence": (
                            float(v["confidence"]) if v["confidence"] else None
                        ),
                    }
                    for v in variables
                ],
                "total_variables": len(variables),
            }
        except Exception as e:
            logger.warning("get_compliance failed: %s", e)
            return {"error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for prior compliance patterns."""
        query = tool_input.get("query", "")
        mem_tenant_id = tool_input.get("tenant_id", tenant_id)
        limit = tool_input.get("limit", 5)

        if not query:
            return {"memories": [], "note": "No query provided"}

        try:
            escaped_query = query[:100].replace("%", "\\%").replace("_", "\\_")
            params: list = [f"%{escaped_query}%", limit]
            sql = """
                SELECT id, content, memory_type, importance, created_at
                FROM episodic_memories
                WHERE agent_role = 'compliance_reviewer'
                  AND content ILIKE $1
                  AND is_archived = false
            """
            if mem_tenant_id:
                sql += " AND tenant_id = $3"
                params.append(uuid.UUID(mem_tenant_id))

            sql += " ORDER BY importance DESC, created_at DESC LIMIT $2"

            rows = await conn.fetch(sql, *params)

            return {
                "memories": [
                    {
                        "id": str(row["id"]),
                        "content": row["content"][:500] if row["content"] else "",
                        "memory_type": row["memory_type"],
                        "importance": (
                            float(row["importance"]) if row["importance"] else None
                        ),
                    }
                    for row in rows
                ],
            }
        except Exception as e:
            logger.warning("search_memory failed: %s", e)
            return {"memories": [], "error": str(e)}

    def summarize_result(self, result: dict) -> str:
        """Summarize the compliance review for memory storage."""
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict) and "summary" in parsed:
                s = parsed["summary"]
                total = s.get("total_variables", 0)
                passed = s.get("pass_count", 0)
                failed = s.get("fail_count", 0)
                partial = s.get("partial_count", 0)
                pct = s.get("overall_compliance_pct", 0)
                return (
                    f"Compliance check: {passed}/{total} pass, "
                    f"{partial} partial, {failed} fail ({pct}% compliant)"
                )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

        if "pass" in text.lower() or "fail" in text.lower():
            return f"Compliance review completed: {text[:150]}"
        return "Compliance review completed (no parseable summary)"
