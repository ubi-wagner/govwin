"""
Workflow base classes — the contract every workflow definition must follow.

A Workflow is a declarative job template. It does NOT execute anything
itself — the event_processor reads the definition and drives execution.

See docs/EVENT_CONTRACT.md §7 for architecture and §8 for extension rules.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

log = logging.getLogger("pipeline.workflows")


# ─── Trigger ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EventTrigger:
    """Defines which system_events row activates this workflow or step."""

    namespace: str
    type: str
    phase: str = "end"
    condition: Optional[Callable[[dict[str, Any]], bool]] = None

    def matches(self, event: dict[str, Any]) -> bool:
        if event.get("namespace") != self.namespace:
            return False
        if event.get("type") != self.type:
            return False
        if event.get("phase") != self.phase:
            return False
        if self.condition and not self.condition(event.get("payload", {})):
            return False
        return True


# ─── Step types ─────────────────────────────────────────────────────


class StepType(str, Enum):
    ACTION = "action"
    API_CALL = "api_call"
    AI_INVOKE = "ai_invoke"
    HITL_WAIT = "hitl_wait"
    NOTIFY = "notify"
    CONDITION = "condition"


@dataclass
class Step:
    """One unit of work in a workflow."""

    name: str
    action: str
    step_type: StepType = StepType.ACTION
    depends_on: Optional[str] = None
    input_map: dict[str, str] = field(default_factory=dict)
    timeout_minutes: int = 30
    retry_count: int = 0
    retry_delay_seconds: int = 60
    wait_for: Optional[EventTrigger] = None
    on_timeout: Optional[str] = None
    on_failure: Optional[str] = None
    condition: Optional[Callable[[dict[str, Any]], bool]] = None


# ─── Workflow base ──────────────────────────────────────────────────


class Workflow:
    """
    Base class for all workflow definitions.

    Subclasses set `trigger` and `steps` as class attributes.
    The event_processor discovers all Workflow subclasses at boot time
    and registers their triggers.
    """

    trigger: EventTrigger
    steps: list[Step] = []
    description: str = ""

    @classmethod
    def validate(cls) -> list[str]:
        """Check the workflow definition for common mistakes."""
        errors: list[str] = []
        if not hasattr(cls, "trigger") or cls.trigger is None:
            errors.append(f"{cls.__name__}: missing trigger")
        if not cls.steps:
            errors.append(f"{cls.__name__}: no steps defined")

        step_names = {s.name for s in cls.steps}
        for step in cls.steps:
            if step.depends_on and step.depends_on not in step_names:
                errors.append(
                    f"{cls.__name__}.{step.name}: depends_on "
                    f"'{step.depends_on}' not found in steps"
                )
            if step.step_type == StepType.HITL_WAIT and not step.wait_for:
                errors.append(
                    f"{cls.__name__}.{step.name}: hitl_wait step "
                    f"must define wait_for trigger"
                )
        return errors

    @classmethod
    def step_execution_order(cls) -> list[Step]:
        """Topological sort of steps respecting depends_on."""
        by_name = {s.name: s for s in cls.steps}
        visited: set[str] = set()
        order: list[Step] = []

        def visit(name: str) -> None:
            if name in visited:
                return
            visited.add(name)
            step = by_name[name]
            if step.depends_on:
                visit(step.depends_on)
            order.append(step)

        for step in cls.steps:
            visit(step.name)
        return order


# ─── Registry ───────────────────────────────────────────────────────

_registry: dict[str, type[Workflow]] = {}


def register_workflow(cls: type[Workflow]) -> None:
    """Register a workflow class. Called during auto-discovery."""
    errors = cls.validate()
    if errors:
        for e in errors:
            log.error("workflow validation failed: %s", e)
        return
    key = f"{cls.trigger.namespace}:{cls.trigger.type}:{cls.trigger.phase}"
    if key in _registry:
        log.warning(
            "workflow trigger conflict: %s already registered by %s, "
            "overwriting with %s",
            key,
            _registry[key].__name__,
            cls.__name__,
        )
    _registry[key] = cls
    log.info("registered workflow: %s → %s", key, cls.__name__)


def get_workflow_for_event(event: dict[str, Any]) -> Optional[type[Workflow]]:
    """Find a workflow whose trigger matches this event."""
    key = f"{event.get('namespace')}:{event.get('type')}:{event.get('phase')}"
    cls = _registry.get(key)
    if cls and cls.trigger.matches(event):
        return cls
    return None


def list_workflows() -> dict[str, type[Workflow]]:
    """Return all registered workflows."""
    return dict(_registry)


def discover_workflows() -> int:
    """Auto-import all modules in the workflows package to trigger registration."""
    import workflows as pkg

    count = 0
    for importer, modname, ispkg in pkgutil.iter_modules(
        pkg.__path__, prefix="workflows."
    ):
        if modname == "workflows.base" or modname == "workflows.processor":
            continue
        try:
            mod = importlib.import_module(modname)
            for attr_name in dir(mod):
                attr = getattr(mod, attr_name)
                if (
                    isinstance(attr, type)
                    and issubclass(attr, Workflow)
                    and attr is not Workflow
                    and hasattr(attr, "trigger")
                ):
                    register_workflow(attr)
                    count += 1
        except Exception as e:
            log.error("failed to import workflow module %s: %s", modname, e)
    return count
