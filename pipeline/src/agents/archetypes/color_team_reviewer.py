"""color_team_reviewer agent archetype."""
from .base import BaseArchetype


class Color_team_reviewerArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "color_team_reviewer"

    @property
    def system_prompt(self) -> str:
        return "You are the color_team_reviewer agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
