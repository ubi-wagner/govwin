"""capture_strategist agent archetype."""
from .base import BaseArchetype


class Capture_strategistArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "capture_strategist"

    @property
    def system_prompt(self) -> str:
        return "You are the capture_strategist agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
