"""
================================================================================
ContextAssembler — Builds Complete Prompt for Agent Invocations
================================================================================

WHO:    Called by AgentFabric before every Claude API call.

WHAT:   Loads and assembles all context needed for a specialized agent call:
        1. Archetype system prompt (cached, ~800 tokens)
        2. Tenant profile (cached per session, ~500 tokens)
        3. Retrieved memories (episodic + semantic + procedural, ~2000-4000 tokens)
        4. Task-specific data (from event payload or task queue)
        5. Available tools (from archetype + registry)

WHY:    Agents improve through context injection, not fine-tuning. The quality
        of context assembly directly determines agent output quality. Bad
        retrieval = generic output. Good retrieval = specialized, improving output.

HOW:    Hybrid retrieval: vector similarity (when embeddings available) +
        recency weighting + importance scoring. Token budget enforced per
        memory category to prevent context overflow.

TOKEN BUDGET (per call):
    System prompt (cached):     ~3,500 tokens
      - Archetype instructions: ~800
      - Tenant profile:         ~500
      - Retrieved memories:     ~2,000-4,000
    User message (dynamic):     ~5,500-20,500 tokens
    Response budget:            ~2,000-8,000 tokens

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub
    PR #xxx (2026-05-22) — Full implementation: tenant profile loading, memory
                           retrieval with token budgets, context formatting
================================================================================
"""

import json
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger("pipeline.agents")

# ---------------------------------------------------------------------------
# Token budget constants (rough estimates — 1 token ~ 4 chars)
# ---------------------------------------------------------------------------

MAX_EPISODIC_TOKENS = 2000
MAX_SEMANTIC_TOKENS = 1500
MAX_PROCEDURAL_TOKENS = 1000
MAX_TENANT_PROFILE_TOKENS = 500


class ContextAssembler:
    """Loads archetype prompt + tenant profile + memories + task data + tools.

    The assembler is stateless — it queries the database on every invocation.
    Caching of tenant profiles may be added in V2 when connection pooling is
    ready, but for now each call is a fresh read to avoid stale data.
    """

    async def assemble(
        self,
        conn,
        archetype,
        tenant_id: str | None,
        task_data: dict,
    ) -> dict:
        """Build the complete context for a Claude API call.

        Args:
            conn: asyncpg connection
            archetype: BaseArchetype instance (has system_prompt, tools, etc.)
            tenant_id: UUID string of the tenant (None for admin/system calls)
            task_data: dict containing event payload or task queue input

        Returns:
            dict with keys:
                system_prompt: str — combined system prompt
                messages: list[dict] — user/assistant message list
                tools: list[dict] — tool definitions in Anthropic format
        """
        # Load tenant profile
        tenant_profile = ""
        if tenant_id:
            tenant_profile = await self._load_tenant_profile(conn, tenant_id)

        # Retrieve memories
        episodic_memories = ""
        semantic_memories = ""
        procedural_memories = ""
        if tenant_id:
            memories = await self._retrieve_memories(
                conn, tenant_id, archetype, task_data,
            )
            episodic_memories = memories.get("episodic", "")
            semantic_memories = memories.get("semantic", "")
            procedural_memories = memories.get("procedural", "")

        # Format the system prompt
        system_prompt = self._format_system_prompt(
            archetype=archetype,
            tenant_profile=tenant_profile,
            episodic_memories=episodic_memories,
            semantic_memories=semantic_memories,
            procedural_memories=procedural_memories,
        )

        # Build messages from task data
        messages = self._build_messages(archetype, task_data)

        # Get tool definitions
        tools = archetype.get_tools() if hasattr(archetype, "get_tools") else []

        return {
            "system_prompt": system_prompt,
            "messages": messages,
            "tools": tools,
        }

    # ------------------------------------------------------------------
    # Tenant profile loading
    # ------------------------------------------------------------------

    async def _load_tenant_profile(self, conn, tenant_id: str) -> str:
        """Query tenant_profiles and tenants to build a profile context string.

        Returns a formatted string describing the tenant's capabilities,
        focus areas, and preferences. Truncated to stay within token budget.
        """
        try:
            row = await conn.fetchrow(
                """
                SELECT
                    tp.naics_codes,
                    tp.keywords,
                    tp.agency_priorities,
                    tp.set_aside_types,
                    tp.technology_focus,
                    tp.company_summary,
                    tp.research_areas,
                    tp.target_agencies,
                    tp.min_surface_score,
                    t.name AS tenant_name,
                    t.product_tier
                FROM tenant_profiles tp
                JOIN tenants t ON t.id = tp.tenant_id
                WHERE tp.tenant_id = $1
                """,
                uuid.UUID(tenant_id),
            )
        except Exception as exc:
            logger.error("[_load_tenant_profile] query failed: %s", exc)
            return ""

        if not row:
            return ""

        # Build profile string
        parts: list[str] = []

        if row["tenant_name"]:
            parts.append(f"Company: {row['tenant_name']}")
        if row["product_tier"]:
            parts.append(f"Tier: {row['product_tier']}")
        if row["company_summary"]:
            parts.append(f"Summary: {row['company_summary']}")
        if row["technology_focus"]:
            parts.append(f"Technology Focus: {row['technology_focus']}")

        if row["naics_codes"]:
            codes = ", ".join(row["naics_codes"][:10])
            parts.append(f"NAICS Codes: {codes}")
        if row["keywords"]:
            kw = ", ".join(row["keywords"][:15])
            parts.append(f"Keywords: {kw}")
        if row["agency_priorities"]:
            agencies = ", ".join(row["agency_priorities"][:10])
            parts.append(f"Priority Agencies: {agencies}")
        if row["target_agencies"]:
            targets = ", ".join(row["target_agencies"][:10])
            parts.append(f"Target Agencies: {targets}")
        if row["set_aside_types"]:
            types = ", ".join(row["set_aside_types"][:5])
            parts.append(f"Set-Aside Types: {types}")
        if row["research_areas"]:
            areas = ", ".join(row["research_areas"][:10])
            parts.append(f"Research Areas: {areas}")
        if row["min_surface_score"] is not None:
            parts.append(f"Min Surface Score: {row['min_surface_score']}")

        profile_text = "\n".join(parts)

        # Enforce token budget (rough: 4 chars per token)
        max_chars = MAX_TENANT_PROFILE_TOKENS * 4
        if len(profile_text) > max_chars:
            profile_text = profile_text[:max_chars] + "..."

        return profile_text

    # ------------------------------------------------------------------
    # Memory retrieval
    # ------------------------------------------------------------------

    async def _retrieve_memories(
        self,
        conn,
        tenant_id: str,
        archetype,
        task_data: dict,
    ) -> dict[str, str]:
        """Query episodic, semantic, and procedural memories.

        Uses recency + importance scoring (V1 — no vector similarity yet).
        Each memory type has a token budget to prevent context overflow.

        Returns dict with keys: episodic, semantic, procedural
        """
        agent_role = getattr(archetype, "role_name", "unknown")
        tenant_uuid = uuid.UUID(tenant_id)

        episodic_text = await self._retrieve_episodic(conn, tenant_uuid, agent_role)
        semantic_text = await self._retrieve_semantic(conn, tenant_uuid, agent_role)
        procedural_text = await self._retrieve_procedural(conn, tenant_uuid, agent_role)

        return {
            "episodic": episodic_text,
            "semantic": semantic_text,
            "procedural": procedural_text,
        }

    async def _retrieve_episodic(
        self, conn, tenant_uuid: uuid.UUID, agent_role: str,
    ) -> str:
        """Retrieve recent episodic memories, scored by importance * decay."""
        try:
            rows = await conn.fetch(
                """
                SELECT content, memory_type, importance, decay_factor,
                       occurred_at, metadata
                FROM episodic_memories
                WHERE tenant_id = $1
                  AND agent_role = $2
                  AND is_archived = false
                ORDER BY (importance * decay_factor) DESC, occurred_at DESC
                LIMIT 10
                """,
                tenant_uuid,
                agent_role,
            )
        except Exception as exc:
            logger.error("[_retrieve_episodic] query failed: %s", exc)
            return ""

        if not rows:
            return ""

        parts: list[str] = []
        total_chars = 0
        max_chars = MAX_EPISODIC_TOKENS * 4

        for row in rows:
            occurred = ""
            if row["occurred_at"]:
                occurred = row["occurred_at"].strftime("%Y-%m-%d %H:%M")

            # Parse content — it may be JSON or plain text
            content = row["content"]
            try:
                parsed = json.loads(content)
                if isinstance(parsed, dict):
                    summary_parts = []
                    if parsed.get("input_summary"):
                        summary_parts.append(f"Input: {parsed['input_summary']}")
                    if parsed.get("output_summary"):
                        summary_parts.append(f"Output: {parsed['output_summary']}")
                    content = "; ".join(summary_parts) if summary_parts else content
            except (json.JSONDecodeError, TypeError):
                pass

            entry = f"- [{occurred}] (importance={row['importance']:.1f}) {content}"
            entry_len = len(entry)

            if total_chars + entry_len > max_chars:
                break
            parts.append(entry)
            total_chars += entry_len

        return "\n".join(parts)

    async def _retrieve_semantic(
        self, conn, tenant_uuid: uuid.UUID, agent_role: str,
    ) -> str:
        """Retrieve semantic memories (known facts, preferences) by confidence."""
        try:
            rows = await conn.fetch(
                """
                SELECT content, category, subcategory, confidence,
                       evidence_count, updated_at
                FROM semantic_memories
                WHERE tenant_id = $1
                  AND agent_role = $2
                  AND is_active = true
                ORDER BY confidence DESC, evidence_count DESC, updated_at DESC
                LIMIT 8
                """,
                tenant_uuid,
                agent_role,
            )
        except Exception as exc:
            logger.error("[_retrieve_semantic] query failed: %s", exc)
            return ""

        if not rows:
            return ""

        parts: list[str] = []
        total_chars = 0
        max_chars = MAX_SEMANTIC_TOKENS * 4

        for row in rows:
            cat = row["category"]
            subcat = f"/{row['subcategory']}" if row["subcategory"] else ""
            conf = row["confidence"]
            content = row["content"]

            entry = f"- [{cat}{subcat}] (confidence={conf:.1f}, evidence={row['evidence_count']}) {content}"
            entry_len = len(entry)

            if total_chars + entry_len > max_chars:
                break
            parts.append(entry)
            total_chars += entry_len

        return "\n".join(parts)

    async def _retrieve_procedural(
        self, conn, tenant_uuid: uuid.UUID, agent_role: str,
    ) -> str:
        """Retrieve procedural memories (learned procedures) by success rate."""
        try:
            rows = await conn.fetch(
                """
                SELECT name, description, steps, success_rate,
                       execution_count, last_executed
                FROM procedural_memories
                WHERE tenant_id = $1
                  AND agent_role = $2
                  AND is_active = true
                ORDER BY success_rate DESC, execution_count DESC
                LIMIT 5
                """,
                tenant_uuid,
                agent_role,
            )
        except Exception as exc:
            logger.error("[_retrieve_procedural] query failed: %s", exc)
            return ""

        if not rows:
            return ""

        parts: list[str] = []
        total_chars = 0
        max_chars = MAX_PROCEDURAL_TOKENS * 4

        for row in rows:
            name = row["name"]
            desc = row["description"]
            rate = row["success_rate"] or 0.0

            # Format steps if available
            steps = row["steps"]
            if isinstance(steps, str):
                try:
                    steps = json.loads(steps)
                except (json.JSONDecodeError, TypeError):
                    steps = []
            elif steps is None:
                steps = []

            steps_str = ""
            if steps and isinstance(steps, list):
                step_lines = []
                for i, step in enumerate(steps[:5], 1):
                    if isinstance(step, dict):
                        step_lines.append(f"    {i}. {step.get('action', step.get('description', str(step)))}")
                    else:
                        step_lines.append(f"    {i}. {step}")
                steps_str = "\n" + "\n".join(step_lines)

            entry = f"- {name} (success={rate:.0%}, runs={row['execution_count']}): {desc}{steps_str}"
            entry_len = len(entry)

            if total_chars + entry_len > max_chars:
                break
            parts.append(entry)
            total_chars += entry_len

        return "\n".join(parts)

    # ------------------------------------------------------------------
    # System prompt formatting
    # ------------------------------------------------------------------

    def _format_system_prompt(
        self,
        *,
        archetype,
        tenant_profile: str,
        episodic_memories: str,
        semantic_memories: str,
        procedural_memories: str,
    ) -> str:
        """Combine archetype prompt, tenant profile, and memories.

        Uses clear delimiters to separate trusted context from user input,
        as a defense against prompt injection.
        """
        base_prompt = archetype.system_prompt if hasattr(archetype, "system_prompt") else ""

        # If no tenant context at all, just return the base prompt
        has_context = any([tenant_profile, episodic_memories, semantic_memories, procedural_memories])
        if not has_context:
            return base_prompt

        context_sections: list[str] = []

        if tenant_profile:
            context_sections.append(f"## Tenant Profile\n{tenant_profile}")

        memory_parts: list[str] = []
        if episodic_memories:
            memory_parts.append(f"### Past Interactions (Episodic)\n{episodic_memories}")
        if semantic_memories:
            memory_parts.append(f"### Known Facts & Preferences (Semantic)\n{semantic_memories}")
        if procedural_memories:
            memory_parts.append(f"### Learned Procedures\n{procedural_memories}")

        if memory_parts:
            context_sections.append("## Relevant Memories\n" + "\n\n".join(memory_parts))

        trusted_context = "\n\n".join(context_sections)

        return (
            f"{base_prompt}\n\n"
            f"--- BEGIN TRUSTED CONTEXT ---\n"
            f"{trusted_context}\n"
            f"--- END TRUSTED CONTEXT ---"
        )

    # ------------------------------------------------------------------
    # Message building
    # ------------------------------------------------------------------

    def _build_messages(self, archetype, task_data: dict) -> list[dict]:
        """Build the initial message list for the Claude call.

        Delegates to the archetype's build_messages if available, otherwise
        constructs a default user message from the task data.
        """
        if hasattr(archetype, "build_messages"):
            # Archetypes that implement build_messages get empty memories
            # since memories are now in the system prompt
            try:
                return archetype.build_messages(task_data, [])
            except Exception:
                pass

        # Default: serialize task_data as the user message
        # Remove internal keys that shouldn't be sent to the model
        display_data = {
            k: v for k, v in task_data.items()
            if k not in ("tenant_id", "task_id") and v is not None
        }

        if not display_data:
            return [{"role": "user", "content": "Please proceed with the task."}]

        # Format as readable text
        content_parts: list[str] = []
        for key, value in display_data.items():
            if isinstance(value, dict):
                content_parts.append(f"{key}: {json.dumps(value, default=str)}")
            elif isinstance(value, list):
                content_parts.append(f"{key}: {json.dumps(value, default=str)}")
            else:
                content_parts.append(f"{key}: {value}")

        return [{"role": "user", "content": "\n".join(content_parts)}]

    # ------------------------------------------------------------------
    # Token estimation
    # ------------------------------------------------------------------

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """Rough token estimate: ~4 characters per token."""
        if not text:
            return 0
        return len(text) // 4
