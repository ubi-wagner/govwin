"""Base archetype class that all agent roles inherit from."""
from abc import ABC, abstractmethod


class BaseArchetype(ABC):
    """Defines an agent role's capabilities, constraints, and behavior."""

    @property
    @abstractmethod
    def role_name(self) -> str: ...

    @property
    @abstractmethod
    def system_prompt(self) -> str: ...

    @property
    @abstractmethod
    def tools(self) -> list[str]: ...

    @property
    def model(self) -> str | None:
        """Claude model to use. None = fabric default (Sonnet)."""
        return None

    @property
    def max_tokens(self) -> int:
        return 4096

    @property
    def temperature(self) -> float:
        return 0.3

    @property
    def human_gate(self) -> bool:
        return True

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type. Override in subclasses.

        ⚠️ `event_type` is the BARE `system_events.type` column — `package.atomized`, NOT
        `library.package.atomized`. Namespace lives in its own column (see `pipeline/src/events.py`
        and `frontend/lib/events.ts`), so a namespace-prefixed string here can never match and the
        declaration is inert. Most archetypes in this package declare the prefixed form; they are
        dormant by design (CLAUDE.md — agents are woken one at a time) and are reached through an
        `AI_INVOKE` step or an `agent_task_queue` producer instead of this fallback.
        """
        return False

    def handles_dispatch(self, event: dict) -> bool:
        """Payload-aware second gate for the processor's archetype-fallback path.

        `handles_event` only sees the type, so it cannot tell a usable event from one that names
        the right subject but carries none of the inputs this archetype needs. Override to decline
        those; the default keeps the type-only behaviour.
        """
        return self.handles_event(event.get("type", ""))

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format. Override in subclasses."""
        return []

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list for Claude. Override in subclasses."""
        return [{"role": "user", "content": str(context)}]

    async def execute_tool(self, conn, tool_name: str, tool_input: dict, context: dict) -> dict:
        """Execute a tool call. Override in subclasses with real tool implementations."""
        return {"error": f"Tool {tool_name} not implemented for {self.role_name}"}

    def summarize_result(self, result: dict) -> str:
        """Summarize the result for memory storage. Override in subclasses."""
        text = result.get("text", "")
        return text[:200] if text else "No text output"
