"""
================================================================================
Did the cohort actually run?  (the third signal — B17)
================================================================================
A workflow that ends in a "reviewed" verdict has two steps that must NOT depend on
each other:

  · the AI cohort — advisory, and allowed to safe-skip. No key, rate-limited, fabric
    absent, archetype unmapped: it returns nothing and the workflow carries on. That
    is the no-dead-end invariant and it is not negotiable — a dead agent must never
    strand a customer's workflow.

  · the record ACTION — hard, independent (`depends_on=None`), and the thing that
    stamps the verdict a human or an auto-gate later reads.

Because the record step may not read the agent's result (the input-map-ancestor rule),
it used to assert the verdict from a literal: `status='reviewed'`, `recorded_by=
'advisory_manager'`. So a cohort that never ran was indistinguishable from a cohort
that ran and found nothing — and on the portal gate, "found nothing" is exactly what
authorizes an automatic advance. Silence read as a pass.

The way out is neither to couple the steps nor to keep guessing: it is a THIRD signal
that is about EXECUTION rather than about output. The engine already records one —
`process_instances.step_status`, its own map of what each step did. This module turns
that map into a verdict.

WHY THIS IS NOT AN INPUT-MAP DEPENDENCY. The record step still declares no `depends_on`
and still maps nothing from the cohort's results. What it receives is the ENGINE's
account of which steps ran, injected by the engine itself (`_ai_step_status`, see
`processor._execute_action`). It carries no agent output and cannot: it is a map of
step name → one of pending/running/completed/failed/skipped. An action may learn that
the reviewer ran; it still cannot learn what the reviewer said. That is the whole point
— it is the difference between provenance and content.

USE: declare `_ai_step_status=None` in an action's signature and the engine fills it in.
An action that does not declare it is unaffected (the engine injects by signature, not
by blanket kwarg), so this is additive to every existing action.
================================================================================
"""
from typing import Optional

# What the engine writes into step_status. Only 'completed' is evidence the step ran to
# a result; 'skipped' is precisely the safe-skip this whole module exists to detect.
_RAN = "completed"

# The three verdicts. `unverified` is deliberately distinct from `not_reviewed`: one says
# "the cohort did not run", the other says "nobody can tell whether it ran". Collapsing
# them would recreate the bug in a smaller form.
REVIEWED = "reviewed"
NOT_REVIEWED = "not_reviewed"
UNVERIFIED = "unverified"


def cohort_verdict(ai_step_status: Optional[dict]) -> tuple[str, bool, str]:
    """Decide whether the agent cohort actually ran, from the engine's own step record.

    Returns `(verdict, ran, evidence)`:
      · `verdict` — one of REVIEWED / NOT_REVIEWED / UNVERIFIED
      · `ran`     — True only for REVIEWED; the boolean a caller gates a write on
      · `evidence` — one short human sentence naming what was observed, for the ledger
                     and for the person standing at the gate

    Never raises: a malformed map degrades to UNVERIFIED, which is the conservative
    answer everywhere it is consumed (a human closes the gate rather than a machine).
    """
    if ai_step_status is None:
        return UNVERIFIED, False, "the engine supplied no step record for this run"
    if not isinstance(ai_step_status, dict):
        return UNVERIFIED, False, "the engine step record was not readable"
    if not ai_step_status:
        # A workflow with no AI_INVOKE steps at all. Reporting 'reviewed' here would be
        # the original bug with extra steps; reporting 'not_reviewed' would libel a
        # workflow that was never meant to have a cohort. Neither — say so plainly.
        return UNVERIFIED, False, "this workflow declares no agent cohort"

    ran_steps = sorted(n for n, s in ai_step_status.items() if s == _RAN)
    total = len(ai_step_status)
    if ran_steps:
        return (
            REVIEWED,
            True,
            f"{len(ran_steps)} of {total} cohort step(s) completed: {', '.join(ran_steps)}",
        )

    seen = ", ".join(f"{n}={s}" for n, s in sorted(ai_step_status.items()))
    return NOT_REVIEWED, False, f"no cohort step completed ({seen})"
