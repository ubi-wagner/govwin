"""section_drafter agent archetype."""
from .base import BaseArchetype


class Section_drafterArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "section_drafter"

    @property
    def system_prompt(self) -> str:
        return "You are the section_drafter agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
