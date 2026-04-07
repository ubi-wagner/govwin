"""scoring_strategist agent archetype."""
from .base import BaseArchetype


class Scoring_strategistArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "scoring_strategist"

    @property
    def system_prompt(self) -> str:
        return "You are the scoring_strategist agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
