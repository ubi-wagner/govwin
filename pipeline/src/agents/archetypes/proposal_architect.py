"""proposal_architect agent archetype."""
from .base import BaseArchetype


class Proposal_architectArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "proposal_architect"

    @property
    def system_prompt(self) -> str:
        return "You are the proposal_architect agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
