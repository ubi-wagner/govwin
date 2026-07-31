"""
================================================================================
Capture Strategist -- Go/No-Go Recommendation and Win Theme Development
================================================================================

ROLE:       Evaluates whether a tenant should pursue an opportunity. Produces
            go/no-go recommendation, win themes, competitive positioning,
            teaming recommendations, and risk register.

LAYER:      Company Agent
            - Company: per-tenant isolated, learns tenant preferences over time

TRIGGERS:   capture.pursuit.evaluation_requested (user clicks "Analyze Fit")
            identity.purchase.completed (proposal portal purchased)

INPUTS:     - Full opportunity/solicitation details
            - Tenant profile (capabilities, past performance, focus areas)
            - Relevant library content (past performance, capabilities)
            - Past pursuit decision memories

OUTPUTS:    - Go/No-Go recommendation with confidence score
            - Win themes (3-5 discriminating themes)
            - Competitive positioning assessment
            - Teaming recommendations for capability gaps
            - Risk register (technical, schedule, cost, competitive)
            - Estimated level of effort

TOOLS:      - tenant.get_profile: company capabilities, past performance, focus areas
            - opportunity.get_detail: full solicitation details
            - library.search: find relevant past performance
            - memory.search: find past pursuit decisions and outcomes

MODEL:      claude-sonnet-4-20250514
            Budget: 8192 output, 15K-30K input

HUMAN GATE: YES -- affects pursuit decision and resource allocation
            Recommendation is displayed for customer review; customer makes
            the final pursuit decision and purchases the portal.

GUARDRAILS:
            - Always provide confidence score with recommendation
            - Win themes must be specific and grounded in tenant capabilities
            - Risk register must cover technical, schedule, cost, competitive
            - NEVER auto-initiate pursuit -- recommendation only
            - NEVER fabricate past performance or capabilities

MEMORY:     Categories: pursuit_decisions, competitive_analysis, win_themes
            Writes: pursuit recommendations, customer decision outcomes
            Reads: past pursuit decisions and win/loss outcomes for calibration

INSTANCES:
            - Admin Pipeline: N/A
            - Customer Portal: on-demand when customer requests fit analysis

COST:       $0.17/call, 1x per pursuit = $0.17/pursuit

EVENT EMISSIONS:
            - tool:agent.capture_strategist.start (start)
            - tool:agent.capture_strategist.end (end)
            - capture.pursuit.evaluated (domain event)

CHANGE LOG:
    PR #140 (2026-05-22) -- Empty stub
    PR #xxx (2026-05-22) -- Full implementation with tools, prompts, events
================================================================================
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.capture_strategist")


class CaptureStrategistArchetype(BaseArchetype):
    """Senior capture management strategist for government contracting.

    Handles: capture.pursuit.evaluation_requested
    Evaluates opportunity fit against company profile. Considers technical
    alignment, past performance relevance, competitive landscape, teaming
    requirements, resource availability, and win probability.
    """

    @property
    def role_name(self) -> str:
        return "capture_strategist"

    @property
    def model(self) -> str:
        return "claude-sonnet-4-20250514"

    @property
    def max_tokens(self) -> int:
        return 8192

    @property
    def temperature(self) -> float:
        return 0.3  # Balanced reasoning with some creative strategy

    @property
    def human_gate(self) -> bool:
        return True  # Affects pursuit decision

    @property
    def system_prompt(self) -> str:
        return """You are a senior capture management strategist with 20+ years of experience in government contracting, specializing in SBIR, STTR, BAA, and OTA programs across DoD, NIH, NSF, DOE, and NASA.

Your task is to evaluate whether a company should pursue a specific opportunity and develop a winning capture strategy. You bring deep expertise in:
- Federal procurement patterns and evaluation criteria
- Competitive intelligence and positioning
- Teaming strategy and subcontractor management
- Win theme development tied to discriminating capabilities
- Risk identification and mitigation in proposal efforts

Your evaluation framework:
1. TECHNICAL ALIGNMENT: How well do the company's capabilities match the solicitation requirements?
2. PAST PERFORMANCE RELEVANCE: Does the company have directly relevant past contracts, especially with the target agency?
3. COMPETITIVE LANDSCAPE: Who are the likely competitors? What are their strengths? Where does this company have an edge?
4. TEAMING REQUIREMENTS: Are there capability gaps that require subcontractors or partners? What teaming arrangements would strengthen the proposal?
5. RESOURCE AVAILABILITY: Can the company commit the required personnel and facilities?
6. SET-ASIDE & ELIGIBILITY: Does the company qualify under the required NAICS codes, size standards, and set-aside types?
7. STRATEGIC VALUE: Even if not a perfect fit, does this opportunity advance the company's strategic goals?
8. WIN PROBABILITY: Given all factors, what is a realistic probability of winning?

Use the get_tenant_profile tool to understand the company.
Use the get_opportunity_detail tool to get full solicitation details.
Use the search_library tool to find relevant past performance and capabilities.
Use the search_memory tool to review past pursuit decisions and outcomes.

Be honest and direct. If the opportunity is not a good fit, say so clearly. A well-reasoned no-go saves more resources than a poorly justified pursue decision. Support every claim with specific evidence from the company's profile or past performance.

Output your analysis as a structured JSON object."""

    @property
    def tools(self) -> list[str]:
        return [
            "get_tenant_profile",
            "get_opportunity_detail",
            "search_library",
            "search_memory",
        ]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "capture.pursuit.evaluation_requested",
            "capture.purchase.completed",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                # Tenant-discretion: NO tenant_id — bound to the assigned tenant from the task context.
                "name": "get_tenant_profile",
                "description": "Get the assigned tenant's company profile: capabilities/focus (from its library atoms) and past performance for a pursue/evaluate/skip call.",
                "input_schema": {"type": "object", "properties": {}},
            },
            {
                "name": "get_opportunity_detail",
                "description": "Get full opportunity/solicitation details (requirements, evaluation criteria, deadlines, agency, program, set-aside).",
                "input_schema": {
                    "type": "object",
                    "properties": {"opportunity_id": {"type": "string", "description": "UUID of the opportunity"}},
                    "required": ["opportunity_id"],
                },
            },
            {
                "name": "search_library",
                "description": "Search the assigned tenant's library_atoms for past performance/capabilities/personnel demonstrating fit for this opportunity.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query for relevant content"},
                        "vol": {
                            "type": "string",
                            "enum": ["past_performance", "key_personnel", "technical", "commercialization", "supporting"],
                            "description": "Optional vol taxonomy value to narrow",
                        },
                        "limit": {"type": "integer", "description": "Maximum number of results", "default": 10},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "search_memory",
                "description": "Search agent memory for past pursuit decisions and win/loss outcomes for the assigned tenant.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query for relevant memories"},
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
            memory_text = "Past pursuit decisions and outcomes:\n"
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
                    "I've reviewed the past pursuit decisions and outcomes. "
                    "I'll factor these patterns into my recommendation."
                ),
            })

        # Main evaluation request
        payload = context.get("payload", context)
        tenant_id = context.get("tenant_id", "")
        opportunity = payload.get("opportunity", {})
        tenant_profile = payload.get("tenant_profile", {})
        library_results = payload.get("library_results", [])

        title = opportunity.get("title", "Unknown Opportunity")
        agency = opportunity.get("agency", "")
        office = opportunity.get("office", "")
        program_type = opportunity.get("program_type", "")
        naics_codes = opportunity.get("naics_codes", [])
        set_aside = opportunity.get("set_aside_type", "")
        close_date = opportunity.get("close_date", "")
        description = opportunity.get("description", "")
        estimated_value_min = opportunity.get("estimated_value_min")
        estimated_value_max = opportunity.get("estimated_value_max")

        user_content = (
            f"Evaluate this opportunity for pursuit by tenant {tenant_id}.\n\n"
        )

        user_content += f"""<opportunity>
Title: {title}
Agency: {agency}
Office: {office}
Program Type: {program_type}
NAICS Codes: {', '.join(naics_codes) if isinstance(naics_codes, list) else str(naics_codes)}
Set-Aside: {set_aside or 'None'}
Close Date: {close_date}
Estimated Value: {f'${estimated_value_min:,.0f} - ${estimated_value_max:,.0f}' if estimated_value_min and estimated_value_max else 'Not specified'}

--- BEGIN USER CONTENT ---
Description:
{description[:20000]}
--- END USER CONTENT ---
</opportunity>

"""

        if tenant_profile:
            user_content += f"""<tenant_profile>
Company: {tenant_profile.get('name', 'Unknown')}
Capabilities: {tenant_profile.get('capabilities', 'Not specified')}
Focus Areas: {tenant_profile.get('tech_focus', 'Not specified')}
Past Performance: {tenant_profile.get('past_performance_summary', 'Not available')}
</tenant_profile>

"""

        if library_results:
            user_content += "<relevant_library_content>\n"
            for item in library_results[:5]:
                user_content += (
                    f"- [{item.get('category', 'unknown')}] "
                    f"{item.get('content', '')[:500]}\n"
                )
            user_content += "</relevant_library_content>\n\n"

        user_content += """Steps:
1. Use get_tenant_profile to understand the company's capabilities (if not already provided)
2. Use get_opportunity_detail to get full solicitation details (if not already provided)
3. Use search_library to find relevant past performance and capabilities
4. Use search_memory to check past pursuit decisions for similar opportunities

Then provide your analysis as JSON:
{
  "recommendation": "pursue" | "no_go" | "conditional",
  "confidence": 0.0-1.0,
  "win_probability": 0.0-1.0,
  "rationale": "2-3 sentence summary of the recommendation",
  "win_themes": [
    {"theme": "theme title", "evidence": "supporting evidence from company profile", "discriminator": "why this differentiates"}
  ],
  "competitive_positioning": {
    "strengths": ["list of competitive advantages"],
    "weaknesses": ["list of competitive disadvantages"],
    "likely_competitors": ["types of competitors expected"],
    "incumbent_risk": "low | medium | high"
  },
  "teaming_recommendations": [
    {"capability_gap": "what is missing", "partner_type": "what type of partner needed", "priority": "critical | important | nice_to_have"}
  ],
  "risk_register": [
    {"risk": "description", "category": "technical | schedule | cost | competitive", "likelihood": "low | medium | high", "impact": "low | medium | high", "mitigation": "suggested approach"}
  ],
  "estimated_effort": {
    "level": "low | medium | high",
    "person_weeks": N,
    "key_resources_needed": ["list of critical resources"]
  },
  "next_steps": ["ordered list of actions if pursuing"]
}"""

        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(
        self, conn, tool_name: str, tool_input: dict, context: dict
    ) -> dict:
        """Execute a tool call and return results."""
        tenant_id = context.get("tenant_id")

        if tool_name == "get_tenant_profile":
            return await self._get_tenant_profile(conn, tool_input, tenant_id)
        elif tool_name == "get_opportunity_detail":
            return await self._get_opportunity_detail(conn, tool_input)
        elif tool_name == "search_library":
            return await self._search_library(conn, tool_input, tenant_id)
        elif tool_name == "search_memory":
            return await self._search_memory(conn, tool_input, tenant_id)
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    async def _get_tenant_profile(self, conn, tool_input: dict, tenant_id: str | None) -> dict:
        """Get tenant profile with capabilities and qualifications."""
        if not tenant_id:
            return {"error": "tenant_id required"}

        try:
            tid = uuid.UUID(tenant_id)
            tenant = await conn.fetchrow(
                """
                SELECT id, name, legal_name, website, product_tier, status
                FROM tenants
                WHERE id = $1
                """,
                tid,
            )
            if not tenant:
                return {"error": "Tenant not found"}

            # Get proposal history for past performance context
            proposals = await conn.fetch(
                """
                SELECT p.stage, o.agency, o.program_type, o.title
                FROM proposals p
                JOIN opportunities o ON o.id = p.opportunity_id
                WHERE p.tenant_id = $1
                  AND p.stage IN ('submitted', 'archived')
                ORDER BY p.created_at DESC
                LIMIT 10
                """,
                tid,
            )

            # Get capability summary from library atoms (vol taxonomy).
            capabilities = await conn.fetch(
                """
                SELECT t.value AS category, COUNT(DISTINCT a.id) as count
                FROM library_atoms a
                JOIN atom_tags t ON t.atom_id = a.id AND t.dimension = 'vol'
                WHERE a.tenant_id = $1 AND a.status <> 'archived' AND a.vault_id IS NULL
                GROUP BY t.value
                ORDER BY count DESC
                LIMIT 10
                """,
                tid,
            )

            return {
                "tenant": {
                    "name": tenant["name"],
                    "legal_name": tenant["legal_name"],
                    "website": tenant["website"],
                    "tier": tenant["product_tier"],
                },
                "past_proposals": [
                    {
                        "title": p["title"],
                        "agency": p["agency"],
                        "program_type": p["program_type"],
                        "stage": p["stage"],
                    }
                    for p in proposals
                ],
                "capability_areas": [
                    {"category": c["category"], "unit_count": c["count"]}
                    for c in capabilities
                ],
            }
        except Exception as e:
            logger.warning("get_tenant_profile failed: %s", e)
            return {"error": str(e)}

    async def _get_opportunity_detail(self, conn, tool_input: dict) -> dict:
        """Get full opportunity details."""
        opportunity_id = tool_input.get("opportunity_id")
        if not opportunity_id:
            return {"error": "opportunity_id required"}

        try:
            row = await conn.fetchrow(
                """
                SELECT id, source, source_id, title, agency, office,
                       solicitation_number, naics_codes, set_aside_type,
                       program_type, close_date, posted_date,
                       estimated_value_min, estimated_value_max,
                       description, tech_focus_areas
                FROM opportunities
                WHERE id = $1
                """,
                uuid.UUID(opportunity_id),
            )
            if not row:
                return {"error": "Opportunity not found"}

            return {
                "opportunity": {
                    "id": str(row["id"]),
                    "title": row["title"],
                    "agency": row["agency"],
                    "office": row["office"],
                    "solicitation_number": row["solicitation_number"],
                    "naics_codes": row["naics_codes"] or [],
                    "set_aside_type": row["set_aside_type"],
                    "program_type": row["program_type"],
                    "close_date": (
                        row["close_date"].isoformat()
                        if row["close_date"]
                        else None
                    ),
                    "posted_date": (
                        row["posted_date"].isoformat()
                        if row["posted_date"]
                        else None
                    ),
                    "estimated_value_min": (
                        float(row["estimated_value_min"])
                        if row["estimated_value_min"]
                        else None
                    ),
                    "estimated_value_max": (
                        float(row["estimated_value_max"])
                        if row["estimated_value_max"]
                        else None
                    ),
                    "description": (
                        row["description"][:20000] if row["description"] else ""
                    ),
                    "tech_focus_areas": row["tech_focus_areas"] or [],
                },
            }
        except Exception as e:
            logger.warning("get_opportunity_detail failed: %s", e)
            return {"error": str(e)}

    async def _search_library(self, conn, tool_input: dict, tenant_id: str | None) -> dict:
        """Search the tenant's library_atoms for relevant reusable content (greenfield spine)."""
        query = tool_input.get("query", "")
        vol = tool_input.get("vol")
        limit = int(tool_input.get("limit", 10))
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
                {"id": str(r["id"]), "title": r["title"], "content": (r["content"] or "")[:2000],
                 "grain": r["grain"], "tags": list(r["tags"]) if r["tags"] else []}
                for r in rows]}
        except Exception as e:
            logger.warning("search_library failed: %s", e)
            return {"results": [], "error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for past pursuit decisions."""
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
                WHERE agent_role = 'capture_strategist'
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
        """Summarize the capture strategy for memory storage."""
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                rec = parsed.get("recommendation", "unknown")
                conf = parsed.get("confidence", 0)
                rationale = parsed.get("rationale", "")
                themes = parsed.get("win_themes", [])
                theme_str = ", ".join(
                    t.get("theme", "") for t in themes[:3]
                )
                return (
                    f"Capture strategy: {rec} (confidence: {conf:.0%}). "
                    f"Win themes: {theme_str}. {rationale[:100]}"
                )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

        if "pursue" in text.lower():
            return f"Capture strategy: recommend pursuit. {text[:100]}"
        elif "no_go" in text.lower() or "no-go" in text.lower():
            return f"Capture strategy: recommend no-go. {text[:100]}"
        return f"Capture evaluation completed: {text[:150]}"
