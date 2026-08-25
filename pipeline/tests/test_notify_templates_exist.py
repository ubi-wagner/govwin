"""Every workflow NOTIFY step names a template the CRM can actually render.

A NOTIFY step names a template as a STRING; the CRM defines one in a different service with a
different database. Nothing compared the two, so eight of the fifteen named templates existed
nowhere — `render_template()` returned None and the listener emitted `system:notification.failed`
instead of sending mail. Six of the eight had already been requested in the sandbox corpus.

This has now broken twice. The `TEMPLATES.update({...})` block in `services/cms/src/templates.py`
carries the note from the last time: *"absence meant rfp_admin stopped being notified (the 052
regression)"*. It recurs because the two halves cannot see each other and neither side fails at
boot — the workflow registers fine, the CRM starts fine, and the only symptom is mail that never
arrives.

The registry is assembled in two pieces (`TEMPLATES = {...}` then `TEMPLATES.update({...})`), so it
is read with the AST rather than a regex: a regex over `'name': lambda` happens to catch both
today and would silently miss a third piece.

Companion: `frontend/scripts/audit-automation-spine.mjs` join 7, which reports the same thing
alongside the rest of the spine.
"""
from __future__ import annotations

import ast
import os
import sys

import pytest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CMS_TEMPLATES = os.path.join(REPO, "services", "cms", "src", "templates.py")
sys.path.insert(0, os.path.join(REPO, "pipeline", "src"))


def _crm_template_names() -> set[str]:
    """Every key the CRM's TEMPLATES registry ends up holding, across both assembly steps."""
    tree = ast.parse(open(CMS_TEMPLATES, encoding="utf-8").read())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "TEMPLATES":
                    names |= {k.value for k in node.value.keys if isinstance(k, ast.Constant)}
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "update"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "TEMPLATES"
        ):
            for arg in node.args:
                if isinstance(arg, ast.Dict):
                    names |= {k.value for k in arg.keys if isinstance(k, ast.Constant)}
    return names


def _notify_steps():
    from workflows.base import discover_workflows, all_registered_workflows, StepType

    discover_workflows()
    out = []
    for wf in all_registered_workflows():
        for step in wf.steps:
            if step.step_type != StepType.NOTIFY:
                continue
            raw = (step.input_map or {}).get("template")
            if raw is None:
                continue
            out.append((wf.__name__, step.name, str(raw).strip("\"'")))
    return out


@pytest.mark.skipif(not os.path.exists(CMS_TEMPLATES), reason="CMS service not in this checkout")
def test_the_registry_reader_sees_both_assembly_steps():
    # The instrument before the finding: reading only the first `TEMPLATES = {...}` yields 11 and
    # would report every template added by the `.update()` block as missing.
    names = _crm_template_names()
    assert "application_accepted" in names, "missed the initial TEMPLATES dict"
    assert "rfp_ready_for_curation" in names, "missed the TEMPLATES.update() block"
    assert len(names) > 20


@pytest.mark.skipif(not os.path.exists(CMS_TEMPLATES), reason="CMS service not in this checkout")
def test_every_notify_step_has_a_renderer():
    available = _crm_template_names()
    missing = []
    for wf, step, template in _notify_steps():
        # A template resolved from the instance payload at run time cannot be checked statically.
        if template.startswith("payload.") or template.startswith("step."):
            continue
        if template not in available:
            missing.append(f"{wf}.{step} → '{template}'")

    assert not missing, (
        "NOTIFY steps naming a template the CRM cannot render — each one emits "
        "system:notification.failed instead of sending mail:\n  "
        + "\n  ".join(missing)
        + "\n\nDefine each in services/cms/src/templates.py (TEMPLATES.update block)."
    )


@pytest.mark.skipif(not os.path.exists(CMS_TEMPLATES), reason="CMS service not in this checkout")
def test_the_check_would_catch_a_missing_one():
    # A guard that has never failed proves nothing. Assert the property directly against a name
    # that is certainly absent, so this file cannot pass by finding nothing to check.
    assert "definitely_not_a_real_template_xyz" not in _crm_template_names()
    assert _notify_steps(), "no NOTIFY steps found — the workflow registry did not load"
