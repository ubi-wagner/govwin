"""Automation engine — evaluates rules against events, fires actions."""


class AutomationEngine:
    async def evaluate(self, conn, event_bus: str, event_type: str, payload: dict) -> list[dict]:
        # TODO: Implement rule matching and action execution
        return []
