"""opportunity_analyst agent archetype."""
from .base import BaseArchetype


class Opportunity_analystArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "opportunity_analyst"

    @property
    def system_prompt(self) -> str:
        return "You are the opportunity_analyst agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
