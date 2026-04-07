"""compliance_reviewer agent archetype."""
from .base import BaseArchetype


class Compliance_reviewerArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "compliance_reviewer"

    @property
    def system_prompt(self) -> str:
        return "You are the compliance_reviewer agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
