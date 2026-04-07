"""packaging_specialist agent archetype."""
from .base import BaseArchetype


class Packaging_specialistArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "packaging_specialist"

    @property
    def system_prompt(self) -> str:
        return "You are the packaging_specialist agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
