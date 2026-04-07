"""partner_coordinator agent archetype."""
from .base import BaseArchetype


class Partner_coordinatorArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "partner_coordinator"

    @property
    def system_prompt(self) -> str:
        return "You are the partner_coordinator agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
