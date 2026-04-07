"""Tool registry and execution layer — all tools enforce tenant_id."""


class ToolRegistry:
    """Maps tool names to functions, validates inputs, logs execution."""

    def __init__(self):
        self._tools: dict[str, callable] = {}

    def register(self, name: str, fn: callable) -> None:
        self._tools[name] = fn

    async def execute(self, conn, tenant_id: str, tool_name: str, params: dict) -> dict:
        if tool_name not in self._tools:
            return {"error": f"Unknown tool: {tool_name}"}
        # TODO: Validate tenant_id, execute, audit log
        return await self._tools[tool_name](conn, tenant_id, **params)
