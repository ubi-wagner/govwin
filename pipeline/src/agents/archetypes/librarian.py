"""librarian agent archetype."""
from .base import BaseArchetype


class LibrarianArchetype(BaseArchetype):
    @property
    def role_name(self) -> str:
        return "librarian"

    @property
    def system_prompt(self) -> str:
        return "You are the librarian agent. TODO: implement full prompt."

    @property
    def tools(self) -> list[str]:
        return []  # TODO: define tools for this archetype
