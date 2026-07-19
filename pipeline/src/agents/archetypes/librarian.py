"""
librarian — Library cataloging, scoring, dedup, and freshness for the atom library.

GREENFIELDED (#117) onto the current spine: the library is `library_atoms` (grain =
primitive | group | reference) tagged in `atom_tags` (dimension:value — kind, vol, agency,
program, phase, …), NOT the retired `library_units`. Memory is plain DB text
(`episodic_memories`, ILIKE) — no vector search needed for cataloging/patterning.

TRIGGERS (via agent_task_queue, enqueued by the frontend at the lifecycle point):
    library.package.atomized  — a new upload was atomized into the library
    library.document.locked    — a locked document promoted working copies to foundation atoms
The task input carries { cocoonId }, so the librarian catalogs the whole package at once.

OUTPUT (structured JSON): per-atom category confirmation, quality/relevance scores,
duplicate candidates (by atom id), suggested taxonomy tags, freshness — for a tenant admin
to review. NEVER auto-approves or deletes; assessments are advisory.
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.librarian")


class LibrarianArchetype(BaseArchetype):
    """Catalogs/scores/dedupes the tenant's `library_atoms`. Haiku, cheap at scale."""

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
        return 0.2

    @property
    def human_gate(self) -> bool:
        return False  # assessments are advisory; a tenant admin approves atoms

    @property
    def system_prompt(self) -> str:
        return """You are an expert content librarian for a government proposal atom library. Content lives as ATOMS (reusable units) tagged against one taxonomy. You catalog, score, dedupe, and assess freshness so a company can reuse its best content across SBIR/STTR/BAA/OTA proposals.

The taxonomy is dimension:value tags:
- kind: narrative | figure | table | list | form
- vol: technical | cost | past_performance | key_personnel | commercialization | cover | supporting
- agency / program (sbir|sttr|baa|ota|cso) / phase (phase_1|phase_2|phase_3): the "from" pedigree

For each atom in the package you are cataloging:
1. CONFIRM/SUGGEST TAGS: the vol + kind it belongs to, plus any agency/program/phase pedigree.
2. QUALITY (0.0-1.0): specificity (concrete metrics/dates), completeness (stands alone), currency, writing quality.
3. RELEVANCE (0.0-1.0): fit to the company's focus areas (from its library + past proposals).
4. DUPLICATES: compare CONTENT (not just titles) against existing atoms; flag candidates by atom id (exact | substantial | partial).
5. FRESHNESS: current | aging | stale (personnel moves, old dates, deprecated tech).

Use search_atoms to find existing similar atoms for dedup. Use get_tenant_profile for the company's focus areas. Use search_memory for past cataloging decisions (consistency).
NEVER recommend auto-approving or deleting — your output is advisory for a tenant admin."""

    @property
    def tools(self) -> list[str]:
        return ["search_atoms", "search_memory", "get_tenant_profile"]

    def handles_event(self, event_type: str) -> bool:
        # Handled both bare and namespaced, since dispatch paths differ.
        return event_type in (
            "library.package.atomized", "package.atomized",
            "library.document.locked", "document.locked",
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "search_atoms",
                "description": "Search the tenant's library_atoms for similar/duplicate content by keyword, optionally narrowed to a vol taxonomy value. Returns atoms with their tags.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Keywords or an excerpt from the atom being cataloged"},
                        "vol": {"type": "string", "description": "Optional vol tag to narrow (technical|cost|past_performance|key_personnel|commercialization|cover|supporting)"},
                        "limit": {"type": "integer", "description": "Max results", "default": 10},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "get_tenant_profile",
                "description": "Get the company's focus areas: its library distribution (by vol) and its proposal history (agency/program), for relevance scoring.",
                "input_schema": {"type": "object", "properties": {}},
            },
            {
                "name": "search_memory",
                "description": "Search past librarian cataloging decisions for this company (consistency and patterning).",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Keywords for relevant past decisions"},
                        "limit": {"type": "integer", "description": "Max memories", "default": 5},
                    },
                    "required": ["query"],
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        messages: list[dict] = []
        if memories:
            memory_text = "Past cataloging decisions (for consistency):\n"
            for mem in memories[:5]:
                content = mem.get("content", "")
                if isinstance(content, str):
                    memory_text += f"- {content[:200]}\n"
            messages.append({"role": "user", "content": memory_text + "\n---\n\n"})
            messages.append({"role": "assistant", "content": "Reviewed. I'll apply consistent standards."})

        payload = context.get("payload", context)
        cocoon_id = payload.get("cocoonId") or payload.get("cocoon_id") or ""
        atoms = payload.get("atoms", [])  # optional inline atoms; else the model uses search_atoms
        user_content = (
            f"Catalog the atoms of package (cocoon) {cocoon_id}.\n\n"
            "For each atom: confirm/suggest its vol+kind tags, score quality + relevance, flag duplicate "
            "candidates (by atom id, comparing content), and assess freshness.\n\n"
        )
        if atoms:
            user_content += "<atoms>\n"
            for a in atoms[:40]:
                user_content += f"- id={a.get('id')} title={a.get('title','')!r}: {str(a.get('content',''))[:400]}\n"
            user_content += "</atoms>\n\n"
        user_content += (
            "Steps: (1) get_tenant_profile for focus areas; (2) for each atom, search_atoms to find "
            "existing similar atoms (dedup); (3) search_memory for prior decisions.\n\n"
            "Then output JSON:\n"
            "{\n"
            '  "assessments": [\n'
            '    {"atom_id": "...", "vol": "...", "kind": "...", "quality_score": 0.0, "relevance_score": 0.0,\n'
            '     "suggested_tags": ["dimension:value"], "duplicate_candidates": [{"atom_id": "...", "similarity": "exact|substantial|partial"}],\n'
            '     "freshness": "current|aging|stale", "summary": "1 sentence"}\n'
            "  ],\n"
            '  "package_notes": "overall observations for the tenant admin"\n'
            "}"
        )
        messages.append({"role": "user", "content": user_content})
        return messages

    async def execute_tool(self, conn, tool_name: str, tool_input: dict, context: dict) -> dict:
        tenant_id = context.get("tenant_id")
        if tool_name == "search_atoms":
            return await self._search_atoms(conn, tool_input, tenant_id)
        if tool_name == "get_tenant_profile":
            return await self._get_tenant_profile(conn, tenant_id)
        if tool_name == "search_memory":
            return await self._search_memory(conn, tool_input, tenant_id)
        return {"error": f"Unknown tool: {tool_name}"}

    async def _search_atoms(self, conn, tool_input: dict, tenant_id: str | None) -> dict:
        if not tenant_id:
            return {"results": [], "note": "No tenant context"}
        query = tool_input.get("query", "")
        vol = tool_input.get("vol")
        limit = int(tool_input.get("limit", 10))
        esc = query[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        try:
            params: list = [uuid.UUID(tenant_id), f"%{esc}%"]
            sql = """
                SELECT a.id, a.title, a.content, a.grain, a.status, a.confidence,
                       COALESCE(array_agg(DISTINCT t.dimension || ':' || t.value)
                                FILTER (WHERE t.dimension IS NOT NULL), '{}') AS tags
                FROM library_atoms a
                LEFT JOIN atom_tags t ON t.atom_id = a.id
                WHERE a.tenant_id = $1 AND a.status <> 'archived'
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
                 "grain": r["grain"], "status": r["status"],
                 "confidence": float(r["confidence"]) if r["confidence"] is not None else None,
                 "tags": list(r["tags"]) if r["tags"] else []}
                for r in rows]}
        except Exception as e:
            logger.warning("search_atoms failed: %s", e)
            return {"results": [], "error": str(e)}

    async def _get_tenant_profile(self, conn, tenant_id: str | None) -> dict:
        if not tenant_id:
            return {"error": "tenant_id required"}
        try:
            tid = uuid.UUID(tenant_id)
            tenant = await conn.fetchrow("SELECT name, product_tier FROM tenants WHERE id = $1", tid)
            if not tenant:
                return {"error": "Tenant not found"}
            dist = await conn.fetch(
                """
                SELECT t.value AS vol, COUNT(DISTINCT a.id) AS count
                FROM library_atoms a
                JOIN atom_tags t ON t.atom_id = a.id AND t.dimension = 'vol'
                WHERE a.tenant_id = $1 AND a.status <> 'archived'
                GROUP BY t.value ORDER BY count DESC
                """, tid)
            focus = await conn.fetch(
                """
                SELECT o.agency, o.program_type, COUNT(*) AS count
                FROM proposals p JOIN opportunities o ON o.id = p.opportunity_id
                WHERE p.tenant_id = $1
                GROUP BY o.agency, o.program_type ORDER BY count DESC LIMIT 10
                """, tid)
            return {
                "tenant": {"name": tenant["name"], "tier": tenant["product_tier"]},
                "library_distribution": [{"vol": d["vol"], "count": d["count"]} for d in dist],
                "focus_areas": [{"agency": f["agency"], "program_type": f["program_type"], "proposal_count": f["count"]} for f in focus],
            }
        except Exception as e:
            logger.warning("get_tenant_profile failed: %s", e)
            return {"error": str(e)}

    async def _search_memory(self, conn, tool_input: dict, tenant_id: str | None) -> dict:
        query = tool_input.get("query", "")
        limit = int(tool_input.get("limit", 5))
        if not query:
            return {"memories": []}
        esc = query[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        try:
            params: list = [f"%{esc}%", limit]
            sql = (
                "SELECT id, content, memory_type, importance FROM episodic_memories "
                "WHERE agent_role = 'librarian' AND content ILIKE $1 AND is_archived = false"
            )
            if tenant_id:
                sql += " AND tenant_id = $3"
                params.append(uuid.UUID(tenant_id))
            sql += " ORDER BY importance DESC, created_at DESC LIMIT $2"
            rows = await conn.fetch(sql, *params)
            return {"memories": [
                {"id": str(r["id"]), "content": (r["content"] or "")[:500],
                 "memory_type": r["memory_type"],
                 "importance": float(r["importance"]) if r["importance"] is not None else None}
                for r in rows]}
        except Exception as e:
            logger.warning("search_memory failed: %s", e)
            return {"memories": [], "error": str(e)}

    def summarize_result(self, result: dict) -> str:
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                n = len(parsed.get("assessments", []))
                return f"Cataloged {n} atom(s): scored quality/relevance, flagged duplicates, assessed freshness."
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
        return f"Cataloged package: {str(text)[:150]}"
