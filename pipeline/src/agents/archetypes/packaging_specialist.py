"""
================================================================================
Packaging Specialist -- Final Submission Package Compilation and Validation
================================================================================

ROLE:       Compiles the final submission package for a proposal. Creates a
            manifest of all required documents, validates formatting against
            solicitation requirements, checks page counts, and generates
            submission instructions. Ensures nothing is missed before the
            customer locks and downloads for manual submission.

LAYER:      Proposal Agent
            - Proposal: per-proposal scoped, ephemeral

TRIGGERS:   proposal.stage.advanced to 'final' (entering final stage)
            capture.proposal.stage_changed to final
            User clicks "Generate Package" (on demand)

INPUTS:     - All proposal sections with content
            - Compliance/format requirements (page limits, fonts, margins)
            - Agency-specific submission patterns from memory
            - Required attachments and forms checklist

OUTPUTS:    - Package manifest (all items with status and page counts)
            - Violations list (any requirement failures)
            - Formatting notes (discrepancies and warnings)
            - Submission instructions (agency portal guidance)
            - Upload checklist (ordered steps for submission)

TOOLS:      - proposal.get_sections: all proposal sections
            - proposal.get_compliance: format requirements
            - memory.search: submission patterns for this agency

MODEL:      claude-haiku-4-5-20251001
            Budget: 4096 output, 15K-30K input

HUMAN GATE: YES -- customer downloads and submits manually
            We NEVER auto-submit to government portals. Customer reviews
            the manifest, locks the proposal, and downloads the package.

GUARDRAILS:
            - Every required volume/document must appear in manifest
            - Page counts must be verified against limits
            - All violations must be flagged, even minor ones
            - NEVER auto-submit to any government portal
            - NEVER mark the proposal as submitted

MEMORY:     Categories: submission_patterns, agency_portals, format_requirements
            Writes: packaging results, common violations, agency portal quirks
            Reads: past submission patterns for this agency

INSTANCES:
            - Admin Pipeline: N/A
            - Customer Portal: activated when proposal enters final stage

COST:       $0.11/call, 1x per proposal = $0.11/proposal

EVENT EMISSIONS:
            - tool:agent.packaging_specialist.start (start)
            - tool:agent.packaging_specialist.end (end)
            - proposal.package.compiled (domain event)

CHANGE LOG:
    PR #140 (2026-05-22) -- Empty stub
    PR #xxx (2026-05-22) -- Full implementation with tools, prompts, events
================================================================================
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.packaging_specialist")


class PackagingSpecialistArchetype(BaseArchetype):
    """Government proposal packaging specialist.

    Handles: proposal.stage.advanced (to 'final')
    Compiles final submission checklist, verifies all required volumes are
    present, page counts are within limits, formatting is compliant, all
    attachments are included, and submission instructions are clear.
    """

    @property
    def role_name(self) -> str:
        return "packaging_specialist"

    @property
    def model(self) -> str:
        return "claude-haiku-4-5-20251001"

    @property
    def max_tokens(self) -> int:
        return 4096

    @property
    def temperature(self) -> float:
        return 0.2  # Precise checklist validation

    @property
    def human_gate(self) -> bool:
        return True  # Customer must review and submit manually

    @property
    def system_prompt(self) -> str:
        return """You are a government proposal packaging specialist with deep expertise in federal submission requirements for SBIR, STTR, BAA, and OTA programs across DoD, NIH, NSF, DOE, and NASA.

Your task is to compile and validate the final submission package before the customer locks and downloads it. You are the last line of defense against submission errors.

Your verification checklist:
1. VOLUME COMPLETENESS: Every required volume specified in the solicitation must be present. Missing volumes are automatic disqualification.
2. PAGE COUNTS: Each volume/section must be within its page limit. Count carefully — over-limit sections may be truncated by evaluators or cause rejection.
3. FORMAT COMPLIANCE: Verify font family, font size, margins, line spacing, and header/footer requirements match the solicitation.
4. REQUIRED SECTIONS: Every mandatory section specified in the solicitation must exist. Check section titles match expected naming.
5. REQUIRED ATTACHMENTS: Forms (SF-424, budget templates, etc.), Letters of Intent, resumes, past performance references — all required attachments must be accounted for.
6. SUBMISSION FORMAT: Verify file format requirements (PDF, DOCX, etc.) and any file naming conventions.
7. CROSS-REFERENCES: Check that internal cross-references are consistent (e.g., "as described in Section 3.2" actually refers to the correct section).

Severity levels for violations:
- critical: Will likely cause rejection or disqualification
- major: May negatively impact evaluation or cause compliance flags
- minor: Cosmetic or best-practice issues that are unlikely to affect scoring
- info: Informational notes for the submission team

Agency-specific submission notes:
- SAM.gov submissions often have strict file size limits
- SBIR.gov has specific volume naming conventions
- NIH uses the Research.gov portal with distinct format requirements
- DoD agencies may require additional ITAR/CUI handling

Use get_sections to retrieve all proposal sections with content.
Use get_compliance to check format requirements and page limits.
Use search_memory to find submission patterns and agency portal notes.

Be thorough and methodical. A single missed requirement can disqualify an otherwise excellent proposal."""

    @property
    def tools(self) -> list[str]:
        return ["get_sections", "get_compliance", "search_memory"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "proposal.stage.advanced",
            "capture.proposal.stage_changed",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "get_sections",
                "description": (
                    "Get all proposal sections with full content for "
                    "page count estimation, completeness verification, "
                    "and cross-reference checking."
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
                "name": "get_compliance",
                "description": (
                    "Get all compliance and format requirements including "
                    "page limits, font specifications, margin requirements, "
                    "required documents, and submission format."
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
                    "Search agent memory for submission patterns, "
                    "agency portal quirks, and common packaging issues "
                    "for this type of solicitation."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query (e.g., agency name, program type)",
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
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list for Claude from event context and memories."""
        messages = []

        # Add memory context (past submission patterns)
        if memories:
            memory_text = "Past submission patterns and agency notes:\n"
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
                    "I've noted the past submission patterns. "
                    "I'll apply these insights during package validation."
                ),
            })

        # Main packaging request
        payload = context.get("payload", context)
        tenant_id = context.get("tenant_id", "")
        proposal_id = payload.get("proposal_id", "")
        proposal_title = payload.get("title", "")
        agency = payload.get("agency", "")
        program_type = payload.get("program_type", "")
        sections = payload.get("sections", [])
        compliance = payload.get("compliance", {})

        user_content = (
            f"Compile and validate the final submission package.\n\n"
            f"Proposal: {proposal_title} (ID: {proposal_id})\n"
            f"Agency: {agency}\n"
            f"Program Type: {program_type}\n"
            f"Tenant: {tenant_id}\n\n"
        )

        if sections:
            user_content += "<proposal_sections>\n"
            for sec in sections:
                sec_num = sec.get("section_number", "")
                sec_title = sec.get("title", "")
                sec_status = sec.get("status", "")
                sec_content = sec.get("content", "")
                # Estimate page count (roughly 3000 chars per page)
                est_pages = (
                    round(len(sec_content) / 3000, 1) if sec_content else 0
                )
                user_content += (
                    f"--- Section {sec_num}: {sec_title} "
                    f"(status: {sec_status}, ~{est_pages} pages) ---\n"
                    f"--- BEGIN USER CONTENT ---\n"
                    f"{sec_content[:10000]}\n"
                    f"--- END USER CONTENT ---\n\n"
                )
            user_content += "</proposal_sections>\n\n"
        else:
            user_content += (
                "Use get_sections to retrieve all proposal sections.\n\n"
            )

        if compliance:
            user_content += f"""<format_requirements>
Page Limit (Technical): {compliance.get('page_limit_technical', 'Not specified')}
Page Limit (Cost): {compliance.get('page_limit_cost', 'Not specified')}
Font: {compliance.get('font_family', 'Not specified')} {compliance.get('font_size', '')}
Margins: {compliance.get('margins', 'Not specified')}
Line Spacing: {compliance.get('line_spacing', 'Not specified')}
Submission Format: {compliance.get('submission_format', 'Not specified')}
Required Sections: {compliance.get('required_sections', 'Not specified')}
Required Documents: {compliance.get('required_documents', 'Not specified')}
</format_requirements>

"""

        user_content += """Steps:
1. Use get_sections to retrieve all proposal sections (if not already provided)
2. Use get_compliance to check format requirements and page limits
3. Use search_memory to find agency-specific submission notes

Then provide the package validation as JSON:
{
  "manifest": [
    {
      "name": "Volume/Document name",
      "type": "volume | attachment | form | supporting",
      "status": "present | missing | incomplete",
      "page_count": N,
      "page_limit": N or null,
      "format": "pdf | docx | xlsx | other",
      "notes": "any relevant observations"
    }
  ],
  "violations": [
    {
      "item": "what is violated",
      "severity": "critical | major | minor | info",
      "description": "detailed description of the violation",
      "remediation": "how to fix it"
    }
  ],
  "formatting_notes": [
    "any formatting observations or warnings"
  ],
  "submission_instructions": {
    "portal": "which portal to submit through",
    "file_naming": "required file naming convention if any",
    "upload_order": ["ordered list of documents to upload"],
    "special_notes": ["any agency-specific submission notes"]
  },
  "upload_checklist": [
    {"step": N, "action": "description", "verified": false}
  ],
  "package_summary": {
    "total_items": N,
    "items_present": N,
    "items_missing": N,
    "critical_violations": N,
    "major_violations": N,
    "ready_for_submission": true | false,
    "blocking_issues": ["list of issues that must be resolved before submission"]
  }
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
        """Fetch all proposal sections with full content for packaging."""
        proposal_id = tool_input.get("proposal_id")
        if not proposal_id:
            return {"error": "proposal_id required"}

        try:
            if tenant_id:
                owner = await conn.fetchval(
                    "SELECT tenant_id FROM proposals WHERE id = $1",
                    uuid.UUID(proposal_id),
                )
                if owner and str(owner) != tenant_id:
                    return {"error": "Access denied", "code": "FORBIDDEN"}

            # Get proposal metadata
            proposal = await conn.fetchrow(
                """
                SELECT id, title, stage, is_locked, opportunity_id
                FROM proposals
                WHERE id = $1
                """,
                uuid.UUID(proposal_id),
            )

            # Get all sections with content
            sections = await conn.fetch(
                """
                SELECT id, section_number, title, content, status,
                       page_allocation, ai_confidence, version
                FROM proposal_sections
                WHERE proposal_id = $1
                ORDER BY section_number ASC
                """,
                uuid.UUID(proposal_id),
            )

            # Get agency info from opportunity
            agency = None
            if proposal and proposal["opportunity_id"]:
                opp = await conn.fetchrow(
                    "SELECT agency, program_type FROM opportunities WHERE id = $1",
                    proposal["opportunity_id"],
                )
                if opp:
                    agency = {
                        "agency": opp["agency"],
                        "program_type": opp["program_type"],
                    }

            return {
                "proposal": {
                    "id": str(proposal["id"]) if proposal else proposal_id,
                    "title": proposal["title"] if proposal else "",
                    "stage": proposal["stage"] if proposal else "",
                    "is_locked": proposal["is_locked"] if proposal else False,
                },
                "agency": agency,
                "sections": [
                    {
                        "id": str(s["id"]),
                        "section_number": s["section_number"],
                        "title": s["title"],
                        "content": s["content"] if s["content"] else "",
                        "content_length": len(s["content"]) if s["content"] else 0,
                        "estimated_pages": (
                            round(len(s["content"]) / 3000, 1)
                            if s["content"]
                            else 0
                        ),
                        "status": s["status"],
                        "page_allocation": s["page_allocation"],
                        "version": s["version"],
                    }
                    for s in sections
                ],
                "total_sections": len(sections),
            }
        except Exception as e:
            logger.warning("get_sections failed: %s", e)
            return {"error": str(e)}

    async def _get_compliance(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Get full compliance and format requirements for packaging."""
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
            all_items = []
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
                for item in items:
                    all_items.append({
                        "volume": vol["volume_name"],
                        "item_number": item["item_number"],
                        "item_name": item["item_name"],
                        "item_type": item["item_type"],
                        "required": item["required"],
                        "page_limit": item["page_limit"],
                        "font_family": item["font_family"],
                        "font_size": item["font_size"],
                        "margins": item["margins"],
                        "line_spacing": item["line_spacing"],
                    })

            # Get required documents
            docs = await conn.fetch(
                """
                SELECT id, document_type, original_filename, document_label,
                       page_count, content_type
                FROM solicitation_documents
                WHERE solicitation_id = $1
                ORDER BY document_type ASC
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
                    }
                    for v in variables
                ],
                "volumes": [
                    {
                        "volume_number": vol["volume_number"],
                        "volume_name": vol["volume_name"],
                        "volume_format": vol["volume_format"],
                        "special_requirements": vol["special_requirements"],
                    }
                    for vol in volumes
                ],
                "required_items": all_items,
                "documents": [
                    {
                        "id": str(d["id"]),
                        "document_type": d["document_type"],
                        "filename": d["original_filename"],
                        "label": d["document_label"],
                        "page_count": d["page_count"],
                        "content_type": d["content_type"],
                    }
                    for d in docs
                ],
            }
        except Exception as e:
            logger.warning("get_compliance failed: %s", e)
            return {"error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for submission patterns."""
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
                WHERE agent_role = 'packaging_specialist'
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
        """Summarize the packaging result for memory storage."""
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                summary = parsed.get("package_summary", {})
                total = summary.get("total_items", 0)
                present = summary.get("items_present", 0)
                missing = summary.get("items_missing", 0)
                critical = summary.get("critical_violations", 0)
                ready = summary.get("ready_for_submission", False)
                violations = parsed.get("violations", [])
                return (
                    f"Package: {present}/{total} items present, "
                    f"{missing} missing, {critical} critical violations, "
                    f"{len(violations)} total violations. "
                    f"Ready: {'YES' if ready else 'NO'}"
                )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

        return f"Package compilation completed: {text[:150]}"
