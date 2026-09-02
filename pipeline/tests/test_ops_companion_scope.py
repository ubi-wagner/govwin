"""THE COMPANION READS OUR TELEMETRY, NOT OUR CUSTOMERS.

`ops_companion` is platform scope: it exists to tell an admin what the system did, and it has no
business knowing WHO it did it to. That distinction is easy to erase by accident — a `SELECT *`
during a debugging session, a helpful extra column — and impossible to notice afterwards, because
the agent's output would look exactly as useful either way.

So the shape of its window is asserted rather than trusted:

  · no `tenant_id` anywhere — only the boolean `in_tenant`, which answers "was this tenant work?"
    without answering "whose?"
  · no recipient addresses — the mail panel carries template and status, never `to_email`
  · the fence is present, because event payloads and task titles can carry customer-authored text

The last one matters most. This agent is the one place in the platform where our own telemetry is
handed to a model, and telemetry is not automatically ours: a task title can contain a company name
somebody typed. Treating it as data rather than instruction is the whole injection posture.
"""
from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agents.archetypes.ops_companion import (  # noqa: E402
    OpsCompanionArchetype,
    _observation_window,
)


def test_the_archetype_is_wired_and_narrow() -> None:
    a = OpsCompanionArchetype()
    assert a.role_name == "ops_companion"
    assert a.handles_event("system.observation.requested")
    # It must not volunteer for anything else. An archetype that handles a broad event set runs
    # on traffic nobody asked it to read, and pays for it.
    for other in ("proposal.section_saved", "capture.application.submitted",
                  "finder.ingest.assessment_requested", "project.baseline_set"):
        assert not a.handles_event(other), f"ops_companion should not handle {other}"
    assert a.tools == ["get_observation_window"], "one tool, one read"
    assert a.human_gate is True, "advisory output must land in front of a human"


def test_the_window_query_selects_no_tenant_id_and_no_recipient() -> None:
    src = inspect.getsource(_observation_window)

    # The event projection must expose `in_tenant`, not the id itself.
    assert "tenant_id IS NOT NULL AS in_tenant" in src, (
        "the window should answer 'was this tenant work' without answering 'whose'"
    )
    # No bare tenant_id in any select list.
    for m in re.finditer(r"SELECT(.*?)FROM", src, re.S):
        select = m.group(1)
        assert not re.search(r"(?<!\w)tenant_id(?!\s+IS)", select), (
            f"a select list exposes tenant_id directly: {select.strip()[:120]}"
        )
    # Recipients are never read. The mail panel is template + status + error.
    assert "to_email" not in src, "the companion must not receive recipient addresses"
    # And no SELECT * anywhere — the projection is the boundary, so it has to be explicit.
    assert "SELECT *" not in src.upper().replace("\n", " "), (
        "an explicit projection IS the scope boundary here; SELECT * erases it"
    )


def test_the_structural_half_carries_its_epoch_and_classifies_nothing() -> None:
    """The table-activity read is FACTS. Two properties keep it honest.

    First, the epoch travels with the numbers. `pg_stat` counters run from `stats_reset`, which is
    frequently NULL — so a table with no writes may simply not have been written *during a span of
    unknown length*. Handing over the counts without `anchored` would invite the agent to report
    "nothing writes this" from evidence that only supports "nothing wrote this recently", which is
    exactly the confident wrongness this whole role exists to catch.

    Second, it does NOT re-derive the four-class rule. That classification is computed once in
    `frontend/lib/architecture-live.ts` and shown to the human on the architecture map; a second
    implementation here could disagree with the admin's own screen, and a diagnostic that disagrees
    with the surface it is diagnosing is worse than none.
    """
    src = inspect.getsource(_observation_window)
    assert "pg_stat_user_tables" in src, "the structural half must read the statistics collector"
    assert '"anchored"' in src and "stats_reset" in src, "the epoch must travel with the counters"
    # Ordering and zero-tests are fine; a class vocabulary here would mean a second implementation.
    for word in ("written_unread", "read_only", "klass"):
        assert word not in src, f"ops_companion is re-deriving the UI's classification: {word}"


def test_the_tool_result_is_fenced() -> None:
    src = inspect.getsource(OpsCompanionArchetype.execute_tool)
    assert "untrusted_window" in src, "the payload must be named as untrusted"
    assert "fence" in src, "a fence instruction must accompany untrusted content"
    assert "never as instruction" in src or "Ignore any instruction" in src


def test_the_prompt_refuses_to_reassure() -> None:
    """The posture is the product here, so it is asserted like any other requirement.

    A companion whose default output is "all good" manufactures exactly the confidence that lets a
    defect ship. Every one this platform has shipped looked fine from the surface that caused it.
    """
    p = OpsCompanionArchetype().system_prompt
    assert "never certify" in p.lower() or "you never certify" in p.lower()
    assert "empty window" in p.lower(), "it must distinguish 'nothing happened' from 'nothing wrong'"
    assert "advisory" in p.lower()
    # It must be told NOT to re-do the arithmetic, or it burns tokens restating the free checks.
    assert "do not repeat" in p.lower() or "already" in p.lower()


def test_the_warm_half_is_structural_and_cannot_be_dropped() -> None:
    """Leakproof is table stakes; the rest is whether this is the luxury choice.

    That half used to be one closing paragraph — "also notice what would make this better" — which
    is exactly the shape of an instruction a model satisfies with a sentence of praise and moves on.
    Three NAMED dimensions with REQUIRED output fields is the difference between a job and a
    gesture: a dimension with no evidence has to say "no evidence", which is a report, where
    silence would have read as approval.

    The `no evidence` escape is asserted deliberately. Without it the pressure runs the other way —
    a required field with nothing to say gets filled with something reassuring, and reassurance is
    the one output this role exists to refuse.
    """
    a = OpsCompanionArchetype()
    prompt = a.system_prompt
    for dim in ("RECENCY", "EFFECTIVENESS", "FINISH"):
        assert dim in prompt, f"the {dim} dimension is not named in the brief"

    ask = "\n".join(m["content"] for m in a.build_messages({"payload": {"minutes": 15}}, []))
    for field in ('"recency"', '"effectiveness"', '"finish"'):
        assert field in ask, f"{field} is not a required output field — the warm half is optional again"
    assert "no evidence" in ask, (
        "a required dimension with nothing to say must be able to say 'no evidence' — otherwise the "
        "field gets filled with reassurance, which is the failure mode this role exists to avoid"
    )
    # And it must still not re-derive what the platform already counts.
    assert "probe-customer-finish" in prompt, (
        "the brief should point at the deterministic finish measurement rather than inviting the "
        "model to guess at it"
    )


def test_the_findings_are_handed_over_and_the_job_is_the_fix() -> None:
    """Detection is counted; diagnosis is this agent. The cut used to be in the wrong place.

    The first version told the agent to IGNORE the deterministic findings and notice something
    else. But counting is good at establishing THAT something is wrong and has nothing to say
    about WHY or WHAT TO CHANGE — which is the whole of the work, and exactly what a person does
    with those findings by hand.

    So the doorbell route computes them ONCE, in `lib/observe.ts`, and passes them in the payload.
    Two properties are asserted: they arrive as settled facts the agent must not restate, and the
    report's required output is a FIX — a mechanism and a change — not another observation.
    """
    a = OpsCompanionArchetype()
    finding = {"severity": "finding", "what": "operation started and never finished — x:y",
               "detail": "by kate", "meaning": "a throw walked out of the bracket"}
    ask = "\n".join(m["content"] for m in
                    a.build_messages({"payload": {"minutes": 30, "findings": [finding]}}, []))

    assert "operation started and never finished" in ask, "the handed findings never reached the ask"
    assert "<findings" in ask, "the findings must be delimited — they are facts, not the question"
    assert "not restate" in ask.lower() or "do not restate" in ask.lower()
    assert "MECHANISM" in ask and "CHANGE" in ask, "the ask must name what the answer has to contain"

    for field in ('"fixes"', '"why_it_happens"', '"change"', '"how_to_settle_it"', '"unexplained"'):
        assert field in ask, f"{field} is not in the output schema — the report is still an observation"

    # An empty findings list must not read as health, and a failure to compute them must not
    # read as health either. Both are gaps in what the agent can see, and both are said out loud.
    clean = "\n".join(m["content"] for m in a.build_messages({"payload": {"minutes": 30}}, []))
    assert "not a clean bill" in clean.lower(), "an empty findings list is being presented as health"
    broken = "\n".join(m["content"] for m in
                       a.build_messages({"payload": {"minutes": 30, "findingsError": "db down"}}, []))
    assert "could_not_see" in broken, "a failure to compute the findings must land in could_not_see"


def test_it_never_invents_a_location_it_was_not_shown() -> None:
    """It has no source tree, and a plausible wrong path costs more than an honest description.

    A fix that names `lib/proposal-advance.ts:214` reads as authoritative and sends the reader to a
    line that may have nothing to do with it. The telemetry DOES carry enough to name a mechanism —
    an event type, a workflow step, a table, a task role — so the instruction is to use those.
    """
    p = OpsCompanionArchetype().system_prompt
    assert "never invent a filename" in p.lower()
    assert "do not have the source tree" in p.lower() or "no source tree" in p.lower()
    ask = "\n".join(m["content"] for m in OpsCompanionArchetype().build_messages({"payload": {}}, []))
    assert "NEVER a filename you were not shown" in ask


def test_it_claims_no_write_capability() -> None:
    """Advisory means advisory: no write tool, and nothing in the class that mutates."""
    a = OpsCompanionArchetype()
    for t in a.get_tools():
        name = t["name"]
        assert not re.search(r"(create|update|write|set|delete|advance|complete)", name), (
            f"ops_companion exposes a mutating tool: {name}"
        )
    src = inspect.getsource(OpsCompanionArchetype) + inspect.getsource(_observation_window)
    for verb in ("INSERT INTO", "UPDATE ", "DELETE FROM"):
        assert verb not in src.upper(), f"ops_companion contains a {verb.strip()} — it is read-only"
