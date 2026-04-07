"""Base archetype class that all agent roles inherit from."""
from abc import ABC, abstractmethod


class BaseArchetype(ABC):
    """Defines an agent role's capabilities, constraints, and behavior."""

    @property
    @abstractmethod
    def role_name(self) -> str: ...

    @property
    @abstractmethod
    def system_prompt(self) -> str: ...

    @property
    @abstractmethod
    def tools(self) -> list[str]: ...

    @property
    def max_tokens(self) -> int:
        return 4096

    @property
    def temperature(self) -> float:
        return 0.3

    @property
    def human_gate(self) -> bool:
        return True
