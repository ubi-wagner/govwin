"""
================================================================================
Partner Coordinator -- Partner/Subcontractor Communication and Coordination
================================================================================

ROLE:       Manages partner and subcontractor communications and coordination.
            Drafts outreach messages, tracks commitments and deliverables,
            flags risks (missing LOIs, uncommitted personnel, scope gaps),
            and provides status reports.

LAYER:      Proposal Agent
            - Proposal: per-proposal scoped, ephemeral

TRIGGERS:   proposal.partner.added (new partner/collaborator invited)
            proposal.partner.communication_requested (outreach needed)
            capture.collaborator.invited (collaborator invitation)
            capture.proposal.stage_changed (stage transition notifications)

INPUTS:     - Current proposal state and sections
            - Partner-relevant compliance requirements (sub limits, etc.)
            - Past partner interaction history from memory
            - Partner deliverable status

OUTPUTS:    - Communication drafts (welcome, reminders, deadline nudges)
            - Partner status report
            - Commitment tracking
            - Risk flags (overdue deliverables, missing items)
            - Next action recommendations

TOOLS:      - proposal.get_sections: current proposal state
            - proposal.get_compliance: partner-relevant requirements
            - memory.search: past partner interactions

MODEL:      claude-haiku-4-5-20251001
            Budget: 2048 output, 3K-8K input

HUMAN GATE: YES -- all external communications require human approval
            Drafted messages are queued for tenant admin review before
            sending. Status reports are advisory.

GUARDRAILS:
            - Communications must be professional and clear
            - Never send communications without human review
            - Track all commitments with deadlines
            - NEVER share proprietary proposal content with partners beyond their scope
            - NEVER commit to terms on behalf of the tenant

MEMORY:     Categories: partner_interactions, delivery_patterns, escalations
            Writes: partner communication history, delivery tracking
            Reads: past partner reliability, communication preferences

INSTANCES:
            - Admin Pipeline: N/A
            - Customer Portal: activated when partners are added or communications needed

COST:       $0.05/call, ~10x per proposal = $0.50/proposal

EVENT EMISSIONS:
            - tool:agent.partner_coordinator.start (start)
            - tool:agent.partner_coordinator.end (end)
            - proposal.partner.communication_drafted (domain event)

CHANGE LOG:
    PR #140 (2026-05-22) -- Empty stub
    PR #xxx (2026-05-22) -- Full implementation with tools, prompts, events
================================================================================
"""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.partner_coordinator")


class PartnerCoordinatorArchetype(BaseArchetype):
    """Government contracting partner coordination specialist.

    Handles: proposal.partner.added, proposal.partner.communication_requested
    Drafts professional communications to subcontractors and teaming partners.
    Tracks commitments, deliverables, and deadlines. Flags risks including
    missing LOIs, uncommitted personnel, and scope gaps.
    """

    @property
    def role_name(self) -> str:
        return "partner_coordinator"

    @property
    def model(self) -> str:
        return "claude-haiku-4-5-20251001"

    @property
    def max_tokens(self) -> int:
        return 2048

    @property
    def temperature(self) -> float:
        return 0.3  # Professional but natural communication tone

    @property
    def human_gate(self) -> bool:
        return True  # All external communications need review

    @property
    def system_prompt(self) -> str:
        return """You are a government contracting partner coordination specialist with extensive experience managing subcontractor and teaming partner relationships on federal proposals (SBIR, STTR, BAA, OTA).

Your responsibilities:
1. COMMUNICATION DRAFTING: Write professional, clear messages to partners including:
   - Welcome/onboarding messages for new partners
   - Deliverable requests with clear deadlines and format requirements
   - Gentle but firm deadline reminders (3-day, 1-day, overdue nudges)
   - Stage transition notifications (e.g., "We're entering Red Team review")
   - Clarification requests for incomplete submissions

2. COMMITMENT TRACKING: Monitor and report on:
   - Letters of Intent (LOI) status
   - Personnel commitments (bios, resumes, availability confirmations)
   - Technical content deliverables (past performance, capability descriptions)
   - Subcontract scope and pricing inputs
   - Teaming agreement status

3. RISK FLAGGING: Identify and escalate:
   - Overdue deliverables (especially critical path items)
   - Missing LOIs as submission deadline approaches
   - Uncommitted key personnel
   - Scope gaps between prime and sub requirements
   - Partner responsiveness concerns

4. STATUS REPORTING: Provide clear partner status summaries for the proposal team

Communication tone guidelines:
- Professional but warm — partners are valued team members
- Specific about what is needed and when
- Include context about why the deliverable matters
- Avoid being threatening or punitive — escalate through the proposal manager
- Always include clear next steps and point of contact

Use get_sections to understand the current proposal state and partner-assigned sections.
Use get_compliance to check partner-relevant requirements (sub plan limits, LOI requirements).
Use search_memory to review past interactions with this partner."""

    @property
    def tools(self) -> list[str]:
        return ["get_sections", "get_compliance", "search_memory"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "proposal.partner.added",
            "proposal.partner.communication_requested",
            "capture.collaborator.invited",
            "capture.proposal.stage_changed",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "get_sections",
                "description": (
                    "Get current proposal sections to understand what "
                    "partner deliverables are needed and what has been "
                    "received. Shows section status and assignments."
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
                    "Get compliance requirements relevant to partners "
                    "including subcontracting plan limits, LOI requirements, "
                    "and formatting rules for partner deliverables."
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
                    "Search agent memory for past interactions with this "
                    "partner, delivery patterns, and communication history "
                    "to inform tone and urgency."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for partner-related memories",
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

        # Add memory context (past partner interactions)
        if memories:
            memory_text = "Past partner interaction history:\n"
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
                    "I've reviewed the partner interaction history. "
                    "I'll tailor my communication approach accordingly."
                ),
            })

        # Main coordination request
        payload = context.get("payload", context)
        tenant_id = context.get("tenant_id", "")
        proposal_id = payload.get("proposal_id", "")
        action = payload.get("action", "status_report")
        partner = payload.get("partner", {})
        stage = payload.get("stage", "")
        deadline = payload.get("deadline", "")

        partner_name = partner.get("name", "Partner")
        partner_email = partner.get("email", "")
        partner_role = partner.get("role", "subcontractor")
        assigned_sections = partner.get("assigned_sections", [])
        deliverables = partner.get("deliverables", [])

        user_content = (
            f"Partner coordination for proposal {proposal_id}, "
            f"tenant {tenant_id}.\n"
            f"Action requested: {action}\n\n"
        )

        user_content += f"""<partner_info>
Name: {partner_name}
Email: {partner_email}
Role: {partner_role}
Assigned Sections: {', '.join(str(s) for s in assigned_sections) if assigned_sections else 'None assigned'}
Current Stage: {stage}
Submission Deadline: {deadline or 'Not specified'}
</partner_info>

"""

        if deliverables:
            user_content += "<deliverables>\n"
            for d in deliverables:
                d_name = d.get("name", "")
                d_status = d.get("status", "pending")
                d_due = d.get("due_date", "")
                user_content += (
                    f"- {d_name}: status={d_status}, due={d_due}\n"
                )
            user_content += "</deliverables>\n\n"

        action_instructions = {
            "welcome": (
                "Draft a welcome/onboarding message for this new partner. "
                "Include: what the proposal is about, their role, what "
                "deliverables are needed, timeline, and next steps."
            ),
            "reminder": (
                "Draft a deadline reminder for outstanding deliverables. "
                "Be specific about what is needed and when. Adjust urgency "
                "based on how close the deadline is."
            ),
            "stage_notification": (
                "Draft a stage transition notification. Inform the partner "
                "about the proposal's new stage and any implications for "
                "their deliverables."
            ),
            "status_report": (
                "Compile a partner status report. Track all commitments, "
                "flag any risks, and recommend next actions."
            ),
            "escalation": (
                "Draft an escalation message for significantly overdue "
                "deliverables. Maintain professionalism while conveying "
                "urgency and potential impact."
            ),
        }

        instruction = action_instructions.get(action, action_instructions["status_report"])
        user_content += f"{instruction}\n\n"

        user_content += """Steps:
1. Use get_sections to understand the current proposal state and partner-assigned sections
2. Use get_compliance to check any partner-relevant requirements
3. Use search_memory to review past interactions with this partner

Then provide your output as JSON:
{
  "communication_draft": {
    "subject": "email subject line",
    "body": "full message text",
    "tone": "warm | professional | urgent",
    "requires_human_review": true
  },
  "partner_status": {
    "overall": "on_track | at_risk | overdue | blocked",
    "deliverables_received": N,
    "deliverables_pending": N,
    "deliverables_overdue": N
  },
  "commitments_tracked": [
    {"item": "description", "status": "received | pending | overdue", "due_date": "date", "notes": "any context"}
  ],
  "risk_flags": [
    {"risk": "description", "severity": "low | medium | high | critical", "mitigation": "suggested action"}
  ],
  "next_actions": [
    {"action": "description", "owner": "prime | partner", "due_date": "date"}
  ]
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
        """Fetch proposal sections with assignment info."""
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

            sections = await conn.fetch(
                """
                SELECT id, section_number, title, status,
                       assigned_to, page_allocation
                FROM proposal_sections
                WHERE proposal_id = $1
                ORDER BY section_number ASC
                """,
                uuid.UUID(proposal_id),
            )

            # Get collaborators with their assigned sections
            collaborators = await conn.fetch(
                """
                SELECT pc.id, u.name, u.email, pc.role,
                       pc.assigned_sections, pc.dropbox_enabled
                FROM proposal_collaborators pc
                JOIN users u ON u.id = pc.user_id
                WHERE pc.proposal_id = $1
                """,
                uuid.UUID(proposal_id),
            )

            return {
                "sections": [
                    {
                        "id": str(s["id"]),
                        "section_number": s["section_number"],
                        "title": s["title"],
                        "status": s["status"],
                        "assigned_to": str(s["assigned_to"]) if s["assigned_to"] else None,
                        "page_allocation": s["page_allocation"],
                    }
                    for s in sections
                ],
                "collaborators": [
                    {
                        "id": str(c["id"]),
                        "name": c["name"],
                        "email": c["email"],
                        "role": c["role"],
                        "assigned_sections": c["assigned_sections"] or [],
                        "dropbox_enabled": c["dropbox_enabled"],
                    }
                    for c in collaborators
                ],
            }
        except Exception as e:
            logger.warning("get_sections failed: %s", e)
            return {"error": str(e)}

    async def _get_compliance(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Get partner-relevant compliance requirements."""
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

            # Get compliance variables relevant to partners
            variables = await conn.fetch(
                """
                SELECT id, variable_name, variable_type, value
                FROM solicitation_compliance
                WHERE solicitation_id = $1
                  AND (
                    variable_name ILIKE '%partner%'
                    OR variable_name ILIKE '%sub%'
                    OR variable_name ILIKE '%team%'
                    OR variable_name ILIKE '%loi%'
                    OR variable_name ILIKE '%letter%'
                    OR variable_name ILIKE '%collaborat%'
                  )
                ORDER BY variable_name ASC
                """,
                sol_id,
            )

            return {
                "partner_requirements": [
                    {
                        "id": str(v["id"]),
                        "variable_name": v["variable_name"],
                        "variable_type": v["variable_type"],
                        "value": v["value"],
                    }
                    for v in variables
                ],
            }
        except Exception as e:
            logger.warning("get_compliance failed: %s", e)
            return {"error": str(e)}

    async def _search_memory(
        self, conn, tool_input: dict, tenant_id: str | None
    ) -> dict:
        """Search agent memory for partner interaction history."""
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
                WHERE agent_role = 'partner_coordinator'
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
        """Summarize the partner coordination for memory storage."""
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                status = parsed.get("partner_status", {})
                overall = status.get("overall", "unknown")
                risks = parsed.get("risk_flags", [])
                high_risks = sum(
                    1
                    for r in risks
                    if r.get("severity") in ("high", "critical")
                )
                comm = parsed.get("communication_draft", {})
                subject = comm.get("subject", "")
                return (
                    f"Partner coordination: status={overall}, "
                    f"{high_risks} high/critical risks. "
                    f"Draft: {subject[:80]}"
                )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

        return f"Partner coordination completed: {text[:150]}"
