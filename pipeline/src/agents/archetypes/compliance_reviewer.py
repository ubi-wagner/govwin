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
            "proposal.section.drafted",
            "proposal.stage.changed",
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
                        # Tenant-bound invariant: NO tenant_id in the schema — the agent is
                        # bound to the assigned tenant from the trusted task context; the handler
                        # ignores any model-supplied tenant and filters on the bound tenant only.
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
            # Verify tenant access — fail CLOSED: a null tenant must not read any proposal's
            # sections (RLS is inert under the bypass role, so this check is the sole guard).
            if not tenant_id:
                return {"error": "tenant context required", "code": "FORBIDDEN"}
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

            # Get compliance data from real columns
            comp_row = await conn.fetchrow(
                """SELECT page_limit_technical, page_limit_cost, page_limit_other,
                          font_family, font_size, margins, line_spacing,
                          header_required, footer_required, submission_format,
                          required_sections, required_documents, evaluation_criteria,
                          taba_allowed, indirect_rate_cap, partner_max_pct,
                          cost_sharing_required, pi_must_be_employee,
                          custom_variables, verified_by, verified_at
                   FROM solicitation_compliance
                   WHERE solicitation_id = $1
                   LIMIT 1""",
                sol_id,
            )

            if not comp_row:
                return {"variables": [], "note": "No compliance data found"}

            variables = []
            if comp_row["page_limit_technical"]:
                variables.append({"name": "page_limit_technical", "label": "Technical Page Limit", "value": str(comp_row["page_limit_technical"]), "type": "number"})
            if comp_row["page_limit_cost"]:
                variables.append({"name": "page_limit_cost", "label": "Cost Page Limit", "value": str(comp_row["page_limit_cost"]), "type": "number"})
            if comp_row["page_limit_other"]:
                variables.append({"name": "page_limit_other", "label": "Other Page Limit", "value": str(comp_row["page_limit_other"]), "type": "number"})
            if comp_row["font_family"]:
                variables.append({"name": "font_family", "label": "Font Family", "value": comp_row["font_family"], "type": "text"})
            if comp_row["font_size"]:
                variables.append({"name": "font_size", "label": "Font Size", "value": str(comp_row["font_size"]), "type": "number"})
            if comp_row["margins"]:
                variables.append({"name": "margins", "label": "Margins", "value": comp_row["margins"], "type": "text"})
            if comp_row["line_spacing"]:
                variables.append({"name": "line_spacing", "label": "Line Spacing", "value": str(comp_row["line_spacing"]), "type": "text"})
            if comp_row["submission_format"]:
                variables.append({"name": "submission_format", "label": "Submission Format", "value": comp_row["submission_format"], "type": "text"})
            if comp_row["required_sections"]:
                variables.append({"name": "required_sections", "label": "Required Sections", "value": json.dumps(comp_row["required_sections"]) if isinstance(comp_row["required_sections"], (dict, list)) else str(comp_row["required_sections"]), "type": "json"})
            if comp_row["required_documents"]:
                variables.append({"name": "required_documents", "label": "Required Documents", "value": json.dumps(comp_row["required_documents"]) if isinstance(comp_row["required_documents"], (dict, list)) else str(comp_row["required_documents"]), "type": "json"})
            if comp_row["evaluation_criteria"]:
                variables.append({"name": "evaluation_criteria", "label": "Evaluation Criteria", "value": json.dumps(comp_row["evaluation_criteria"]) if isinstance(comp_row["evaluation_criteria"], (dict, list)) else str(comp_row["evaluation_criteria"]), "type": "json"})
            for col in ["taba_allowed", "cost_sharing_required", "pi_must_be_employee", "header_required", "footer_required"]:
                if comp_row[col] is not None:
                    variables.append({"name": col, "label": col.replace("_", " ").title(), "value": str(comp_row[col]), "type": "boolean"})
            if comp_row["indirect_rate_cap"] is not None:
                variables.append({"name": "indirect_rate_cap", "label": "Indirect Rate Cap", "value": str(comp_row["indirect_rate_cap"]), "type": "number"})
            if comp_row["partner_max_pct"] is not None:
                variables.append({"name": "partner_max_pct", "label": "Partner Max Pct", "value": str(comp_row["partner_max_pct"]), "type": "number"})
            if comp_row["custom_variables"]:
                custom = comp_row["custom_variables"]
                if isinstance(custom, list):
                    for cv in custom:
                        variables.append({"name": cv.get("name", "custom"), "label": cv.get("label", "Custom"), "value": str(cv.get("value", "")), "type": cv.get("type", "text")})

            return {
                "variables": variables,
                "total_variables": len(variables),
                "verified_by": str(comp_row["verified_by"]) if comp_row["verified_by"] else None,
                "verified_at": comp_row["verified_at"].isoformat() if comp_row["verified_at"] else None,
            }
        except Exception as e:
            logger.warning("get_compliance failed: %s", e)
            return {"error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for prior compliance patterns."""
        query = tool_input.get("query", "")
        limit = tool_input.get("limit", 5)

        if not query:
            return {"memories": [], "note": "No query provided"}

        try:
            escaped_query = query[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            params: list = [f"%{escaped_query}%", limit]
            sql = """
                SELECT id, content, memory_type, importance, created_at
                FROM episodic_memories
                WHERE agent_role = 'compliance_reviewer'
                  AND content ILIKE $1
                  AND is_archived = false
            """
            # Fail CLOSED on a missing tenant — a tenant-scoped agent must never widen the
            # memory search to every tenant (RLS is inert under the bypass role, so this
            # predicate is the sole guard). Matches the registry's fail-closed contract.
            if not tenant_id:
                return {"memories": []}
            sql += " AND tenant_id = $3"
            params.append(uuid.UUID(tenant_id))

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
                # The model may return `summary` as the structured object OR as a
                # plain string. Only index it when it is actually a dict — a string
                # summary must not crash the whole agent run (AttributeError was not
                # caught below, so it propagated out of invoke_agent as status=error).
                if isinstance(s, dict):
                    total = s.get("total_variables", 0)
                    passed = s.get("pass_count", 0)
                    failed = s.get("fail_count", 0)
                    partial = s.get("partial_count", 0)
                    pct = s.get("overall_compliance_pct", 0)
                    return (
                        f"Compliance check: {passed}/{total} pass, "
                        f"{partial} partial, {failed} fail ({pct}% compliant)"
                    )
                if isinstance(s, str) and s.strip():
                    return f"Compliance review: {s[:150]}"
        except (json.JSONDecodeError, TypeError, KeyError, AttributeError):
            pass

        if "pass" in text.lower() or "fail" in text.lower():
            return f"Compliance review completed: {text[:150]}"
        return "Compliance review completed (no parseable summary)"
