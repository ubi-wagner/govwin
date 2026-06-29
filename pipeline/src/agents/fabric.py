"""
================================================================================
AgentFabric — Central Orchestrator for AI Agent Workforce
================================================================================

WHO:    Called by workflow processor (AI_INVOKE steps), pipeline workers,
        and frontend API routes (via agent_task_queue polling).

WHAT:   Routes events/tasks to the correct agent archetype, assembles context
        (tenant profile + memories + task data), executes Claude API calls with
        tool-use loops, tracks token usage and costs, enforces rate limits and
        budgets, and emits events at every stage.

WHY:    Agents are stateless functions — the fabric provides the stateful
        infrastructure (memory retrieval, tool execution, cost tracking) that
        makes each invocation feel continuous and specialized per tenant.

HOW:    1. Receive event or dequeue from agent_task_queue
        2. Match to archetype (or use explicit archetype_name)
        3. Check rate limits (50 calls/hour/tenant) and budget ($50/month default)
        4. Assemble context via ContextAssembler
        5. Call Claude with tool-use loop (max 20 rounds)
        6. Process response, execute tool calls via ToolRegistry
        7. Store episodic memory of interaction
        8. Log to agent_task_log (tokens, cost, duration)
        9. Emit system_events (tool.agent.invoked start/end)
        10. Return structured result

GUARDRAILS:
    - Agents NEVER: submit proposals, grant/revoke access, delete content,
      communicate externally, override humans
    - Agents MAY autonomously: draft sections, score opportunities, flag
      compliance, suggest content, send internal notifications
    - Agents RECOMMEND but human decides: pursuit decisions, win themes,
      partner selection, stage advancement, final approval

COST MODEL (Sonnet pricing):
    - Per-call: $0.06-$0.17 depending on archetype
    - Per-proposal: $4.50-$12.50 depending on complexity
    - Per-tenant/month: $3.55-$17.55 depending on usage
    - AI is <2% COGS at $199/month subscription

CHANGE LOG:
    PR #140 (2026-05-22) — Initial stub: basic invoke + single-turn response
    PR #xxx (2026-05-22) — Full implementation: rate limits, budgets, tool-use
                           loop, event emission, task queue processing, cost
                           tracking, multi-round conversations
================================================================================
"""

import json
import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import anthropic

from .archetypes import (
    CaptureStrategistArchetype,
    ColorTeamReviewerArchetype,
    ComplianceReviewerArchetype,
    LibrarianArchetype,
    OpportunityAnalystArchetype,
    PackagingSpecialistArchetype,
    PartnerCoordinatorArchetype,
    ProposalArchitectArchetype,
    ScoringStrategistArchetype,
    SectionDrafterArchetype,
)
from .context import ContextAssembler
from .memory import MemoryStore
from .tools import ToolRegistry, create_default_registry

# All archetype classes to auto-register on fabric init
_ARCHETYPE_CLASSES = [
    CaptureStrategistArchetype,
    ColorTeamReviewerArchetype,
    ComplianceReviewerArchetype,
    LibrarianArchetype,
    OpportunityAnalystArchetype,
    PackagingSpecialistArchetype,
    PartnerCoordinatorArchetype,
    ProposalArchitectArchetype,
    ScoringStrategistArchetype,
    SectionDrafterArchetype,
]

logger = logging.getLogger("pipeline.agents")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_TOOL_ROUNDS = 20
RATE_LIMIT_PER_HOUR = 50
DEFAULT_MONTHLY_BUDGET_USD = 50.00
PER_CALL_CEILING_USD = 0.50  # mid-loop cost ceiling for a single invocation
DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_MAX_TOKENS = 4096

# Sonnet pricing: $3/M input, $15/M output (kept for backwards-compat).
INPUT_COST_PER_TOKEN = 3.0 / 1_000_000
OUTPUT_COST_PER_TOKEN = 15.0 / 1_000_000

# Per-model pricing in USD per 1M tokens (input, output). Keep in sync
# with frontend/lib/ai/agent-guard.ts::MODEL_PRICING and the admin usage
# dashboard (frontend/app/api/admin/agents/usage/route.ts). Costing per
# model matters because Haiku archetypes are 3x cheaper than Sonnet —
# billing them all at Sonnet rates overstates spend and trips the budget
# guard too early.
MODEL_PRICING = {
    "claude-sonnet-4-20250514": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
}
# Fallback for an unknown model id — Sonnet (the fabric default), so an
# unrecognised model is costed conservatively, never as free.
_DEFAULT_PRICING = (3.0, 15.0)


def _cost_for(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return the USD cost of a call, priced per-model."""
    in_rate, out_rate = MODEL_PRICING.get(model, _DEFAULT_PRICING)
    return input_tokens * in_rate / 1_000_000 + output_tokens * out_rate / 1_000_000


class AgentFabric:
    """Routes events to agent archetypes, manages context assembly and execution.

    The fabric is the central orchestrator: it owns the Anthropic client,
    memory store, context assembler, and tool registry. Agent archetypes are
    stateless — the fabric injects all state through context assembly.
    """

    def __init__(self):
        self.client = None
        self.memory = MemoryStore()
        self.context_assembler = ContextAssembler()
        self.tool_registry = create_default_registry()
        self._archetypes: dict[str, object] = {}
        self._register_all_archetypes()

    def _register_all_archetypes(self) -> None:
        """Instantiate and register all known agent archetypes."""
        for archetype_cls in _ARCHETYPE_CLASSES:
            try:
                instance = archetype_cls()
                self.register_archetype(instance.role_name, instance)
            except Exception as exc:
                logger.error(
                    "Failed to register archetype %s: %s",
                    archetype_cls.__name__, exc,
                )

    # ------------------------------------------------------------------
    # Lazy client initialisation
    # ------------------------------------------------------------------

    def _get_client(self) -> anthropic.AsyncAnthropic:
        """Return (and lazily create) the Anthropic async client."""
        if not self.client:
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY not set")
            self.client = anthropic.AsyncAnthropic(api_key=api_key)
        return self.client

    # ------------------------------------------------------------------
    # Archetype management
    # ------------------------------------------------------------------

    def register_archetype(self, name: str, archetype) -> None:
        """Register an archetype instance by name."""
        self._archetypes[name] = archetype
        logger.info("registered archetype: %s", name)

    # ------------------------------------------------------------------
    # Event routing
    # ------------------------------------------------------------------

    async def handle_event(self, conn, event: dict) -> dict:
        """Route an event to the appropriate agent archetype.

        Iterates over registered archetypes and delegates to the first one
        whose ``handles_event`` returns True. Emits dispatch start/end events
        for observability.
        """
        event_type = event.get("type", "")
        tenant_id = event.get("tenant_id")

        # Emit dispatch start
        start_event_id = await self._emit_event(
            conn,
            namespace="tool",
            event_type="agent.dispatch",
            phase="start",
            tenant_id=tenant_id,
            payload={"event_type": event_type},
        )

        try:
            for name, archetype in self._archetypes.items():
                if archetype.handles_event(event_type):
                    result = await self.invoke_agent(
                        conn, name, event, tenant_id=tenant_id,
                    )
                    # Emit dispatch end — success
                    await self._emit_event(
                        conn,
                        namespace="tool",
                        event_type="agent.dispatch",
                        phase="end",
                        tenant_id=tenant_id,
                        payload={
                            "event_type": event_type,
                            "archetype": name,
                            "status": result.get("status", "unknown"),
                        },
                        parent_event_id=start_event_id,
                    )
                    return result

            # No matching archetype
            await self._emit_event(
                conn,
                namespace="tool",
                event_type="agent.dispatch",
                phase="end",
                tenant_id=tenant_id,
                payload={
                    "event_type": event_type,
                    "status": "no_handler",
                },
                parent_event_id=start_event_id,
            )
            return {"status": "no_handler", "event_type": event_type}

        except Exception as exc:
            logger.error("[handle_event] dispatch failed for %s: %s", event_type, exc)
            await self._emit_event(
                conn,
                namespace="tool",
                event_type="agent.dispatch",
                phase="end",
                tenant_id=tenant_id,
                payload={
                    "event_type": event_type,
                    "status": "error",
                    "error": str(exc)[:500],
                },
                parent_event_id=start_event_id,
            )
            return {"status": "error", "event_type": event_type, "error": str(exc)}

    # ------------------------------------------------------------------
    # Core invocation
    # ------------------------------------------------------------------

    async def invoke_agent(
        self,
        conn,
        archetype_name: str,
        context: dict,
        tenant_id: str | None = None,
    ) -> dict:
        """Invoke a specific agent archetype with full orchestration.

        Steps:
            1. Emit tool:agent.invoked start event
            2. Check rate limit (50 calls/hour/tenant)
            3. Check monthly budget
            4. Assemble context via ContextAssembler
            5. Call Claude with tool-use loop (max 20 rounds)
            6. Calculate cost
            7. Store episodic memory
            8. Log to agent_task_log
            9. Emit tool:agent.invoked end event
            10. Return structured result
        """
        start_time = time.monotonic()
        tenant_id = tenant_id or context.get("tenant_id")

        # Resolve archetype
        archetype = self._archetypes.get(archetype_name)
        if not archetype:
            return {"status": "error", "reason": f"Unknown archetype: {archetype_name}"}

        # 1. Emit start event
        start_event_id = await self._emit_event(
            conn,
            namespace="tool",
            event_type="agent.invoked",
            phase="start",
            tenant_id=tenant_id,
            payload={
                "archetype": archetype_name,
                "tenantId": tenant_id,
                "taskType": context.get("type", "unknown"),
            },
        )

        total_input_tokens = 0
        total_output_tokens = 0
        tool_calls_count = 0
        model = DEFAULT_MODEL  # resolved from archetype below; default for error paths

        try:
            # 2-3. Cost-control guard. Effective limits resolve as:
            #   tenant override -> platform default -> hardcoded constant.
            # Load the pipeline-wide config once and pass it to both checks.
            if tenant_id:
                platform_cfg = await self._load_platform_config(conn)

                # Master switch: AI disabled pipeline-wide.
                if not platform_cfg["ai_enabled"]:
                    raise BudgetExceeded("AI is disabled platform-wide")

                rate_ok = await self._check_rate_limit(conn, tenant_id, platform_cfg)
                if not rate_ok:
                    raise RateLimitExceeded(
                        f"Tenant {tenant_id} exceeded the hourly call limit"
                    )

                budget_ok = await self._check_budget(conn, tenant_id, platform_cfg)
                if not budget_ok:
                    raise BudgetExceeded(
                        f"Tenant {tenant_id} exceeded the monthly AI budget or platform cap"
                    )
            else:
                # Platform/system invoke (tenant_id IS NULL): gate on the master
                # switch + the platform monthly cap (G1 — platform spend is now
                # logged and capped, not invisible).
                platform_cfg = await self._load_platform_config(conn)
                if not platform_cfg["ai_enabled"]:
                    raise BudgetExceeded("AI is disabled platform-wide")
                if not await self._check_platform_cap(conn, platform_cfg):
                    raise BudgetExceeded("Platform monthly AI cap reached")

            # Resolve the effective per-call ceiling (tenant override ->
            # platform default -> constant) used by the mid-loop cost check.
            effective_ceiling = PER_CALL_CEILING_USD
            try:
                pcfg = platform_cfg  # set in both branches above
                effective_ceiling = pcfg["default_per_call_ceiling"]
                if tenant_id:
                    tcfg = await conn.fetchrow(
                        "SELECT per_call_ceiling FROM tenant_agent_config WHERE tenant_id = $1",
                        uuid.UUID(tenant_id),
                    )
                    if tcfg and tcfg["per_call_ceiling"] is not None:
                        effective_ceiling = float(tcfg["per_call_ceiling"])
            except Exception as exc:
                logger.warning(
                    "[per_call_ceiling] resolve failed, using $%.2f: %s",
                    PER_CALL_CEILING_USD, exc,
                )
                effective_ceiling = PER_CALL_CEILING_USD

            # 4. Assemble context
            assembled = await self.context_assembler.assemble(
                conn, archetype, tenant_id, context,
            )

            # 5. Claude API call with tool-use loop
            client = self._get_client()
            model = getattr(archetype, "model", None) or DEFAULT_MODEL
            max_tokens = getattr(archetype, "max_tokens", None) or DEFAULT_MAX_TOKENS
            temperature = getattr(archetype, "temperature", 0.3)

            system_prompt = assembled["system_prompt"]
            messages = assembled["messages"]
            tools = assembled["tools"]

            # Get tool definitions from registry for the archetype's allowed tools
            allowed_tool_names = getattr(archetype, "tools", [])
            registry_tool_defs = self.tool_registry.get_definitions(allowed_tool_names)

            # Merge archetype-provided tool defs with registry defs (registry takes priority)
            registry_tool_names = {t["name"] for t in registry_tool_defs}
            merged_tools = list(registry_tool_defs)
            for tool_def in tools:
                if tool_def.get("name") not in registry_tool_names:
                    merged_tools.append(tool_def)

            # Build the initial API kwargs
            api_kwargs: dict = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
                "messages": list(messages),
            }
            if merged_tools:
                api_kwargs["tools"] = merged_tools

            response_text = ""
            tool_results_log: list[dict] = []
            rounds = 0
            tool_failure_counts: dict[str, int] = {}

            while rounds < MAX_TOOL_ROUNDS:
                try:
                    response = await asyncio.wait_for(
                        client.messages.create(**api_kwargs),
                        timeout=120.0,
                    )
                except asyncio.TimeoutError:
                    logger.error("[invoke_agent] Claude API call timed out (120s)")
                    response_text += "\n[Agent stopped: API call timed out]"
                    break

                total_input_tokens += response.usage.input_tokens
                total_output_tokens += response.usage.output_tokens

                # Extract text blocks from response
                for block in response.content:
                    if block.type == "text":
                        response_text += block.text

                if response.stop_reason == "end_turn":
                    break

                if response.stop_reason == "tool_use":
                    tool_result_blocks = []
                    for block in response.content:
                        if block.type == "tool_use":
                            tool_calls_count += 1
                            try:
                                if self.tool_registry.has_tool(block.name):
                                    result = await self.tool_registry.execute(
                                        conn,
                                        tenant_id,
                                        block.name,
                                        block.input,
                                        allowed_tools=allowed_tool_names or None,
                                    )
                                elif hasattr(archetype, "execute_tool"):
                                    result = await archetype.execute_tool(
                                        conn, block.name, block.input,
                                        {**context, "tenant_id": tenant_id},
                                    )
                                else:
                                    result = {"error": f"Unknown tool: {block.name}"}
                            except Exception as tool_exc:
                                logger.error(
                                    "[invoke_agent] tool %s failed: %s",
                                    block.name, tool_exc,
                                )
                                result = {
                                    "error": f"Tool execution failed: {str(tool_exc)[:200]}"
                                }

                            # Circuit breaker: stop retrying a tool after 3 failures
                            if isinstance(result, dict) and "error" in result:
                                tool_failure_counts[block.name] = tool_failure_counts.get(block.name, 0) + 1
                                if tool_failure_counts[block.name] >= 3:
                                    result = {"error": f"Tool {block.name} is temporarily unavailable after 3 failures"}
                                    # Remove the tripped tool so Claude stops calling it
                                    if "tools" in api_kwargs:
                                        api_kwargs["tools"] = [
                                            t for t in api_kwargs["tools"]
                                            if t.get("name") != block.name
                                        ]

                            tool_results_log.append({
                                "tool": block.name,
                                "input": block.input,
                                "output": result,
                            })

                            tool_result_blocks.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": json.dumps(result),
                            })

                    # Append the assistant turn (with tool_use blocks) and user
                    # turn (with tool_result blocks) for the next round.
                    api_kwargs["messages"].append({
                        "role": "assistant",
                        "content": response.content,
                    })
                    api_kwargs["messages"].append({
                        "role": "user",
                        "content": tool_result_blocks,
                    })
                    rounds += 1

                    # Mid-loop budget check: stop if per-call cost ceiling reached
                    accumulated_cost = _cost_for(model, total_input_tokens, total_output_tokens)
                    if accumulated_cost > effective_ceiling:
                        logger.warning(
                            "[invoke_agent] per-call cost ceiling reached: $%.4f (limit $%.4f)",
                            accumulated_cost, effective_ceiling,
                        )
                        break
                else:
                    # Unexpected stop reason (e.g. max_tokens) — stop looping
                    break
            else:
                logger.warning(
                    "[invoke_agent] %s exhausted %d tool-use rounds",
                    archetype_name, MAX_TOOL_ROUNDS,
                )

            # 6. Calculate cost (priced per-model)
            cost_usd = _cost_for(model, total_input_tokens, total_output_tokens)

            duration_ms = int((time.monotonic() - start_time) * 1000)

            # Let archetype post-process if available
            raw_result = {
                "text": response_text,
                "tool_results": tool_results_log,
            }
            summary = ""
            if hasattr(archetype, "summarize_result"):
                summary = archetype.summarize_result(raw_result)
            else:
                summary = response_text[:200] if response_text else "No text output"

            # 7. Store episodic memory
            memories_written = 0
            if tenant_id:
                try:
                    mem_id = await self.memory.store(conn, tenant_id, archetype_name, {
                        "input_summary": str(context.get("type", ""))[:200],
                        "output_summary": summary[:200],
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "cost_usd": float(cost_usd),
                        "tool_calls": tool_calls_count,
                    })
                    if mem_id:
                        memories_written = 1
                except Exception as mem_exc:
                    logger.error("[invoke_agent] memory store failed: %s", mem_exc)

            # 8. Log to agent_task_log
            await self._log_task(
                conn,
                tenant_id=tenant_id,
                agent_role=archetype_name,
                task_type=context.get("type", "unknown"),
                trigger_event=context.get("trigger_event_id") or context.get("task_id"),
                proposal_id=context.get("proposal_id") or context.get("payload", {}).get("proposalId"),
                section_id=context.get("section_id") or context.get("payload", {}).get("sectionId"),
                input_tokens=total_input_tokens,
                output_tokens=total_output_tokens,
                tool_calls_count=tool_calls_count,
                duration_ms=duration_ms,
                cost_usd=cost_usd,
                memories_written=memories_written,
                error=None,
            )

            # 9. Emit end event
            await self._emit_event(
                conn,
                namespace="tool",
                event_type="agent.invoked",
                phase="end",
                tenant_id=tenant_id,
                payload={
                    "archetype": archetype_name,
                    "tenantId": tenant_id,
                    "durationMs": duration_ms,
                    "tokensUsed": total_input_tokens + total_output_tokens,
                    "input_tokens": total_input_tokens,
                    "output_tokens": total_output_tokens,
                    "tool_calls": tool_calls_count,
                    "rounds": rounds,
                    "cost_usd": float(cost_usd),
                    "status": "completed",
                },
                parent_event_id=start_event_id,
            )

            # 10. Return structured result
            return {
                "status": "completed",
                "archetype": archetype_name,
                "result": {
                    "text": response_text,
                    "summary": summary,
                    "tool_results": tool_results_log,
                },
                "tokens": {
                    "input": total_input_tokens,
                    "output": total_output_tokens,
                },
                "cost_usd": float(cost_usd),
                "duration_ms": duration_ms,
                "rounds": rounds,
            }

        except (RateLimitExceeded, BudgetExceeded) as guard_exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            error_msg = str(guard_exc)
            logger.error("[invoke_agent] guardrail blocked %s: %s", archetype_name, error_msg)

            await self._log_task(
                conn,
                tenant_id=tenant_id,
                agent_role=archetype_name,
                task_type=context.get("type", "unknown"),
                trigger_event=context.get("trigger_event_id") or context.get("task_id"),
                input_tokens=0,
                output_tokens=0,
                tool_calls_count=0,
                duration_ms=duration_ms,
                cost_usd=0,
                error=error_msg,
            )

            await self._emit_event(
                conn,
                namespace="tool",
                event_type="agent.invoked",
                phase="end",
                tenant_id=tenant_id,
                payload={
                    "archetype": archetype_name,
                    "tenantId": tenant_id,
                    "durationMs": duration_ms,
                    "tokensUsed": 0,
                    "status": "rejected",
                    "error": error_msg,
                    "stage": "guardrail",
                },
                parent_event_id=start_event_id,
            )

            return {
                "status": "rejected",
                "archetype": archetype_name,
                "error": error_msg,
            }

        except Exception as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            error_msg = str(exc)[:500]
            logger.error("[invoke_agent] %s failed: %s", archetype_name, exc)

            # Log the failure — wrapped to avoid masking the original error
            try:
                await self._log_task(
                    conn,
                    tenant_id=tenant_id,
                    agent_role=archetype_name,
                    task_type=context.get("type", "unknown"),
                    trigger_event=context.get("trigger_event_id") or context.get("task_id"),
                    input_tokens=total_input_tokens,
                    output_tokens=total_output_tokens,
                    tool_calls_count=tool_calls_count,
                    duration_ms=duration_ms,
                    cost_usd=_cost_for(model, total_input_tokens, total_output_tokens),
                    error=error_msg,
                )
            except Exception as log_exc:
                logger.error("[invoke_agent] error-path _log_task failed: %s", log_exc)

            try:
                await self._emit_event(
                    conn,
                    namespace="tool",
                    event_type="agent.invoked",
                    phase="end",
                    tenant_id=tenant_id,
                    payload={
                        "archetype": archetype_name,
                        "tenantId": tenant_id,
                        "durationMs": duration_ms,
                        "tokensUsed": total_input_tokens + total_output_tokens,
                        "status": "error",
                        "error": error_msg,
                        "stage": "execution",
                        "input_tokens": total_input_tokens,
                        "output_tokens": total_output_tokens,
                    },
                    parent_event_id=start_event_id,
                )
            except Exception as event_exc:
                logger.error("[invoke_agent] error-path _emit_event failed: %s", event_exc)

            return {
                "status": "error",
                "archetype": archetype_name,
                "error": error_msg,
            }

    # ------------------------------------------------------------------
    # Task queue processing
    # ------------------------------------------------------------------

    async def process_task_queue(self, conn) -> list[dict]:
        """Poll agent_task_queue for pending tasks, claim, execute, update.

        Uses FOR UPDATE SKIP LOCKED to safely claim tasks across multiple
        workers. Returns a list of result dicts for each processed task.
        """
        results: list[dict] = []
        worker_id = f"fabric-{uuid.uuid4().hex[:8]}"

        try:
            # Claim up to 5 pending tasks atomically
            rows = await conn.fetch(
                """
                UPDATE agent_task_queue
                SET status = 'running',
                    worker_id = $1,
                    picked_at = now()
                WHERE id IN (
                    SELECT id FROM agent_task_queue
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 5
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, tenant_id, agent_role, task_type, input,
                          proposal_id, section_id
                """,
                worker_id,
            )
        except Exception as exc:
            logger.error("[process_task_queue] claim failed: %s", exc)
            return results

        for row in rows:
            task_id = row["id"]
            tenant_id = str(row["tenant_id"]) if row["tenant_id"] else None
            agent_role = row["agent_role"]
            task_type = row["task_type"]

            # Parse the task input — asyncpg may return JSONB as dict or str
            raw_input = row["input"]
            if isinstance(raw_input, str):
                try:
                    task_input = json.loads(raw_input)
                except json.JSONDecodeError:
                    task_input = {}
            elif raw_input is None:
                task_input = {}
            else:
                task_input = raw_input

            # Build context from the task row
            context = {
                "type": task_type,
                "tenant_id": tenant_id,
                "task_id": str(task_id),
                "proposal_id": str(row["proposal_id"]) if row["proposal_id"] else None,
                "section_id": str(row["section_id"]) if row["section_id"] else None,
                **task_input,
            }

            try:
                result = await self.invoke_agent(
                    conn, agent_role, context, tenant_id=tenant_id,
                )

                # Store result
                try:
                    await conn.execute(
                        """
                        INSERT INTO agent_task_results (id, task_id, output, created_at)
                        VALUES ($1, $2, $3::jsonb, now())
                        """,
                        uuid.uuid4(),
                        task_id,
                        json.dumps(result),
                    )
                except Exception as res_exc:
                    logger.error(
                        "[process_task_queue] result store failed for task %s: %s",
                        task_id, res_exc,
                    )

                # Update task status
                status = "completed" if result.get("status") == "completed" else "failed"
                error_text = result.get("error") if status == "failed" else None

                try:
                    await conn.execute(
                        """
                        UPDATE agent_task_queue
                        SET status = $1, completed_at = now(), error = $2
                        WHERE id = $3
                        """,
                        status,
                        error_text,
                        task_id,
                    )
                except Exception as upd_exc:
                    logger.error(
                        "[process_task_queue] status update failed for task %s: %s",
                        task_id, upd_exc,
                    )

                # AI review write-back: surface a completed section review as a
                # recommendation in that section's context-box thread.
                if status == "completed" and task_type == "review_section":
                    await self._post_section_recommendation(conn, row, task_input, result)

                results.append({"task_id": str(task_id), **result})

            except Exception as exc:
                logger.error(
                    "[process_task_queue] task %s execution failed: %s",
                    task_id, exc,
                )
                try:
                    await conn.execute(
                        """
                        UPDATE agent_task_queue
                        SET status = 'failed', completed_at = now(), error = $1
                        WHERE id = $2
                        """,
                        str(exc)[:500],
                        task_id,
                    )
                except Exception as upd_exc:
                    logger.error(
                        "[process_task_queue] failure update failed for task %s: %s",
                        task_id, upd_exc,
                    )

                results.append({
                    "task_id": str(task_id),
                    "status": "error",
                    "error": str(exc)[:500],
                })

        return results

    async def _post_section_recommendation(self, conn, row, task_input: dict, result: dict) -> None:
        """Write a completed AI section review into proposal_comments
        (recommendation_type='ai_review') so it surfaces in the section's
        context-box thread, attributed to the admin who requested the review.
        Best-effort — a failure here must never fail the agent task."""
        try:
            proposal_id = row["proposal_id"]
            section_id = row["section_id"]
            if not proposal_id or not section_id:
                return
            requested_by = task_input.get("requested_by") or task_input.get("requestedBy")
            if not requested_by:
                return  # proposal_comments.user_id is NOT NULL — need an author

            res = result.get("result") if isinstance(result, dict) else None
            text = ""
            if isinstance(res, dict):
                text = (res.get("summary") or res.get("text") or "").strip()
            if not text:
                return

            await conn.execute(
                """
                INSERT INTO proposal_comments
                    (proposal_id, section_id, user_id, content, recommendation_type, category)
                VALUES ($1, $2, $3, $4, 'ai_review', $5)
                """,
                proposal_id,
                section_id,
                uuid.UUID(str(requested_by)),
                text[:10000],
                task_input.get("category"),
            )
            logger.info(
                "[process_task_queue] posted AI recommendation for section %s", section_id,
            )
        except Exception as exc:
            logger.error(
                "[process_task_queue] recommendation write-back failed: %s", exc,
            )

    # ------------------------------------------------------------------
    # Platform-wide config (pipeline-level, settable by admin)
    # ------------------------------------------------------------------

    async def _load_platform_config(self, conn) -> dict:
        """Read the pipeline-wide config singleton (platform_agent_config).

        BEST-EFFORT: a missing table/row (e.g. pre-migration) falls back to the
        hardcoded constants. Config absence is not a spend-verification failure,
        so it must NOT disable AI — the spend checks below still fail closed.
        """
        fallback = {
            "ai_enabled": True,
            "default_monthly_budget": DEFAULT_MONTHLY_BUDGET_USD,
            "default_rate_limit": RATE_LIMIT_PER_HOUR,
            "default_per_call_ceiling": PER_CALL_CEILING_USD,
            "platform_monthly_cap": None,
        }
        try:
            row = await conn.fetchrow(
                """
                SELECT default_monthly_budget, default_rate_limit_per_hour,
                       default_per_call_ceiling, platform_monthly_cap, ai_enabled
                FROM platform_agent_config
                WHERE id = TRUE
                """
            )
            if not row:
                return fallback
            cap = row["platform_monthly_cap"]
            return {
                "ai_enabled": bool(row["ai_enabled"]),
                "default_monthly_budget": float(row["default_monthly_budget"]),
                "default_rate_limit": int(row["default_rate_limit_per_hour"]),
                "default_per_call_ceiling": float(row["default_per_call_ceiling"]),
                "platform_monthly_cap": float(cap) if cap is not None else None,
            }
        except Exception as exc:
            logger.warning("[platform_config] read failed, using constants: %s", exc)
            return fallback

    # ------------------------------------------------------------------
    # Rate limit check
    # ------------------------------------------------------------------

    async def _check_rate_limit(self, conn, tenant_id: str, platform: dict | None = None) -> bool:
        """Check if tenant has exceeded the hourly rate limit.

        Effective limit = tenant override (tenant_agent_config.rate_limit_per_hour)
        -> platform default -> RATE_LIMIT_PER_HOUR. Returns True if within limit,
        False if exceeded. Fails CLOSED.
        """
        try:
            if platform is None:
                platform = await self._load_platform_config(conn)

            cfg = await conn.fetchrow(
                """
                SELECT rate_limit_per_hour
                FROM tenant_agent_config
                WHERE tenant_id = $1
                """,
                uuid.UUID(tenant_id),
            )
            tenant_rate = cfg["rate_limit_per_hour"] if cfg else None
            effective = int(tenant_rate) if tenant_rate is not None else platform["default_rate_limit"]

            row = await conn.fetchrow(
                """
                SELECT COUNT(*) AS cnt
                FROM agent_task_log
                WHERE tenant_id = $1
                  AND created_at > now() - interval '1 hour'
                """,
                uuid.UUID(tenant_id),
            )
            count = row["cnt"] if row else 0
            if count >= effective:
                logger.error(
                    "[rate_limit] tenant %s has %d calls in the last hour (limit: %d)",
                    tenant_id, count, effective,
                )
                return False
            return True
        except Exception as exc:
            # Fail CLOSED — deny the call if we can't verify rate limit
            logger.error("[rate_limit] check failed, denying call: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Budget check
    # ------------------------------------------------------------------

    async def _check_budget(self, conn, tenant_id: str, platform: dict | None = None) -> bool:
        """Check the tenant monthly budget AND the platform monthly cap.

        Effective budget = tenant override (tenant_agent_config.monthly_budget)
        -> platform default -> DEFAULT_MONTHLY_BUDGET_USD. monthly_budget=0
        disables AI for the tenant. If a platform_monthly_cap is set, total spend
        across ALL tenants + admin/system is also checked. Returns True if within
        all limits, False otherwise. Fails CLOSED.
        """
        try:
            if platform is None:
                platform = await self._load_platform_config(conn)

            if not platform["ai_enabled"]:
                logger.info("[budget] AI disabled platform-wide")
                return False

            # Tenant budget (override -> platform default)
            config_row = await conn.fetchrow(
                """
                SELECT monthly_budget
                FROM tenant_agent_config
                WHERE tenant_id = $1
                """,
                uuid.UUID(tenant_id),
            )
            if config_row and config_row["monthly_budget"] is not None:
                monthly_budget = float(config_row["monthly_budget"])
            else:
                monthly_budget = platform["default_monthly_budget"]

            # Explicit zero budget means AI is disabled for this tenant
            if monthly_budget == 0:
                logger.info(
                    "[budget] tenant %s has monthly_budget=0 (AI disabled)",
                    tenant_id,
                )
                return False

            # Sum tenant costs for the current calendar month
            usage_row = await conn.fetchrow(
                """
                SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
                FROM agent_task_log
                WHERE tenant_id = $1
                  AND created_at >= date_trunc('month', now())
                """,
                uuid.UUID(tenant_id),
            )
            total_cost = float(usage_row["total_cost"]) if usage_row else 0.0

            if total_cost >= monthly_budget:
                logger.error(
                    "[budget] tenant %s used $%.4f of $%.2f monthly budget",
                    tenant_id, total_cost, monthly_budget,
                )
                return False

            # Platform-wide cap across ALL tenants + admin/system spend
            cap = platform["platform_monthly_cap"]
            if cap is not None:
                platform_row = await conn.fetchrow(
                    """
                    SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
                    FROM agent_task_log
                    WHERE created_at >= date_trunc('month', now())
                    """
                )
                platform_cost = float(platform_row["total_cost"]) if platform_row else 0.0
                if platform_cost >= cap:
                    logger.error(
                        "[budget] platform monthly cap reached: $%.4f of $%.2f",
                        platform_cost, cap,
                    )
                    return False

            return True
        except Exception as exc:
            # Fail CLOSED — deny the call if we can't verify budget
            logger.error("[budget] check failed, denying call: %s", exc)
            return False

    async def _check_platform_cap(self, conn, platform: dict | None = None) -> bool:
        """Platform-wide monthly cap check across ALL spend (tenant + platform/
        system). Used for tenant_id IS NULL (platform/system) invokes, where
        there is no tenant budget to check. Returns True if within the cap (or no
        cap is set). Fails CLOSED.
        """
        try:
            if platform is None:
                platform = await self._load_platform_config(conn)
            cap = platform.get("platform_monthly_cap")
            if cap is None:
                return True
            row = await conn.fetchrow(
                """
                SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
                FROM agent_task_log
                WHERE created_at >= date_trunc('month', now())
                """
            )
            total = float(row["total_cost"]) if row else 0.0
            if total >= float(cap):
                logger.error(
                    "[budget] platform monthly cap reached: $%.4f of $%.2f",
                    total, float(cap),
                )
                return False
            return True
        except Exception as exc:
            logger.error("[budget] platform cap check failed, denying call: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Task logging
    # ------------------------------------------------------------------

    async def _log_task(
        self,
        conn,
        *,
        tenant_id: str | None,
        agent_role: str,
        task_type: str,
        trigger_event: str | None = None,
        proposal_id: str | None = None,
        section_id: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        tool_calls_count: int = 0,
        duration_ms: int = 0,
        cost_usd: float = 0.0,
        memories_written: int = 0,
        error: str | None = None,
    ) -> None:
        """Insert a row into agent_task_log for audit and billing.

        G1: platform/system invocations (tenant_id is None) ARE logged now —
        with a NULL tenant_id — so platform_monthly_cap and the admin usage views
        account for their spend (previously they were silently skipped).
        """
        try:
            await conn.execute(
                """
                INSERT INTO agent_task_log
                    (id, tenant_id, agent_role, task_type, trigger_event,
                     proposal_id, section_id, input_tokens, output_tokens,
                     tool_calls_count, duration_ms, cost_usd,
                     memories_written, error, created_at)
                VALUES
                    ($1, $2, $3, $4, $5,
                     $6, $7, $8, $9,
                     $10, $11, $12,
                     $13, $14, now())
                """,
                uuid.uuid4(),
                uuid.UUID(tenant_id) if tenant_id else None,
                agent_role,
                task_type,
                trigger_event,
                uuid.UUID(proposal_id) if proposal_id else None,
                uuid.UUID(section_id) if section_id else None,
                input_tokens,
                output_tokens,
                tool_calls_count,
                duration_ms,
                cost_usd,
                memories_written,
                error,
            )
        except Exception as exc:
            logger.error("[_log_task] failed to log agent task: %s", exc)

    # ------------------------------------------------------------------
    # Event emission helper
    # ------------------------------------------------------------------

    async def _emit_event(
        self,
        conn,
        *,
        namespace: str,
        event_type: str,
        phase: str,
        tenant_id: str | None = None,
        payload: dict | None = None,
        parent_event_id: str | None = None,
    ) -> str:
        """Insert a system_events row. Returns the event id as a string."""
        event_id = str(uuid.uuid4())
        event_payload = payload or {}
        if "correlationId" not in event_payload:
            event_payload["correlationId"] = str(uuid.uuid4())

        try:
            await conn.execute(
                """
                INSERT INTO system_events
                    (id, namespace, type, phase, actor_type, actor_id,
                     tenant_id, parent_event_id, payload, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
                """,
                uuid.UUID(event_id),
                namespace,
                event_type,
                phase,
                "agent",
                "fabric",
                uuid.UUID(tenant_id) if tenant_id else None,
                uuid.UUID(parent_event_id) if parent_event_id else None,
                json.dumps(event_payload),
                datetime.now(timezone.utc),
            )
            return event_id
        except Exception as exc:
            logger.error("[_emit_event] failed: %s", exc)
            return ""


# ---------------------------------------------------------------------------
# Guardrail exceptions
# ---------------------------------------------------------------------------


class RateLimitExceeded(Exception):
    """Raised when a tenant exceeds the hourly rate limit."""


class BudgetExceeded(Exception):
    """Raised when a tenant exceeds their monthly AI budget."""
