"""Agent task queue dispatcher.

Polls `agent_task_queue` for pending rows, invokes the target tool
via the frontend's HTTP tool adapter, and writes the result to
`agent_task_results`. This is how the dual-use tool framework
closes the loop for the agent path:

    agent runtime enqueues task in agent_task_queue
        ↓
    pipeline worker dequeues
        ↓
    POST http://frontend/api/tools/<tool_name>
    with a service-to-service auth header
        ↓
    frontend registry.invoke() runs the tool
        ↓
    pipeline writes result row to agent_task_results
        ↓
    pipeline emits agent.task.completed event (or agent.task.failed)

In Phase 0.5b this is a skeleton — the actual dequeue loop + HTTP
call + retry logic gets wired up in Phase 4 when the agent runtime
lands. For now the module exists so the directory structure and
import path are established, and so future Phase 4 work has a
ready-to-fill-in template.

Auth note: the pipeline → frontend HTTP call uses an internal
service-to-service header (Phase 5 concern) rather than a NextAuth
session. The tool registry doesn't care how the caller authenticated
— it only enforces `requiredRole` via `ctx.actor.role`, which the
pipeline sets to whatever `agent_task_queue.agent_role` is.

See docs/TOOL_CONVENTIONS.md §"Dual-use entry points" item 3.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

FRONTEND_URL = os.getenv("FRONTEND_INTERNAL_URL", "http://frontend:3000")
SERVICE_TOKEN_ENV = "TOOL_SERVICE_TOKEN"  # set in Phase 5 when the contract is wired


@dataclass(frozen=True)
class ToolInvocation:
    """A single pending agent task about to invoke a tool."""

    task_id: str
    tenant_id: str
    tool_name: str
    agent_role: str
    input: dict[str, Any]


@dataclass(frozen=True)
class ToolResultRow:
    """The row written to agent_task_results after an invocation."""

    task_id: str
    tool_name: str
    outcome: str  # 'success' | 'error'
    result: dict[str, Any] | None
    error: dict[str, Any] | None
    duration_ms: int | None


async def dispatch_next_task() -> ToolResultRow | None:
    """Dequeue one pending agent task, invoke the tool, write the result.

    Phase 0.5b stub — full implementation lands in Phase 4 alongside
    the agent fabric. The skeleton exists so import paths, module
    locations, and the function signature are frozen now.
    """
    # Phase 4 implementation outline:
    #
    #   async with asyncpg.connect(DATABASE_URL) as conn:
    #       async with conn.transaction():
    #           row = await conn.fetchrow(
    #               """
    #               SELECT id, tenant_id, task_type, agent_role, input
    #               FROM agent_task_queue
    #               WHERE status = 'pending'
    #               ORDER BY created_at
    #               FOR UPDATE SKIP LOCKED
    #               LIMIT 1
    #               """
    #           )
    #           if row is None:
    #               return None
    #           await conn.execute(
    #               "UPDATE agent_task_queue SET status = 'running', picked_at = now() WHERE id = $1",
    #               row['id'],
    #           )
    #       invocation = ToolInvocation(
    #           task_id=str(row['id']),
    #           tenant_id=str(row['tenant_id']),
    #           tool_name=row['task_type'],
    #           agent_role=row['agent_role'],
    #           input=row['input'],
    #       )
    #       result = await _call_frontend_tool(invocation)
    #       await _persist_result(conn, invocation, result)
    #       return result
    return None


async def _call_frontend_tool(invocation: ToolInvocation) -> ToolResultRow:
    """POST to the frontend's generic tool adapter. Phase 4."""
    raise NotImplementedError(
        "Phase 4 — wire httpx POST to /api/tools/:name with service token"
    )


async def _persist_result(conn: Any, inv: ToolInvocation, result: ToolResultRow) -> None:
    """Write result + update task status. Phase 4."""
    raise NotImplementedError(
        "Phase 4 — INSERT agent_task_results + UPDATE agent_task_queue.status"
    )
