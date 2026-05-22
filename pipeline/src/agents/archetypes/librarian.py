"""
================================================================================
Librarian -- Content Library Cataloging, Scoring, and Retrieval
================================================================================

ROLE:       Catalogs, scores, and retrieves content library units. Assesses
            quality and reusability, detects duplicates, suggests tags, and
            scores relevance to company focus areas. Manages the lifecycle
            of content from ingestion to retirement.

LAYER:      Company Agent
            - Company: per-tenant isolated, learns content patterns over time

TRIGGERS:   library.unit.created (new content uploaded)
            library.bulk_import.completed (batch content import)
            capture.partner.upload_received (partner document decomposition)
            capture.proposal.submitted (harvest winning content)
            capture.proposal.outcome_recorded (tag with win/loss)

INPUTS:     - New content text (from uploads, imports, or harvesting)
            - Existing library units (for deduplication)
            - Tenant profile (for relevance scoring)
            - Usage patterns from memory

OUTPUTS:    - Content category classification
            - Quality score (0-1)
            - Relevance score to company focus (0-1)
            - Suggested tags
            - Duplicate candidate IDs
            - Freshness assessment
            - Content summary

TOOLS:      - library.search: find existing similar units for dedup
            - memory.search: find usage patterns for this content type
            - tenant.get_profile: company context for relevance scoring

MODEL:      claude-haiku-4-5-20251001
            Budget: 2048 output, 10K-30K input

HUMAN GATE: NO explicit gate -- new units start in DRAFT status (implicit gate)
            Tenant admin must approve before units enter active library.

GUARDRAILS:
            - Quality score must be justified with specific criteria
            - Duplicate detection must compare content, not just titles
            - Categories must be from the defined set
            - NEVER auto-approve content into active library
            - NEVER delete existing units without human authorization

MEMORY:     Categories: content_patterns, usage_tracking, quality_benchmarks
            Writes: categorization decisions, quality assessments, usage frequency
            Reads: past categorization patterns, content usage history

INSTANCES:
            - Admin Pipeline: N/A
            - Customer Portal: activated on content upload or bulk import

COST:       $0.01/call

EVENT EMISSIONS:
            - tool:agent.librarian.start (start)
            - tool:agent.librarian.end (end)
            - library.unit.cataloged (domain event)

CHANGE LOG:
    PR #140 (2026-05-22) -- Empty stub
    PR #xxx (2026-05-22) -- Full implementation with tools, prompts, events
================================================================================
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.librarian")


class LibrarianArchetype(BaseArchetype):
    """Expert content librarian for government proposal content.

    Handles: library.unit.created, library.bulk_import.completed
    Categorizes new content, assesses quality and reusability, detects
    duplicates, suggests tags, and scores relevance to company focus areas.
    Uses Haiku for fast, cheap categorization at scale.
    """

    @property
    def role_name(self) -> str:
        return "librarian"

    @property
    def model(self) -> str:
        return "claude-haiku-4-5-20251001"

    @property
    def max_tokens(self) -> int:
        return 2048

    @property
    def temperature(self) -> float:
        return 0.2  # Consistent categorization

    @property
    def human_gate(self) -> bool:
        return False  # Implicit gate: units created in DRAFT status

    @property
    def system_prompt(self) -> str:
        return """You are an expert content librarian specializing in government proposal content management. You catalog, score, and organize content for reuse across federal proposals (SBIR, STTR, BAA, OTA).

Your responsibilities:
1. CATEGORIZE: Assign the correct category to new content from the defined set:
   - technical_approach: Technical methodology, innovation descriptions, R&D plans
   - past_performance: Contract references, project outcomes, performance metrics
   - key_personnel: Bios, qualifications, role descriptions, CVs
   - management_plan: Project management, organizational structure, schedules
   - cost_pricing: Budget narratives, cost justifications (NOT actual pricing)
   - company_overview: Corporate capabilities, facilities, equipment
   - certifications: Compliance certifications, clearances, quality standards
   - commercialization: Market analysis, commercialization plans, transition strategy

2. QUALITY ASSESSMENT: Score content quality (0.0 to 1.0) based on:
   - Specificity: Contains concrete metrics, dates, and details (vs. vague claims)
   - Relevance: Clearly relates to government proposal content
   - Completeness: Stands alone as a reusable content unit
   - Currency: Information appears up-to-date
   - Writing quality: Clear, professional, proposal-appropriate language

3. RELEVANCE SCORING: Score how relevant this content is to the company's focus areas (0.0 to 1.0)

4. DUPLICATE DETECTION: Compare against existing library units and flag potential duplicates. Consider:
   - Exact content matches (likely duplicates)
   - Substantially similar content (potential duplicates — different wording, same facts)
   - Updated versions (newer version of existing content)

5. TAG SUGGESTIONS: Recommend tags for searchability (agencies, NAICS codes, technology areas, program types)

6. FRESHNESS: Assess whether content might be outdated (personnel who may have moved, old contract dates, deprecated technologies)

Use search_library to find existing similar units for deduplication.
Use search_memory to understand past categorization patterns and content usage.
Use get_tenant_profile to understand the company's focus areas for relevance scoring."""

    @property
    def tools(self) -> list[str]:
        return ["search_library", "search_memory", "get_tenant_profile"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "library.unit.created",
            "library.bulk_import.completed",
            "capture.partner.upload_received",
            "capture.proposal.submitted",
            "capture.proposal.outcome_recorded",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "search_library",
                "description": (
                    "Search existing library units for potential duplicates "
                    "or similar content. Returns matching units by content "
                    "similarity, category, and tags."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query (keywords or excerpt from new content)",
                        },
                        "tenant_id": {
                            "type": "string",
                            "description": "UUID of the tenant",
                        },
                        "category": {
                            "type": "string",
                            "enum": [
                                "technical_approach",
                                "past_performance",
                                "key_personnel",
                                "management_plan",
                                "cost_pricing",
                                "company_overview",
                                "certifications",
                                "commercialization",
                            ],
                            "description": "Category to narrow duplicate search",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of results",
                            "default": 10,
                        },
                    },
                    "required": ["query", "tenant_id"],
                },
            },
            {
                "name": "search_memory",
                "description": (
                    "Search agent memory for past categorization decisions, "
                    "content usage patterns, and quality benchmarks."
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
                            "description": "Maximum number of memories",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "get_tenant_profile",
                "description": (
                    "Get the tenant's company profile to understand focus "
                    "areas and capabilities for relevance scoring."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "tenant_id": {
                            "type": "string",
                            "description": "UUID of the tenant",
                        },
                    },
                    "required": ["tenant_id"],
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list for Claude from event context and memories."""
        messages = []

        # Add memory context if available
        if memories:
            memory_text = "Past cataloging patterns and quality benchmarks:\n"
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
                    "I've reviewed the cataloging patterns. "
                    "I'll apply consistent categorization standards."
                ),
            })

        # Main cataloging request
        payload = context.get("payload", context)
        tenant_id = context.get("tenant_id", "")
        content_text = payload.get("content", "")
        source = payload.get("source", "unknown")
        existing_title = payload.get("title", "")
        existing_tags = payload.get("tags", [])

        user_content = (
            f"Catalog this new content unit for tenant {tenant_id}.\n"
            f"Source: {source}\n"
        )

        if existing_title:
            user_content += f"Provided title: {existing_title}\n"

        if existing_tags:
            user_content += f"Provided tags: {', '.join(existing_tags)}\n"

        user_content += f"""
<new_content>
--- BEGIN USER CONTENT ---
{content_text[:20000]}
--- END USER CONTENT ---
</new_content>

Steps:
1. Use search_library to find existing similar units (for deduplication)
2. Use get_tenant_profile to understand the company's focus areas
3. Use search_memory to check past cataloging decisions for consistency

Then provide your assessment as JSON:
{{
  "category": "one of the defined categories",
  "quality_score": 0.0-1.0,
  "quality_rationale": "why this score",
  "relevance_score": 0.0-1.0,
  "relevance_rationale": "how this relates to company focus",
  "suggested_tags": ["tag1", "tag2", "tag3"],
  "duplicate_candidates": [
    {{"id": "existing_unit_id", "similarity": "exact | substantial | partial", "recommendation": "keep_new | keep_existing | merge"}}
  ],
  "freshness_assessment": "current | aging | stale",
  "freshness_notes": "any concerns about outdated information",
  "summary": "2-3 sentence summary of the content for quick reference",
  "improvement_suggestions": ["how the content could be improved for reuse"]
}}"""

        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(
        self, conn, tool_name: str, tool_input: dict, context: dict
    ) -> dict:
        """Execute a tool call and return results."""
        tenant_id = context.get("tenant_id")

        if tool_name == "search_library":
            return await self._search_library(conn, tool_input)
        elif tool_name == "search_memory":
            return await self._search_memory(conn, tool_input, tenant_id)
        elif tool_name == "get_tenant_profile":
            return await self._get_tenant_profile(conn, tool_input)
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    async def _search_library(self, conn, tool_input: dict) -> dict:
        """Search library for existing similar units."""
        tenant_id = tool_input.get("tenant_id")
        query = tool_input.get("query", "")
        category = tool_input.get("category")
        limit = tool_input.get("limit", 10)

        if not tenant_id:
            return {"results": [], "note": "No tenant context available"}

        try:
            escaped_query = query[:100].replace("%", "\\%").replace("_", "\\_")

            if category:
                rows = await conn.fetch(
                    """
                    SELECT id, title, content, category, tags,
                           quality_score, atom_hash
                    FROM library_atoms
                    WHERE tenant_id = $1
                      AND category = $2
                      AND (content ILIKE $3 OR title ILIKE $3)
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
                    SELECT id, title, content, category, tags,
                           quality_score, atom_hash
                    FROM library_atoms
                    WHERE tenant_id = $1
                      AND (content ILIKE $2 OR title ILIKE $2)
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
                        "title": row["title"],
                        "content": row["content"][:1000] if row["content"] else "",
                        "category": row["category"],
                        "tags": row["tags"] if row["tags"] else [],
                        "quality_score": (
                            float(row["quality_score"])
                            if row["quality_score"]
                            else None
                        ),
                        "atom_hash": row["atom_hash"],
                    }
                    for row in rows
                ],
            }
        except Exception as e:
            logger.warning("search_library failed: %s", e)
            return {"results": [], "error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for cataloging patterns."""
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
                WHERE agent_role = 'librarian'
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

    async def _get_tenant_profile(self, conn, tool_input: dict) -> dict:
        """Get tenant profile for relevance scoring."""
        tenant_id = tool_input.get("tenant_id")
        if not tenant_id:
            return {"error": "tenant_id required"}

        try:
            tenant = await conn.fetchrow(
                """
                SELECT id, name, legal_name, product_tier
                FROM tenants
                WHERE id = $1
                """,
                uuid.UUID(tenant_id),
            )
            if not tenant:
                return {"error": "Tenant not found"}

            # Get capability distribution from library
            capabilities = await conn.fetch(
                """
                SELECT category, COUNT(*) as count,
                       AVG(quality_score) as avg_quality
                FROM library_atoms
                WHERE tenant_id = $1
                GROUP BY category
                ORDER BY count DESC
                """,
                uuid.UUID(tenant_id),
            )

            # Get proposal focus for understanding priorities
            focus_areas = await conn.fetch(
                """
                SELECT o.agency, o.program_type, COUNT(*) as count
                FROM proposals p
                JOIN opportunities o ON o.id = p.opportunity_id
                WHERE p.tenant_id = $1
                GROUP BY o.agency, o.program_type
                ORDER BY count DESC
                LIMIT 10
                """,
                uuid.UUID(tenant_id),
            )

            return {
                "tenant": {
                    "name": tenant["name"],
                    "tier": tenant["product_tier"],
                },
                "library_distribution": [
                    {
                        "category": c["category"],
                        "count": c["count"],
                        "avg_quality": (
                            float(c["avg_quality"])
                            if c["avg_quality"]
                            else None
                        ),
                    }
                    for c in capabilities
                ],
                "focus_areas": [
                    {
                        "agency": f["agency"],
                        "program_type": f["program_type"],
                        "proposal_count": f["count"],
                    }
                    for f in focus_areas
                ],
            }
        except Exception as e:
            logger.warning("get_tenant_profile failed: %s", e)
            return {"error": str(e)}

    def summarize_result(self, result: dict) -> str:
        """Summarize the cataloging result for memory storage."""
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                category = parsed.get("category", "unknown")
                quality = parsed.get("quality_score", 0)
                relevance = parsed.get("relevance_score", 0)
                dupes = len(parsed.get("duplicate_candidates", []))
                freshness = parsed.get("freshness_assessment", "unknown")
                return (
                    f"Cataloged as {category} (quality: {quality:.0%}, "
                    f"relevance: {relevance:.0%}, freshness: {freshness}, "
                    f"{dupes} potential duplicates)"
                )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

        return f"Content cataloged: {text[:150]}"
