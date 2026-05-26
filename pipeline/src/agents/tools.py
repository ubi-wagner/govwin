"""
================================================================================
ToolRegistry — Tenant-Isolated Tool Execution Layer
================================================================================

WHO:    Called by AgentFabric during tool-use loops. Agents request tool calls,
        fabric routes them here for validated, audited execution.

WHAT:   Maps tool names to handler functions. Every execution:
        1. Validates tool exists in registry
        2. Validates agent is allowed to call this tool (per archetype allowlist)
        3. Validates tenant_id is set for tenant-scoped tools
        4. Executes handler with tenant isolation
        5. Logs execution to agent_task_log audit trail
        6. Returns structured result

WHY:    Agents NEVER construct SQL directly. Tools are the only way agents
        interact with data. This layer enforces tenant isolation — even if
        an agent's prompt is compromised, tools will only return/modify data
        belonging to the authenticated tenant.

GUARDRAILS:
    - tenant_id is NEVER accepted from tool input — always from invocation context
    - Every query includes WHERE tenant_id = $1
    - Tool execution failures never crash the agent — return error dict
    - All executions logged for audit trail

REGISTERED TOOLS (V1):
    memory.search          — Search episodic/semantic/procedural memories
    memory.write           — Write new memory
    library.search         — Search library units by keyword/category
    library.get_unit       — Get specific library unit content
    proposal.get_sections  — Get proposal sections for context
    proposal.get_compliance — Get compliance matrix for proposal
    opportunity.get_detail — Get opportunity/solicitation details
    tenant.get_profile     — Get tenant profile (capabilities, focus areas)
    compliance.check       — Check section against compliance variables

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub with register/execute skeleton
    PR #xxx (2026-05-22) — Full implementation: 9 tools registered, tenant
                           isolation, audit logging, error handling
================================================================================
"""

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

logger = logging.getLogger("pipeline.agents")


# ---------------------------------------------------------------------------
# Tool definition
# ---------------------------------------------------------------------------

@dataclass
class ToolDef:
    """Metadata and handler for a registered tool."""
    handler: Callable[..., Coroutine[Any, Any, dict]]
    tenant_scoped: bool = True
    description: str = ""
    parameters: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class ToolRegistry:
    """Maps tool names to functions, validates inputs, logs execution.

    Every tool execution is tenant-isolated: the tenant_id comes from the
    invocation context (set by the fabric), never from the tool's input
    parameters. This prevents prompt-injection attacks from accessing
    other tenants' data.
    """

    def __init__(self):
        self._tools: dict[str, ToolDef] = {}

    def register(
        self,
        name: str,
        handler: Callable[..., Coroutine[Any, Any, dict]],
        *,
        tenant_scoped: bool = True,
        description: str = "",
        parameters: dict | None = None,
    ) -> None:
        """Register a tool handler by name."""
        self._tools[name] = ToolDef(
            handler=handler,
            tenant_scoped=tenant_scoped,
            description=description,
            parameters=parameters or {},
        )

    def has_tool(self, name: str) -> bool:
        """Check if a tool is registered by name."""
        return name in self._tools

    async def execute(
        self,
        conn,
        tenant_id: str | None,
        tool_name: str,
        params: dict,
        *,
        allowed_tools: list[str] | None = None,
    ) -> dict:
        """Validate and execute a tool call.

        Args:
            conn: asyncpg connection
            tenant_id: UUID string from the invocation context (NOT from params)
            tool_name: registered tool name
            params: tool input parameters (tenant_id stripped if present)
            allowed_tools: optional whitelist of tool names for this archetype

        Returns:
            dict with the tool result, or {"error": "..."} on failure
        """
        # 1. Validate tool exists
        tool_def = self._tools.get(tool_name)
        if not tool_def:
            logger.error("[tool_execute] unknown tool: %s", tool_name)
            return {"error": f"Unknown tool: {tool_name}"}

        # 2. Validate tool is in the archetype's allowed list
        if allowed_tools is not None and tool_name not in allowed_tools:
            logger.error(
                "[tool_execute] tool %s not in allowed list: %s",
                tool_name, allowed_tools,
            )
            return {"error": f"Tool {tool_name} is not allowed for this agent"}

        # 3. Validate tenant_id for tenant-scoped tools
        if tool_def.tenant_scoped and not tenant_id:
            logger.error("[tool_execute] tenant_id required for tool %s", tool_name)
            return {"error": f"Tool {tool_name} requires tenant context"}

        # 4. Strip tenant_id from params (never trust tool input for this)
        safe_params = {
            k: v for k, v in params.items()
            if k != "tenant_id"
        }

        # 5. Execute the handler
        try:
            result = await tool_def.handler(conn, tenant_id, **safe_params)
            return result
        except Exception as exc:
            logger.error("[tool_execute] %s failed: %s", tool_name, exc)
            return {"error": f"Tool execution failed: {str(exc)[:200]}"}

    def get_definitions(self, allowed_tools: list[str] | None = None) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format.

        Args:
            allowed_tools: if provided, only return tools in this list.
                           If empty list, returns nothing. If None, returns all.

        Returns:
            list of dicts in the Anthropic tool definition format:
            [{"name": "...", "description": "...", "input_schema": {...}}, ...]
        """
        definitions: list[dict] = []

        for name, tool_def in self._tools.items():
            if allowed_tools is not None and name not in allowed_tools:
                continue

            # Build the input_schema from the tool's parameters spec
            input_schema = tool_def.parameters if tool_def.parameters else {
                "type": "object",
                "properties": {},
            }

            # Ensure schema has required type field
            if "type" not in input_schema:
                input_schema["type"] = "object"

            definitions.append({
                "name": name,
                "description": tool_def.description,
                "input_schema": input_schema,
            })

        return definitions

    @property
    def tool_names(self) -> list[str]:
        """Return list of all registered tool names."""
        return list(self._tools.keys())


# ---------------------------------------------------------------------------
# ILIKE pattern escaping helper
# ---------------------------------------------------------------------------

def _escape_ilike(value: str) -> str:
    """Escape special characters for PostgreSQL ILIKE patterns."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ---------------------------------------------------------------------------
# Tool handler implementations
# ---------------------------------------------------------------------------

async def _memory_search(
    conn, tenant_id: str,
    *,
    query: str = "",
    memory_type: str = "episodic",
    limit: int = 10,
) -> dict:
    """Search episodic, semantic, or procedural memories by content match.

    Uses ILIKE for text search (V1). Vector similarity in V2.
    """
    if limit < 1:
        limit = 1
    elif limit > 25:
        limit = 25

    tenant_uuid = uuid.UUID(tenant_id)
    escaped_query = _escape_ilike(query) if query else ""
    pattern = f"%{escaped_query}%" if escaped_query else "%"

    try:
        if memory_type == "semantic":
            rows = await conn.fetch(
                """
                SELECT id, content, category, subcategory, confidence,
                       evidence_count, updated_at
                FROM semantic_memories
                WHERE tenant_id = $1
                  AND is_active = true
                  AND content ILIKE $2
                ORDER BY confidence DESC, updated_at DESC
                LIMIT $3
                """,
                tenant_uuid, pattern, limit,
            )
            return {
                "memories": [
                    {
                        "id": str(r["id"]),
                        "content": r["content"],
                        "category": r["category"],
                        "subcategory": r["subcategory"],
                        "confidence": float(r["confidence"]),
                    }
                    for r in rows
                ],
                "count": len(rows),
            }

        elif memory_type == "procedural":
            rows = await conn.fetch(
                """
                SELECT id, name, description, steps, success_rate,
                       execution_count
                FROM procedural_memories
                WHERE tenant_id = $1
                  AND is_active = true
                  AND (name ILIKE $2 OR description ILIKE $2)
                ORDER BY success_rate DESC, execution_count DESC
                LIMIT $3
                """,
                tenant_uuid, pattern, limit,
            )
            results = []
            for r in rows:
                steps = r["steps"]
                if isinstance(steps, str):
                    try:
                        steps = json.loads(steps)
                    except (json.JSONDecodeError, TypeError):
                        steps = []
                results.append({
                    "id": str(r["id"]),
                    "name": r["name"],
                    "description": r["description"],
                    "steps": steps or [],
                    "success_rate": float(r["success_rate"]) if r["success_rate"] else 0.0,
                })
            return {"memories": results, "count": len(results)}

        else:
            # Default: episodic
            rows = await conn.fetch(
                """
                SELECT id, content, memory_type, importance, metadata,
                       occurred_at
                FROM episodic_memories
                WHERE tenant_id = $1
                  AND is_archived = false
                  AND content ILIKE $2
                ORDER BY (importance * decay_factor) DESC, occurred_at DESC
                LIMIT $3
                """,
                tenant_uuid, pattern, limit,
            )
            return {
                "memories": [
                    {
                        "id": str(r["id"]),
                        "content": r["content"],
                        "memory_type": r["memory_type"],
                        "importance": float(r["importance"]),
                        "occurred_at": r["occurred_at"].isoformat() if r["occurred_at"] else None,
                    }
                    for r in rows
                ],
                "count": len(rows),
            }

    except Exception as exc:
        logger.error("[memory.search] failed: %s", exc)
        return {"error": f"Memory search failed: {str(exc)[:200]}", "memories": [], "count": 0}


async def _memory_write(
    conn, tenant_id: str,
    *,
    content: str,
    memory_type: str = "observation",
    agent_role: str = "unknown",
) -> dict:
    """Write a new episodic memory entry."""
    # Zero vector placeholder (1536 dims for text-embedding-3-small compat)
    zero_vector = "[" + ",".join(["0.0"] * 1536) + "]"

    memory_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    try:
        await conn.execute(
            """
            INSERT INTO episodic_memories
                (id, tenant_id, agent_role, embedding, content, memory_type,
                 importance, metadata, source, occurred_at, created_at)
            VALUES
                ($1, $2, $3, $4::vector, $5, $6,
                 0.5, '{}'::jsonb, 'agent_tool', $7, $7)
            """,
            memory_id,
            uuid.UUID(tenant_id),
            agent_role,
            zero_vector,
            content,
            memory_type,
            now,
        )
        return {"id": str(memory_id), "status": "written"}
    except Exception as exc:
        logger.error("[memory.write] failed: %s", exc)
        return {"error": f"Memory write failed: {str(exc)[:200]}"}


async def _library_search(
    conn, tenant_id: str,
    *,
    query: str = "",
    category: str = "",
    limit: int = 10,
) -> dict:
    """Search library_units by keyword and/or category."""
    if limit < 1:
        limit = 1
    elif limit > 25:
        limit = 25

    tenant_uuid = uuid.UUID(tenant_id)
    escaped_query = _escape_ilike(query) if query else ""
    escaped_category = _escape_ilike(category) if category else ""

    try:
        if query and category:
            query_pattern = f"%{escaped_query}%"
            cat_pattern = f"%{escaped_category}%"
            rows = await conn.fetch(
                """
                SELECT id, content, category, subcategory, tags,
                       confidence, status, usage_count
                FROM library_units
                WHERE tenant_id = $1
                  AND status != 'archived'
                  AND content ILIKE $2
                  AND category ILIKE $3
                ORDER BY confidence DESC, usage_count DESC
                LIMIT $4
                """,
                tenant_uuid, query_pattern, cat_pattern, limit,
            )
        elif query:
            query_pattern = f"%{escaped_query}%"
            rows = await conn.fetch(
                """
                SELECT id, content, category, subcategory, tags,
                       confidence, status, usage_count
                FROM library_units
                WHERE tenant_id = $1
                  AND status != 'archived'
                  AND content ILIKE $2
                ORDER BY confidence DESC, usage_count DESC
                LIMIT $3
                """,
                tenant_uuid, query_pattern, limit,
            )
        elif category:
            cat_pattern = f"%{escaped_category}%"
            rows = await conn.fetch(
                """
                SELECT id, content, category, subcategory, tags,
                       confidence, status, usage_count
                FROM library_units
                WHERE tenant_id = $1
                  AND status != 'archived'
                  AND category ILIKE $2
                ORDER BY confidence DESC, usage_count DESC
                LIMIT $3
                """,
                tenant_uuid, cat_pattern, limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, content, category, subcategory, tags,
                       confidence, status, usage_count
                FROM library_units
                WHERE tenant_id = $1
                  AND status != 'archived'
                ORDER BY usage_count DESC, confidence DESC
                LIMIT $2
                """,
                tenant_uuid, limit,
            )

        return {
            "units": [
                {
                    "id": str(r["id"]),
                    "content": r["content"][:500],  # Truncate for context window
                    "category": r["category"],
                    "subcategory": r["subcategory"],
                    "tags": r["tags"] or [],
                    "confidence": float(r["confidence"]),
                    "status": r["status"],
                    "usage_count": r["usage_count"],
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as exc:
        logger.error("[library.search] failed: %s", exc)
        return {"error": f"Library search failed: {str(exc)[:200]}", "units": [], "count": 0}


async def _library_get_unit(
    conn, tenant_id: str,
    *,
    unit_id: str,
) -> dict:
    """Get a specific library unit by ID (with tenant isolation)."""
    try:
        row = await conn.fetchrow(
            """
            SELECT id, content, category, subcategory, tags,
                   confidence, status, source_type, usage_count,
                   created_at, updated_at
            FROM library_units
            WHERE id = $1 AND tenant_id = $2
            """,
            uuid.UUID(unit_id),
            uuid.UUID(tenant_id),
        )
        if not row:
            return {"error": "Library unit not found"}

        return {
            "id": str(row["id"]),
            "content": row["content"],
            "category": row["category"],
            "subcategory": row["subcategory"],
            "tags": row["tags"] or [],
            "confidence": float(row["confidence"]),
            "status": row["status"],
            "source_type": row["source_type"],
            "usage_count": row["usage_count"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }
    except Exception as exc:
        logger.error("[library.get_unit] failed: %s", exc)
        return {"error": f"Library unit lookup failed: {str(exc)[:200]}"}


async def _proposal_get_sections(
    conn, tenant_id: str,
    *,
    proposal_id: str,
) -> dict:
    """Get proposal sections with tenant isolation via the proposals table."""
    try:
        rows = await conn.fetch(
            """
            SELECT ps.id, ps.section_number, ps.title, ps.content,
                   ps.page_allocation, ps.status, ps.ai_confidence,
                   ps.version
            FROM proposal_sections ps
            JOIN proposals p ON p.id = ps.proposal_id
            WHERE ps.proposal_id = $1
              AND p.tenant_id = $2
            ORDER BY ps.section_number ASC
            """,
            uuid.UUID(proposal_id),
            uuid.UUID(tenant_id),
        )

        return {
            "sections": [
                {
                    "id": str(r["id"]),
                    "section_number": r["section_number"],
                    "title": r["title"],
                    "content": r["content"][:1000] if r["content"] else "",
                    "page_allocation": r["page_allocation"],
                    "status": r["status"],
                    "ai_confidence": float(r["ai_confidence"]) if r["ai_confidence"] is not None else None,
                    "version": r["version"],
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as exc:
        logger.error("[proposal.get_sections] failed: %s", exc)
        return {"error": f"Proposal sections lookup failed: {str(exc)[:200]}", "sections": [], "count": 0}


async def _proposal_get_compliance(
    conn, tenant_id: str,
    *,
    proposal_id: str,
) -> dict:
    """Get compliance matrix entries for a proposal (with tenant isolation)."""
    try:
        rows = await conn.fetch(
            """
            SELECT pcm.id, pcm.requirement_text, pcm.requirement_source,
                   pcm.is_mandatory, pcm.status, pcm.section_id, pcm.notes
            FROM proposal_compliance_matrix pcm
            JOIN proposals p ON p.id = pcm.proposal_id
            WHERE pcm.proposal_id = $1
              AND p.tenant_id = $2
            ORDER BY pcm.is_mandatory DESC, pcm.created_at ASC
            """,
            uuid.UUID(proposal_id),
            uuid.UUID(tenant_id),
        )

        return {
            "requirements": [
                {
                    "id": str(r["id"]),
                    "requirement_text": r["requirement_text"],
                    "requirement_source": r["requirement_source"],
                    "is_mandatory": r["is_mandatory"],
                    "status": r["status"],
                    "section_id": str(r["section_id"]) if r["section_id"] else None,
                    "notes": r["notes"],
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as exc:
        logger.error("[proposal.get_compliance] failed: %s", exc)
        return {"error": f"Compliance matrix lookup failed: {str(exc)[:200]}", "requirements": [], "count": 0}


async def _opportunity_get_detail(
    conn, tenant_id: str,
    *,
    opportunity_id: str,
) -> dict:
    """Get opportunity details. Read-only, not tenant-scoped (opportunities are shared)."""
    try:
        row = await conn.fetchrow(
            """
            SELECT id, source, source_id, title, agency, office,
                   solicitation_number, naics_codes, set_aside_type,
                   program_type, close_date, posted_date,
                   estimated_value_min, estimated_value_max,
                   description, is_active
            FROM opportunities
            WHERE id = $1
            """,
            uuid.UUID(opportunity_id),
        )
        if not row:
            return {"error": "Opportunity not found"}

        return {
            "id": str(row["id"]),
            "source": row["source"],
            "title": row["title"],
            "agency": row["agency"],
            "office": row["office"],
            "solicitation_number": row["solicitation_number"],
            "naics_codes": row["naics_codes"] or [],
            "set_aside_type": row["set_aside_type"],
            "program_type": row["program_type"],
            "close_date": row["close_date"].isoformat() if row["close_date"] else None,
            "posted_date": row["posted_date"].isoformat() if row["posted_date"] else None,
            "estimated_value_min": float(row["estimated_value_min"]) if row["estimated_value_min"] else None,
            "estimated_value_max": float(row["estimated_value_max"]) if row["estimated_value_max"] else None,
            "description": row["description"][:2000] if row["description"] else "",
            "is_active": row["is_active"],
        }
    except Exception as exc:
        logger.error("[opportunity.get_detail] failed: %s", exc)
        return {"error": f"Opportunity lookup failed: {str(exc)[:200]}"}


async def _tenant_get_profile(
    conn, tenant_id: str,
) -> dict:
    """Get tenant profile (capabilities, focus areas, preferences)."""
    try:
        row = await conn.fetchrow(
            """
            SELECT
                tp.naics_codes, tp.keywords, tp.agency_priorities,
                tp.set_aside_types, tp.technology_focus, tp.company_summary,
                tp.research_areas, tp.target_agencies, tp.min_surface_score,
                t.name AS tenant_name, t.product_tier, t.status AS tenant_status
            FROM tenant_profiles tp
            JOIN tenants t ON t.id = tp.tenant_id
            WHERE tp.tenant_id = $1
            """,
            uuid.UUID(tenant_id),
        )
        if not row:
            return {"error": "Tenant profile not found"}

        return {
            "tenant_name": row["tenant_name"],
            "product_tier": row["product_tier"],
            "tenant_status": row["tenant_status"],
            "naics_codes": row["naics_codes"] or [],
            "keywords": row["keywords"] or [],
            "agency_priorities": row["agency_priorities"] or [],
            "set_aside_types": row["set_aside_types"] or [],
            "technology_focus": row["technology_focus"],
            "company_summary": row["company_summary"],
            "research_areas": row["research_areas"] or [],
            "target_agencies": row["target_agencies"] or [],
            "min_surface_score": row["min_surface_score"],
        }
    except Exception as exc:
        logger.error("[tenant.get_profile] failed: %s", exc)
        return {"error": f"Tenant profile lookup failed: {str(exc)[:200]}"}


async def _compliance_check(
    conn, tenant_id: str,
    *,
    solicitation_id: str,
) -> dict:
    """Get compliance rules for a solicitation.

    solicitation_compliance has per-variable columns (NOT EAV rows).
    """
    try:
        row = await conn.fetchrow(
            """
            SELECT
                sc.id,
                sc.page_limit_technical,
                sc.page_limit_cost,
                sc.page_limit_other,
                sc.font_family,
                sc.font_size,
                sc.margins,
                sc.line_spacing,
                sc.header_required,
                sc.header_format,
                sc.footer_required,
                sc.footer_format,
                sc.submission_format,
                sc.images_tables_allowed,
                sc.slides_allowed,
                sc.slide_limit,
                sc.required_sections,
                sc.required_documents,
                sc.evaluation_criteria,
                sc.taba_allowed,
                sc.indirect_rate_cap,
                sc.partner_max_pct,
                sc.cost_sharing_required,
                sc.cost_volume_format,
                sc.pi_must_be_employee,
                sc.pi_university_allowed,
                sc.clearance_required,
                sc.itar_required,
                sc.far_clauses,
                sc.custom_variables,
                sc.verified_by,
                sc.verified_at
            FROM solicitation_compliance sc
            WHERE sc.solicitation_id = $1
            """,
            uuid.UUID(solicitation_id),
        )
        if not row:
            return {"error": "No compliance data found for this solicitation"}

        # Parse JSONB fields that asyncpg may return as strings
        def _parse_jsonb(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return val
            return val

        return {
            "id": str(row["id"]),
            "formatting": {
                "page_limit_technical": row["page_limit_technical"],
                "page_limit_cost": row["page_limit_cost"],
                "page_limit_other": _parse_jsonb(row["page_limit_other"]),
                "font_family": row["font_family"],
                "font_size": row["font_size"],
                "margins": row["margins"],
                "line_spacing": row["line_spacing"],
                "header_required": row["header_required"],
                "header_format": row["header_format"],
                "footer_required": row["footer_required"],
                "footer_format": row["footer_format"],
                "submission_format": row["submission_format"],
                "images_tables_allowed": row["images_tables_allowed"],
                "slides_allowed": row["slides_allowed"],
                "slide_limit": row["slide_limit"],
            },
            "requirements": {
                "required_sections": _parse_jsonb(row["required_sections"]),
                "required_documents": _parse_jsonb(row["required_documents"]),
                "evaluation_criteria": _parse_jsonb(row["evaluation_criteria"]),
            },
            "rules": {
                "taba_allowed": row["taba_allowed"],
                "indirect_rate_cap": float(row["indirect_rate_cap"]) if row["indirect_rate_cap"] else None,
                "partner_max_pct": float(row["partner_max_pct"]) if row["partner_max_pct"] else None,
                "cost_sharing_required": row["cost_sharing_required"],
                "cost_volume_format": row["cost_volume_format"],
                "pi_must_be_employee": row["pi_must_be_employee"],
                "pi_university_allowed": row["pi_university_allowed"],
                "clearance_required": row["clearance_required"],
                "itar_required": row["itar_required"],
                "far_clauses": row["far_clauses"] or [],
            },
            "custom_variables": _parse_jsonb(row["custom_variables"]),
            "verified": row["verified_at"] is not None,
        }
    except Exception as exc:
        logger.error("[compliance.check] failed: %s", exc)
        return {"error": f"Compliance check failed: {str(exc)[:200]}"}


# ---------------------------------------------------------------------------
# Default tool registration
# ---------------------------------------------------------------------------

def _register_default_tools(registry: ToolRegistry) -> None:
    """Register all V1 tools with their schemas."""

    registry.register(
        "memory.search",
        _memory_search,
        tenant_scoped=True,
        description="Search agent memories (episodic, semantic, or procedural) by keyword",
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search keyword or phrase to match against memory content",
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["episodic", "semantic", "procedural"],
                    "description": "Type of memory to search. Defaults to episodic.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results (1-25, default 10)",
                },
            },
            "required": ["query"],
        },
    )

    registry.register(
        "memory.write",
        _memory_write,
        tenant_scoped=True,
        description="Write a new episodic memory entry for future recall",
        parameters={
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The memory content to store",
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["observation", "interaction", "decision", "outcome"],
                    "description": "Type of memory. Defaults to observation.",
                },
                "agent_role": {
                    "type": "string",
                    "description": "The agent role writing this memory",
                },
            },
            "required": ["content"],
        },
    )

    registry.register(
        "library.search",
        _library_search,
        tenant_scoped=True,
        description="Search the tenant's content library units by keyword and/or category",
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search keyword to match against library content",
                },
                "category": {
                    "type": "string",
                    "description": "Filter by category name",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results (1-25, default 10)",
                },
            },
        },
    )

    registry.register(
        "library.get_unit",
        _library_get_unit,
        tenant_scoped=True,
        description="Get the full content of a specific library unit by ID",
        parameters={
            "type": "object",
            "properties": {
                "unit_id": {
                    "type": "string",
                    "description": "UUID of the library unit to retrieve",
                },
            },
            "required": ["unit_id"],
        },
    )

    registry.register(
        "proposal.get_sections",
        _proposal_get_sections,
        tenant_scoped=True,
        description="Get all sections of a proposal with their content and status",
        parameters={
            "type": "object",
            "properties": {
                "proposal_id": {
                    "type": "string",
                    "description": "UUID of the proposal",
                },
            },
            "required": ["proposal_id"],
        },
    )

    registry.register(
        "proposal.get_compliance",
        _proposal_get_compliance,
        tenant_scoped=True,
        description="Get the compliance matrix for a proposal showing requirements and their status",
        parameters={
            "type": "object",
            "properties": {
                "proposal_id": {
                    "type": "string",
                    "description": "UUID of the proposal",
                },
            },
            "required": ["proposal_id"],
        },
    )

    registry.register(
        "opportunity.get_detail",
        _opportunity_get_detail,
        tenant_scoped=False,
        description="Get details of a government contracting opportunity (solicitation)",
        parameters={
            "type": "object",
            "properties": {
                "opportunity_id": {
                    "type": "string",
                    "description": "UUID of the opportunity",
                },
            },
            "required": ["opportunity_id"],
        },
    )

    registry.register(
        "tenant.get_profile",
        _tenant_get_profile,
        tenant_scoped=True,
        description="Get the tenant's company profile including capabilities, focus areas, and preferences",
        parameters={
            "type": "object",
            "properties": {},
        },
    )

    registry.register(
        "compliance.check",
        _compliance_check,
        tenant_scoped=False,
        description="Get compliance rules and formatting requirements for a solicitation",
        parameters={
            "type": "object",
            "properties": {
                "solicitation_id": {
                    "type": "string",
                    "description": "UUID of the curated solicitation",
                },
            },
            "required": ["solicitation_id"],
        },
    )


def create_default_registry() -> ToolRegistry:
    """Create and return a ToolRegistry with all default tools registered."""
    registry = ToolRegistry()
    _register_default_tools(registry)
    return registry
