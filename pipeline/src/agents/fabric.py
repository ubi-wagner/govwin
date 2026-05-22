"""AgentFabric — orchestrator for all agent invocations."""

import json
import logging
import os
from datetime import datetime, timezone

import anthropic

from .memory import MemoryStore

logger = logging.getLogger("pipeline.agents")


class AgentFabric:
    """Routes events to agent archetypes, manages context assembly and execution."""

    def __init__(self):
        self.client = None
        self.memory = MemoryStore()
        self._archetypes = {}

    def _get_client(self):
        if not self.client:
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY not set")
            self.client = anthropic.AsyncAnthropic(api_key=api_key)
        return self.client

    def register_archetype(self, name: str, archetype):
        """Register an archetype instance by name."""
        self._archetypes[name] = archetype

    async def handle_event(self, conn, event: dict) -> dict:
        """Route an event to the appropriate agent archetype."""
        event_type = event.get("type", "")

        # Find matching archetype
        for name, archetype in self._archetypes.items():
            if archetype.handles_event(event_type):
                return await self.invoke_agent(conn, name, event)

        return {"status": "no_handler", "event_type": event_type}

    async def invoke_agent(self, conn, archetype_name: str, context: dict) -> dict:
        """Invoke a specific agent archetype with context."""
        archetype = self._archetypes.get(archetype_name)
        if not archetype:
            return {"status": "error", "reason": f"Unknown archetype: {archetype_name}"}

        client = self._get_client()

        # Build the prompt from archetype config
        system_prompt = archetype.system_prompt
        tools = archetype.get_tools()

        # Load relevant memories
        tenant_id = context.get("tenant_id")
        memories = []
        if tenant_id:
            memories = await self.memory.recall(conn, tenant_id, archetype_name, limit=10)

        # Build messages
        messages = archetype.build_messages(context, memories)

        # Call Claude
        kwargs = {
            "model": archetype.model or "claude-sonnet-4-20250514",
            "max_tokens": archetype.max_tokens or 4096,
            "system": system_prompt,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools

        try:
            response = await client.messages.create(**kwargs)

            # Process tool calls if any
            result = await self._process_response(conn, archetype, response, context)

            # Store memory of this interaction
            if tenant_id:
                await self.memory.store(conn, tenant_id, archetype_name, {
                    "input_summary": str(context.get("type", ""))[:200],
                    "output_summary": str(result.get("summary", ""))[:200],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            return {
                "status": "completed",
                "archetype": archetype_name,
                "result": result,
                "tokens": {
                    "input": response.usage.input_tokens,
                    "output": response.usage.output_tokens,
                },
            }
        except Exception as e:
            logger.error(f"[invoke_agent] {archetype_name} failed: {e}")
            return {"status": "error", "archetype": archetype_name, "error": str(e)}

    async def _process_response(self, conn, archetype, response, context):
        """Process Claude's response, handling tool calls if present."""
        result = {"text": "", "tool_results": []}

        for block in response.content:
            if block.type == "text":
                result["text"] += block.text
            elif block.type == "tool_use":
                tool_result = await archetype.execute_tool(
                    conn, block.name, block.input, context
                )
                result["tool_results"].append({
                    "tool": block.name,
                    "input": block.input,
                    "output": tool_result,
                })

        # Let archetype post-process
        result["summary"] = archetype.summarize_result(result)
        return result
