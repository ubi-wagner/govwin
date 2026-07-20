"""
================================================================================
Module: Workflow Base Classes (base.py)
================================================================================

WHO:    Used by all workflow definitions and the workflow processor.

WHAT:   Defines the contract every workflow definition must follow. A Workflow
        is a declarative job template — it does NOT execute anything itself.
        The event_processor reads the definition and drives execution.

        Provides: EventTrigger (matches system_events rows), StepType (enum
        of step execution strategies), Step (one unit of work), Workflow
        (base class with trigger + steps), and a registry for auto-discovery
        at boot time.

WHY:    Decouples workflow declaration from execution. Workflow authors define
        triggers, steps, and dependencies declaratively; the processor handles
        retry, timeout, event emission, and error handling uniformly.

HOW:    Subclasses set `trigger` and `steps` as class attributes. The
        discover_workflows() function auto-imports all modules in the
        workflows package and registers each Workflow subclass whose trigger
        passes validation. The processor calls get_workflow_for_event() on
        each new system_events row to find a matching workflow.

ERROR HANDLING:
    - validate() catches common definition mistakes (missing trigger,
      empty steps, broken depends_on, HITL_WAIT without wait_for)
    - Registration logs warnings on trigger conflicts (last-write-wins)
    - Auto-discovery catches import errors per-module without crashing

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: base classes, registry,
                           auto-discovery, topological step ordering
    PR #xxx (2026-05-22) — Hardened: comprehensive docstring header, added
                           validate() for CONDITION steps, improved logging
================================================================================
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
        # Never trigger or resume on a FAILED operation. A failed op still emits
        # a terminal phase='end' event (with error set + empty payload); matching
        # it spawns junk workflow instances with no inputs. (Launch Review #3.)
        if event.get("error"):
            return False
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
    # A TODO is a HITL_WAIT that also writes a row to the unified `tasks` ledger:
    # park-and-wait PLUS an assignee, a nudge cadence, and an entity reference.
    # The static step declares "this is a human task"; the per-instance payload
    # supplies the specifics (assignee, nudges, due, entity UUID) via the
    # task_* fields below, resolved through the same resolve_input() paths as
    # input_map. Completing the task resumes the instance from the next step.
    TODO = "todo"


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
    # ── TODO step fields (StepType.TODO) ──────────────────────────────────
    # All resolved per-instance via resolve_input() (payload.X / "literal"), so
    # the static template stays generic and the payload carries the specifics.
    task_type: Optional[str] = None          # e.g. "admin_approval", "content_publish"
    task_title: Optional[str] = None         # human-readable; resolved or literal
    assignee_role: Optional[str] = None      # role bucket, e.g. "payload.approverRole"
    assignee_user: Optional[str] = None      # specific user id (optional)
    entity_type: Optional[str] = None        # e.g. "content_pipeline"
    entity_ref: Optional[str] = None         # e.g. "payload.contentPipelineId"
    nudge_days: Optional[str] = None         # e.g. "payload.nudgeDays" -> [1,3,5]
    due_in_minutes: Optional[str] = None     # overrides timeout_minutes for the due date


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
        """Check the workflow definition for common mistakes.

        register_workflow() DROPS any workflow that returns errors here, so these are
        hard registration gates, not warnings. Guards:
          - trigger present, and NOT on system:workflow.* (the processor poll EXCLUDES
            exactly those to avoid self-triggering → such a workflow would never fire)
          - steps present; depends_on / on_timeout / on_failure name real steps
          - HITL_WAIT has wait_for; TODO has task_type + an assignee
          - every AI_INVOKE action is mapped in TOOL_ACTION_TO_ARCHETYPE (an unmapped
            action is a guaranteed silent skip — catch the typo at boot)
          - no depends_on cycle (a cycle makes step_execution_order() recurse forever)
          - input_map 'step.<name>...' refs a real step that is a TRANSITIVE depends_on
            ancestor (only depends_on defines order; a ref to a non-ancestor may resolve
            to null because that step has not run yet)
        """
        errors: list[str] = []
        trig = getattr(cls, "trigger", None)
        if trig is None:
            errors.append(f"{cls.__name__}: missing trigger")
        elif trig.namespace == "system" and str(trig.type).startswith("workflow."):
            errors.append(
                f"{cls.__name__}: trigger on 'system:{trig.type}' is excluded by the "
                f"processor poll filter (system:workflow.*) and would never fire"
            )
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
            # A TODO is a parameterized human gate: it must declare what kind of
            # task and who it's for, or the ledger row is meaningless. wait_for is
            # optional (a TODO usually resumes via task-completion, not an event).
            if step.step_type == StepType.TODO:
                if not step.task_type:
                    errors.append(
                        f"{cls.__name__}.{step.name}: todo step must define task_type"
                    )
                if not step.assignee_role and not step.assignee_user:
                    errors.append(
                        f"{cls.__name__}.{step.name}: todo step must define "
                        f"assignee_role or assignee_user"
                    )
            # An unmapped AI_INVOKE action is a guaranteed silent no-op (the dispatcher
            # safe-skips actions not in TOOL_ACTION_TO_ARCHETYPE). Reject at registration
            # so a new agent step can't be added without wiring its archetype. Lazy
            # import dodges the base<->processor import cycle; if the processor is not
            # importable, skip the check rather than crash discovery.
            if step.step_type == StepType.AI_INVOKE:
                try:
                    from workflows.processor import TOOL_ACTION_TO_ARCHETYPE as _MAP
                except Exception:
                    _MAP = None  # type: ignore[assignment]
                if _MAP is not None and step.action not in _MAP:
                    errors.append(
                        f"{cls.__name__}.{step.name}: AI_INVOKE action '{step.action}' "
                        f"not in TOOL_ACTION_TO_ARCHETYPE (would silently skip)"
                    )
            # on_timeout / on_failure must name a real step in this workflow,
            # or the declared escalation/compensation is a dead-end (gap 6).
            if step.on_timeout and step.on_timeout not in step_names:
                errors.append(
                    f"{cls.__name__}.{step.name}: on_timeout "
                    f"'{step.on_timeout}' not found in steps"
                )
            if step.on_failure and step.on_failure not in step_names:
                errors.append(
                    f"{cls.__name__}.{step.name}: on_failure "
                    f"'{step.on_failure}' not found in steps"
                )

        # depends_on cycle detection (GREY=on-stack, BLACK=done). A cycle would make
        # step_execution_order() recurse until RecursionError at execute time.
        by_name = {s.name: s for s in cls.steps}
        color: dict[str, int] = {}
        has_cycle = False

        def _visit(n: str) -> bool:
            color[n] = 1  # on-stack
            dep = by_name[n].depends_on
            if dep and dep in by_name:
                c = color.get(dep, 0)
                if c == 1:
                    return True
                if c == 0 and _visit(dep):
                    return True
            color[n] = 2  # done
            return False

        for _n in by_name:
            if color.get(_n, 0) == 0 and _visit(_n):
                errors.append(
                    f"{cls.__name__}: depends_on cycle detected involving step '{_n}'"
                )
                has_cycle = True
                break

        # input_map 'step.<name>' refs must name a real step that is a transitive
        # depends_on ancestor of the referencing step (guaranteed to have run). Skip
        # when a cycle was found — ancestor sets are undefined then.
        if not has_cycle:
            def _ancestors(name: str) -> set[str]:
                acc: set[str] = set()
                cur = by_name.get(name)
                dep = cur.depends_on if cur else None
                while dep and dep in by_name and dep not in acc:
                    acc.add(dep)
                    dep = by_name[dep].depends_on
                return acc

            for step in cls.steps:
                anc: Optional[set[str]] = None
                for key, path in (step.input_map or {}).items():
                    if not (isinstance(path, str) and path.startswith("step.")):
                        continue
                    parts = path.split(".")
                    ref = parts[1] if len(parts) >= 2 else ""
                    if ref not in step_names:
                        errors.append(
                            f"{cls.__name__}.{step.name}: input_map '{key}' references "
                            f"unknown step '{ref}' (in '{path}')"
                        )
                        continue
                    if ref == step.name:
                        errors.append(
                            f"{cls.__name__}.{step.name}: input_map '{key}' references "
                            f"itself ('{path}')"
                        )
                        continue
                    if anc is None:
                        anc = _ancestors(step.name)
                    if ref not in anc:
                        errors.append(
                            f"{cls.__name__}.{step.name}: input_map '{key}' references "
                            f"step '{ref}', which is not a (transitive) depends_on "
                            f"ancestor — its result may not be ready"
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

_registry: dict[str, list[type[Workflow]]] = {}


def register_workflow(cls: type[Workflow]) -> None:
    """Register a workflow class. Called during auto-discovery."""
    errors = cls.validate()
    if errors:
        for e in errors:
            log.error("workflow validation failed: %s", e)
        return
    key = f"{cls.trigger.namespace}:{cls.trigger.type}:{cls.trigger.phase}"
    _registry.setdefault(key, []).append(cls)
    log.info("registered workflow: %s → %s", key, cls.__name__)


def get_workflow_for_event(event: dict[str, Any]) -> Optional[type[Workflow]]:
    """Find a workflow whose trigger matches this event.

    Supports multiple workflows per trigger key — returns the first
    whose condition lambda matches the event payload.
    """
    key = f"{event.get('namespace')}:{event.get('type')}:{event.get('phase')}"
    candidates = _registry.get(key, [])
    for cls in candidates:
        if cls.trigger.matches(event):
            return cls
    return None


def get_all_workflows_for_event(event: dict[str, Any]) -> list[type[Workflow]]:
    """Find ALL workflows whose trigger matches this event."""
    key = f"{event.get('namespace')}:{event.get('type')}:{event.get('phase')}"
    candidates = _registry.get(key, [])
    return [cls for cls in candidates if cls.trigger.matches(event)]


def list_workflows() -> dict[str, type[Workflow]]:
    """Return all registered workflows."""
    return dict(_registry)


def all_registered_workflows() -> list[type[Workflow]]:
    """Return every registered Workflow subclass, de-duplicated by class name.

    The registry is keyed by trigger and holds a LIST per key (a file may define
    several templates; several may share a trigger). This flattens it to the
    distinct template classes — what the process_templates catalog sync and any
    admin listing iterate over.
    """
    seen: dict[str, type[Workflow]] = {}
    for candidates in _registry.values():
        for c in candidates:
            seen[c.__name__] = c
    return list(seen.values())


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
