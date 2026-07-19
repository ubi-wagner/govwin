"""
================================================================================
Scoring Strategist -- LLM-Based Opportunity Score Adjustment
================================================================================

ROLE:       Adjusts opportunity scores based on deep analysis. Provides an
            LLM-based scoring overlay on top of algorithmic scores, evaluating
            tenant-specific fit factors that algorithms cannot capture.

LAYER:      Company Agent
            - Company: per-tenant isolated, runs once per opportunity per tenant

TRIGGERS:   finder.opportunity.ingested (after opportunity_analyst completes)
            finder.scoring.completed (for high-potential opportunities)
            capture.proposal.outcome_recorded (recalibration on win/loss)

INPUTS:     - Opportunity metadata and analyst output
            - Tenant profile (NAICS, keywords, agency history, tech focus)
            - Past proposal outcomes (win/loss with scores)
            - Scoring calibration memories

OUTPUTS:    - Score adjustment (-15 to +15)
            - Rationale (2-3 sentences)
            - Factor breakdown with per-factor impact
            - Competitive risk assessment
            - Confidence level

TOOLS:      - tenant.get_profile: company focus areas and capabilities
            - memory.search: past scoring patterns and outcomes

MODEL:      claude-haiku-4-5-20251001
            Budget: 2048 output, 5K-15K input

HUMAN GATE: NO -- score adjustments are advisory
            Adjustments are displayed alongside algorithmic scores. Customer
            decides pursuit status independently.

GUARDRAILS:
            - Score adjustment MUST be in range -15 to +15
            - Every adjustment must have a rationale
            - Factor breakdown must sum to the total adjustment
            - NEVER adjust score without examining tenant profile
            - NEVER assign extreme adjustments without strong evidence

MEMORY:     Categories: scoring_calibration, outcome_tracking
            Writes: scoring rationale, calibration adjustments after outcomes
            Reads: past scoring accuracy, tenant-specific calibration data

INSTANCES:
            - Admin Pipeline: N/A
            - Customer Portal: runs per tenant per high-scoring opportunity

COST:       $0.06/call, 1x per opportunity = $0.06/opportunity

EVENT EMISSIONS:
            - tool:agent.scoring_strategist.start (start)
            - tool:agent.scoring_strategist.end (end)
            - finder.scoring.llm_adjusted (domain event)

CHANGE LOG:
    PR #140 (2026-05-22) -- Empty stub
    PR #xxx (2026-05-22) -- Full implementation with tools, prompts, events
================================================================================
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.scoring_strategist")


class ScoringStrategistArchetype(BaseArchetype):
    """Government contracting opportunity scoring analyst.

    Handles: finder.opportunity.ingested (after opportunity_analyst)
    Given a tenant's profile and an opportunity, provides a score adjustment
    (-15 to +15) with rationale. Uses Haiku for fast scoring at scale.
    """

    @property
    def role_name(self) -> str:
        return "scoring_strategist"

    @property
    def model(self) -> str:
        return "claude-haiku-4-5-20251001"

    @property
    def max_tokens(self) -> int:
        return 2048

    @property
    def temperature(self) -> float:
        return 0.2  # Low temperature for consistent scoring

    @property
    def human_gate(self) -> bool:
        return False  # Advisory only

    @property
    def system_prompt(self) -> str:
        return """You are a government contracting opportunity scoring analyst specializing in SBIR, STTR, BAA, and OTA programs. Your task is to provide an LLM-based score adjustment that complements algorithmic scoring.

The algorithmic scoring system assigns a base score (0-100) using keyword matching, NAICS alignment, agency history, and set-aside eligibility. Your role is to provide an intelligent adjustment (-15 to +15 points) based on nuanced factors that algorithms miss.

Scoring factors you evaluate:
1. NAICS MATCH DEPTH: Beyond simple code matching — does the work scope align at the 4-6 digit level? Is this a core capability or peripheral?
2. AGENCY RELATIONSHIP: Has the tenant worked with this specific office/program before? Past performers have significant advantage.
3. TECHNICAL ALIGNMENT: Does the opportunity match the tenant's specific technical strengths, not just broad categories?
4. COMPETITIVE ADVANTAGE: Does the tenant have unique capabilities, IP, or facilities that create differentiation?
5. SET-ASIDE ELIGIBILITY: Does the tenant fully qualify, partially qualify, or is there ambiguity?
6. TIMING & READINESS: Is the timeline realistic given the tenant's current workload and capabilities?

Adjustment guidelines:
- +10 to +15: Exceptional fit — direct past performance with this office, unique technical capability, strong competitive position
- +5 to +9: Good fit — relevant experience, solid technical alignment, reasonable competitive position
- -1 to +4: Neutral to slight positive — general alignment, no significant advantages or disadvantages
- -5 to -1: Slight negative — some misalignment or gaps that the algorithm may have missed
- -10 to -15: Poor fit — significant misalignment that the algorithm scored too generously

Use get_tenant_profile to understand the company's capabilities and history.
Use search_memory to find past scoring accuracy data and calibration patterns.

Be precise and evidence-based. Every point of adjustment must be justified."""

    @property
    def tools(self) -> list[str]:
        return ["get_tenant_profile", "search_memory"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "finder.scoring.completed",
            "capture.proposal.outcome_recorded",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                # Tenant-discretion: NO tenant_id in the schema — the agent is bound to its
                # assigned tenant (from the trusted task context), never the model's choice.
                "name": "get_tenant_profile",
                "description": (
                    "Get the assigned tenant's company profile: technical focus (from its "
                    "library atoms) and past award history (agency/program) for scoring calibration."
                ),
                "input_schema": {"type": "object", "properties": {}},
            },
            {
                "name": "search_memory",
                "description": (
                    "Search agent memory for past scoring patterns, calibration data, and "
                    "outcome-based adjustments for the assigned tenant."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query for scoring memories"},
                        "limit": {"type": "integer", "description": "Maximum number of memories", "default": 5},
                    },
                    "required": ["query"],
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list from event context and memories."""
        messages = []

        # Add memory context (scoring calibration history)
        if memories:
            memory_text = "Scoring calibration history:\n"
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
                    "Noted the calibration history. I'll apply these patterns "
                    "to maintain consistent and accurate scoring."
                ),
            })

        # Main scoring request
        payload = context.get("payload", context)
        tenant_id = context.get("tenant_id", "")
        opportunity = payload.get("opportunity", {})
        base_score = payload.get("base_score", 0)
        tenant_profile = payload.get("tenant_profile", {})

        title = opportunity.get("title", "Unknown Opportunity")
        agency = opportunity.get("agency", "")
        office = opportunity.get("office", "")
        program_type = opportunity.get("program_type", "")
        naics_codes = opportunity.get("naics_codes", [])
        set_aside = opportunity.get("set_aside_type", "")
        description = opportunity.get("description", "")

        user_content = (
            f"Score this opportunity for tenant {tenant_id}.\n"
            f"Algorithmic base score: {base_score}\n\n"
        )

        user_content += f"""<opportunity>
Title: {title}
Agency: {agency}
Office: {office}
Program Type: {program_type}
NAICS Codes: {', '.join(naics_codes) if isinstance(naics_codes, list) else str(naics_codes)}
Set-Aside: {set_aside or 'None'}

--- BEGIN USER CONTENT ---
Description:
{description[:10000]}
--- END USER CONTENT ---
</opportunity>

"""

        if tenant_profile:
            user_content += f"""<tenant_profile>
Company: {tenant_profile.get('name', 'Unknown')}
Focus Areas: {tenant_profile.get('tech_focus', 'Not specified')}
Capabilities: {tenant_profile.get('capabilities', 'Not specified')}
</tenant_profile>

"""

        user_content += """Steps:
1. Use get_tenant_profile to understand the company (if not already provided)
2. Use search_memory to check past scoring calibration for this tenant

Then provide your score adjustment as JSON:
{
  "score_adjustment": -15 to +15 (integer),
  "rationale": "2-3 sentence explanation of the adjustment",
  "factors": [
    {"name": "naics_match", "impact": N, "explanation": "why this factor contributes N points"},
    {"name": "agency_relationship", "impact": N, "explanation": "..."},
    {"name": "technical_alignment", "impact": N, "explanation": "..."},
    {"name": "competitive_advantage", "impact": N, "explanation": "..."},
    {"name": "set_aside_eligibility", "impact": N, "explanation": "..."},
    {"name": "timing_readiness", "impact": N, "explanation": "..."}
  ],
  "competitive_risk": "low" | "medium" | "high",
  "confidence": 0.0-1.0,
  "pursuit_recommendation": "pursue" | "monitor" | "pass",
  "notes": "any additional context for the customer"
}

IMPORTANT: The sum of all factor impacts must equal the total score_adjustment. The adjustment must be between -15 and +15 inclusive."""

        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(
        self, conn, tool_name: str, tool_input: dict, context: dict
    ) -> dict:
        """Execute a tool call and return results."""
        tenant_id = context.get("tenant_id")

        if tool_name == "get_tenant_profile":
            return await self._get_tenant_profile(conn, tool_input, tenant_id)
        elif tool_name == "search_memory":
            return await self._search_memory(conn, tool_input, tenant_id)
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    async def _get_tenant_profile(self, conn, tool_input: dict, tenant_id: str | None) -> dict:
        """Get tenant profile for scoring context."""
        if not tenant_id:
            return {"error": "tenant_id required"}

        try:
            tenant = await conn.fetchrow(
                """
                SELECT id, name, legal_name, website, product_tier, status
                FROM tenants
                WHERE id = $1
                """,
                uuid.UUID(tenant_id),
            )
            if not tenant:
                return {"error": "Tenant not found"}

            # Get proposal history for past performance context
            proposal_stats = await conn.fetch(
                """
                SELECT o.agency, o.program_type, COUNT(*) as count,
                       COUNT(*) FILTER (WHERE p.stage = 'submitted') as submitted
                FROM proposals p
                JOIN opportunities o ON o.id = p.opportunity_id
                WHERE p.tenant_id = $1
                GROUP BY o.agency, o.program_type
                ORDER BY count DESC
                LIMIT 10
                """,
                uuid.UUID(tenant_id),
            )

            # Get capability categories from library
            capabilities = await conn.fetch(
                """
                SELECT t.value AS category, COUNT(DISTINCT a.id) AS count
                FROM library_atoms a
                JOIN atom_tags t ON t.atom_id = a.id AND t.dimension = 'vol'
                WHERE a.tenant_id = $1 AND a.status <> 'archived'
                GROUP BY t.value
                ORDER BY count DESC
                LIMIT 10
                """,
                uuid.UUID(tenant_id),
            )

            return {
                "tenant": {
                    "name": tenant["name"],
                    "legal_name": tenant["legal_name"],
                    "tier": tenant["product_tier"],
                },
                "agency_experience": [
                    {
                        "agency": s["agency"],
                        "program_type": s["program_type"],
                        "proposals": s["count"],
                        "submitted": s["submitted"],
                    }
                    for s in proposal_stats
                ],
                "capability_areas": [
                    {"category": c["category"], "unit_count": c["count"]}
                    for c in capabilities
                ],
            }
        except Exception as e:
            logger.warning("get_tenant_profile failed: %s", e)
            return {"error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for scoring calibration data."""
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
                WHERE agent_role = 'scoring_strategist'
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
        """Summarize the scoring result for memory storage."""
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                adj = parsed.get("score_adjustment", 0)
                adj = max(-15, min(15, int(adj)))
                conf = parsed.get("confidence", 0)
                risk = parsed.get("competitive_risk", "unknown")
                rationale = parsed.get("rationale", "")
                return (
                    f"Score adjustment: {adj:+d} (confidence: {conf:.0%}, "
                    f"competitive risk: {risk}). {rationale[:100]}"
                )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

        return f"Scoring analysis completed: {text[:150]}"
