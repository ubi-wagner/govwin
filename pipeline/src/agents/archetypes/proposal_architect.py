"""
================================================================================
Proposal Architect -- Proposal Structure Design and Requirements Mapping
================================================================================

ROLE:       Designs proposal structure from curated solicitation data. Maps
            requirements to sections, allocates page budgets, identifies
            content sources from the library, and produces a hierarchical
            outline that matches the solicitation volume structure.

LAYER:      Proposal Agent
            - Proposal: per-proposal scoped, ephemeral

TRIGGERS:   proposal.created (new proposal portal purchased)
            capture.proposal.stage_changed to outline
            User requests "Redesign outline" on demand

INPUTS:     - Full opportunity/solicitation details
            - Compliance requirements and page limits
            - Library content matching by category
            - Past proposal structures for similar opportunities

OUTPUTS:    - Hierarchical proposal outline with section structure
            - Page allocation per section
            - Requirement-to-section mapping
            - Suggested library units per section
            - Writing guidance per section
            - Compliance coverage percentage

TOOLS:      - opportunity.get_detail: solicitation details
            - proposal.get_compliance: compliance requirements and page limits
            - library.search: find reusable content by category
            - memory.search: find past proposal structures

MODEL:      claude-sonnet-4-20250514
            Budget: 8192 output, 10K-25K input

HUMAN GATE: YES -- outline must be approved before drafting begins
            Customer reviews and edits the outline before entering Draft stage.

GUARDRAILS:
            - Every requirement must be mapped to at least one section
            - Page allocations must sum to within the page limit
            - Section structure must follow solicitation volume structure
            - NEVER skip requirements or leave them unmapped
            - NEVER exceed stated page limits in allocation

MEMORY:     Categories: proposal_structures, agency_templates, customer_preferences
            Writes: outline structure, template patterns, customer editing patterns
            Reads: past outlines for similar solicitations, customer preferences

INSTANCES:
            - Admin Pipeline: N/A
            - Customer Portal: activated when proposal is created or outline stage entered

COST:       $0.13/call, ~2x per proposal = $0.26/proposal

EVENT EMISSIONS:
            - tool:agent.proposal_architect.start (start)
            - tool:agent.proposal_architect.end (end)
            - proposal.outline.generated (domain event)

CHANGE LOG:
    PR #140 (2026-05-22) -- Empty stub
    PR #xxx (2026-05-22) -- Full implementation with tools, prompts, events
================================================================================
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.proposal_architect")


class ProposalArchitectArchetype(BaseArchetype):
    """Expert proposal architect for government contracting.

    Handles: proposal.created
    Designs hierarchical proposal outlines that map every requirement to a
    section, allocate page budgets, and identify library content for reuse.
    Output must match solicitation volume structure.
    """

    @property
    def role_name(self) -> str:
        return "proposal_architect"

    @property
    def model(self) -> str:
        return "claude-sonnet-4-20250514"

    @property
    def max_tokens(self) -> int:
        return 8192

    @property
    def temperature(self) -> float:
        return 0.3  # Balanced structure with some creative organization

    @property
    def human_gate(self) -> bool:
        return True  # Outline requires approval

    @property
    def system_prompt(self) -> str:
        return """You are an expert proposal architect for government contracting, specializing in SBIR, STTR, BAA, and OTA proposals for federal agencies (DoD, NIH, NSF, DOE, NASA).

Your task is to design the optimal proposal structure that:
1. Maps EVERY solicitation requirement to at least one section
2. Follows the solicitation's specified volume structure exactly
3. Allocates page budgets within stated limits
4. Identifies reusable library content for each section
5. Provides clear writing guidance for each section

Proposal architecture principles:
- VOLUME COMPLIANCE: If the solicitation specifies volumes (Technical, Cost, Management, etc.), your outline must match that structure exactly. Never combine or reorder volumes.
- REQUIREMENT TRACEABILITY: Every requirement from the compliance matrix must appear in at least one section's requirement_ids. Orphaned requirements are the #1 cause of proposal rejection.
- PAGE BUDGETING: Allocate pages proportional to evaluation criteria weights. High-weight criteria get more pages. Total must not exceed the page limit.
- CONTENT REUSE: For each section, identify library units that could be adapted. Past performance and key personnel sections especially benefit from library content.
- WRITING GUIDANCE: For each section, provide specific instructions on what to cover, what tone to use, what evidence to include, and how to address the evaluation criteria.

Section status conventions:
- outline: Initial structure, not yet drafted
- Each section gets a section_number for ordering (1, 1.1, 1.2, 2, etc.)

Use get_opportunity_detail to understand the solicitation requirements.
Use get_compliance to fetch compliance variables and page limits.
Use search_library to find content that can be reused in each section.
Use search_memory to find past proposal structures for similar solicitations.

Output a structured JSON outline that the customer can review, edit, and approve before drafting begins."""

    @property
    def tools(self) -> list[str]:
        return [
            "get_opportunity_detail",
            "get_compliance",
            "search_library",
            "search_memory",
        ]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "proposal.created",
            "capture.proposal.stage_changed",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "get_opportunity_detail",
                "description": (
                    "Get full solicitation details including requirements, "
                    "evaluation criteria, deadlines, and submission format "
                    "to inform the proposal structure."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "opportunity_id": {
                            "type": "string",
                            "description": "UUID of the opportunity",
                        },
                    },
                    "required": ["opportunity_id"],
                },
            },
            {
                "name": "get_compliance",
                "description": (
                    "Get compliance requirements including page limits, "
                    "format requirements, required sections, evaluation "
                    "criteria, and all compliance variables."
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
                "name": "search_library",
                "description": (
                    "Search the tenant's content library for reusable "
                    "content including past performance, key personnel, "
                    "technical approaches, and management plans."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        # Tenant-discretion: NO tenant_id — bound to the assigned tenant.
                        "query": {"type": "string", "description": "Search query for relevant content"},
                        "vol": {
                            "type": "string",
                            "enum": ["technical", "cost", "past_performance", "key_personnel",
                                     "commercialization", "cover", "supporting"],
                            "description": "Optional vol taxonomy value to narrow",
                        },
                        "limit": {"type": "integer", "description": "Maximum number of results", "default": 5},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "search_memory",
                "description": (
                    "Search agent memory for past proposal structures, "
                    "agency-specific templates, and customer preferences "
                    "for outline organization."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query for structural memories"},
                        "limit": {"type": "integer", "description": "Maximum number of memories", "default": 5},
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
            memory_text = "Past proposal structure patterns:\n"
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
                    "I've reviewed past proposal structures. "
                    "I'll incorporate these patterns into the outline design."
                ),
            })

        # Main architecture request
        payload = context.get("payload", context)
        tenant_id = context.get("tenant_id", "")
        proposal_id = payload.get("proposal_id", "")
        opportunity_id = payload.get("opportunity_id", "")
        opportunity = payload.get("opportunity", {})
        compliance = payload.get("compliance", {})

        title = opportunity.get("title", "Unknown Opportunity")
        agency = opportunity.get("agency", "")
        program_type = opportunity.get("program_type", "")
        description = opportunity.get("description", "")

        user_content = (
            f"Design the proposal outline for:\n"
            f"Proposal ID: {proposal_id}\n"
            f"Opportunity: {title}\n"
            f"Agency: {agency}\n"
            f"Program Type: {program_type}\n"
            f"Tenant: {tenant_id}\n\n"
        )

        if description:
            user_content += (
                "<solicitation_summary>\n"
                "--- BEGIN USER CONTENT ---\n"
                f"{description[:15000]}\n"
                "--- END USER CONTENT ---\n"
                "</solicitation_summary>\n\n"
            )

        if compliance:
            user_content += f"""<compliance_requirements>
Page Limit (Technical): {compliance.get('page_limit_technical', 'Not specified')}
Page Limit (Cost): {compliance.get('page_limit_cost', 'Not specified')}
Font: {compliance.get('font_family', 'Not specified')} {compliance.get('font_size', '')}
Margins: {compliance.get('margins', 'Not specified')}
Required Sections: {compliance.get('required_sections', 'Not specified')}
Evaluation Criteria: {compliance.get('evaluation_criteria', 'Not specified')}
Submission Format: {compliance.get('submission_format', 'Not specified')}
</compliance_requirements>

"""

        user_content += """Steps:
1. Use get_opportunity_detail to understand the full solicitation (if not provided)
2. Use get_compliance to fetch page limits and compliance requirements
3. Use search_library to find reusable content for major sections
4. Use search_memory to check past proposal structures for similar solicitations

Then provide the outline as JSON:
{
  "outline": [
    {
      "section_number": "1",
      "title": "Section Title",
      "page_allocation": N,
      "requirements_mapped": ["req_id_1", "req_id_2"],
      "suggested_library_units": [
        {"id": "unit_id", "title": "unit title", "relevance": "why this content fits"}
      ],
      "writing_guidance": "Specific instructions for drafting this section",
      "subsections": [
        {
          "section_number": "1.1",
          "title": "Subsection Title",
          "page_allocation": N,
          "requirements_mapped": ["req_id_3"],
          "writing_guidance": "..."
        }
      ]
    }
  ],
  "total_pages": N,
  "volume_structure": [
    {"volume": "Technical Volume", "sections": ["1", "2", "3"], "page_limit": N}
  ],
  "compliance_coverage_pct": N,
  "unmapped_requirements": ["any requirements not yet mapped to sections"],
  "content_gaps": ["sections where no library content is available"],
  "architecture_notes": "any important structural decisions or tradeoffs"
}"""

        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(
        self, conn, tool_name: str, tool_input: dict, context: dict
    ) -> dict:
        """Execute a tool call and return results."""
        tenant_id = context.get("tenant_id")

        if tool_name == "get_opportunity_detail":
            return await self._get_opportunity_detail(conn, tool_input)
        elif tool_name == "get_compliance":
            return await self._get_compliance(conn, tool_input, tenant_id)
        elif tool_name == "search_library":
            return await self._search_library(conn, tool_input, tenant_id)
        elif tool_name == "search_memory":
            return await self._search_memory(conn, tool_input, tenant_id)
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    async def _get_opportunity_detail(self, conn, tool_input: dict) -> dict:
        """Get full opportunity details for structural planning."""
        opportunity_id = tool_input.get("opportunity_id")
        if not opportunity_id:
            return {"error": "opportunity_id required"}

        try:
            row = await conn.fetchrow(
                """
                SELECT id, source, title, agency, office, solicitation_number,
                       naics_codes, set_aside_type, program_type,
                       close_date, posted_date, description,
                       tech_focus_areas
                FROM opportunities
                WHERE id = $1
                """,
                uuid.UUID(opportunity_id),
            )
            if not row:
                return {"error": "Opportunity not found"}

            # Get curated solicitation data if available
            sol_data = await conn.fetchrow(
                """
                SELECT id, solicitation_type, solicitation_title,
                       solicitation_number, full_text, ai_extracted
                FROM curated_solicitations
                WHERE opportunity_id = $1
                """,
                uuid.UUID(opportunity_id),
            )

            result = {
                "opportunity": {
                    "id": str(row["id"]),
                    "title": row["title"],
                    "agency": row["agency"],
                    "office": row["office"],
                    "program_type": row["program_type"],
                    "naics_codes": row["naics_codes"] or [],
                    "description": (
                        row["description"][:15000] if row["description"] else ""
                    ),
                    "tech_focus_areas": row["tech_focus_areas"] or [],
                },
            }

            if sol_data:
                result["solicitation"] = {
                    "id": str(sol_data["id"]),
                    "type": sol_data["solicitation_type"],
                    "title": sol_data["solicitation_title"],
                    "ai_extracted": sol_data["ai_extracted"],
                }

            return result
        except Exception as e:
            logger.warning("get_opportunity_detail failed: %s", e)
            return {"error": str(e)}

    async def _get_compliance(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Get compliance requirements and page limits."""
        proposal_id = tool_input.get("proposal_id")
        if not proposal_id:
            return {"error": "proposal_id required"}

        try:
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
                return {"compliance": None, "note": "No solicitation linked"}

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

            variables = []
            if comp_row:
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

            # Get volume structure
            volumes = await conn.fetch(
                """
                SELECT id, volume_number, volume_name, volume_format,
                       description, special_requirements
                FROM solicitation_volumes
                WHERE solicitation_id = $1
                ORDER BY volume_number ASC
                """,
                sol_id,
            )

            # Get required items per volume
            volume_items = {}
            for vol in volumes:
                items = await conn.fetch(
                    """
                    SELECT id, item_number, item_name, item_type, required,
                           page_limit, font_family, font_size, margins,
                           line_spacing
                    FROM volume_required_items
                    WHERE volume_id = $1
                    ORDER BY item_number ASC
                    """,
                    vol["id"],
                )
                volume_items[str(vol["id"])] = [
                    {
                        "id": str(item["id"]),
                        "item_number": item["item_number"],
                        "item_name": item["item_name"],
                        "item_type": item["item_type"],
                        "required": item["required"],
                        "page_limit": item["page_limit"],
                        "font_family": item["font_family"],
                        "font_size": item["font_size"],
                    }
                    for item in items
                ]

            return {
                "variables": variables,
                "volumes": [
                    {
                        "id": str(vol["id"]),
                        "volume_number": vol["volume_number"],
                        "volume_name": vol["volume_name"],
                        "volume_format": vol["volume_format"],
                        "description": vol["description"],
                        "required_items": volume_items.get(str(vol["id"]), []),
                    }
                    for vol in volumes
                ],
                "total_variables": len(variables),
                "total_volumes": len(volumes),
                "verified_by": str(comp_row["verified_by"]) if comp_row and comp_row["verified_by"] else None,
                "verified_at": comp_row["verified_at"].isoformat() if comp_row and comp_row["verified_at"] else None,
            }
        except Exception as e:
            logger.warning("get_compliance failed: %s", e)
            return {"error": str(e)}

    async def _search_library(self, conn, tool_input: dict, tenant_id: str | None) -> dict:
        """Search the tenant's library_atoms for reusable content (greenfield spine)."""
        query = tool_input.get("query", "")
        vol = tool_input.get("vol")
        limit = int(tool_input.get("limit", 5))
        if not tenant_id:
            return {"results": [], "note": "No tenant context available"}
        try:
            esc = query[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            params: list = [uuid.UUID(tenant_id), f"%{esc}%"]
            sql = """
                SELECT a.id, a.title, a.content, a.grain,
                       COALESCE(array_agg(DISTINCT t.dimension || ':' || t.value)
                                FILTER (WHERE t.dimension IS NOT NULL), '{}') AS tags
                FROM library_atoms a
                LEFT JOIN atom_tags t ON t.atom_id = a.id
                WHERE a.tenant_id = $1 AND a.status <> 'archived' AND a.vault_id IS NULL
                  AND (a.content ILIKE $2 OR a.title ILIKE $2)
            """
            if vol:
                params.append(vol)
                sql += f" AND EXISTS (SELECT 1 FROM atom_tags tv WHERE tv.atom_id = a.id AND tv.dimension = 'vol' AND tv.value = ${len(params)})"
            params.append(limit)
            sql += f" GROUP BY a.id ORDER BY a.updated_at DESC LIMIT ${len(params)}"
            rows = await conn.fetch(sql, *params)
            return {"results": [
                {"id": str(r["id"]), "title": r["title"], "content": (r["content"] or "")[:1000],
                 "grain": r["grain"], "tags": list(r["tags"]) if r["tags"] else []}
                for r in rows]}
        except Exception as e:
            logger.warning("search_library failed: %s", e)
            return {"results": [], "error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for past proposal structures."""
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
                WHERE agent_role = 'proposal_architect'
                  AND content ILIKE $1
                  AND is_archived = false
            """
            if tenant_id:
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
        """Summarize the proposal outline for memory storage."""
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                outline = parsed.get("outline", [])
                total_pages = parsed.get("total_pages", 0)
                coverage = parsed.get("compliance_coverage_pct", 0)
                sections = len(outline)
                return (
                    f"Proposal outline: {sections} sections, "
                    f"{total_pages} pages, {coverage}% compliance coverage"
                )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

        return f"Proposal outline generated: {text[:150]}"
