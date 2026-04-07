"""Context assembly — builds the complete prompt for agent invocations."""


class ContextAssembler:
    """Loads archetype prompt + tenant profile + memories + task data + tools."""

    async def assemble(self, conn, agent_role: str, tenant_id: str, task_data: dict) -> dict:
        # TODO: Implement
        return {"system_prompt": "", "messages": [], "tools": []}
