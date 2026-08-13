"""Extract ground-truth facts for the agent-fabric narrative — imports every registered archetype
and introspects role_name / model / human_gate / tools, reads SCOPE + the ROLE one-liner from each
docstring, maps each to its AI_INVOKE action, and parses every workflow file for its trigger + the
agents its steps employ. Pure fact from source; no prose. PYTHONPATH=src .venv/bin/python ..."""
import ast
import inspect
import os
import re
import sys
import unittest.mock

sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from agents.fabric import AgentFabric, _ARCHETYPE_CLASSES
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE

ARCH_DIR = "src/agents/archetypes"
WF_DIR = "src/workflows"

action_of = {v: k for k, v in TOOL_ACTION_TO_ARCHETYPE.items()}  # archetype -> action (last wins)


def docmeta(cls):
    doc = inspect.getdoc(cls) or ""
    src = inspect.getsource(inspect.getmodule(cls))
    mdoc = (ast.get_docstring(ast.parse(src)) or "")  # module docstring often richer
    text = mdoc + "\n" + doc
    scope = "?"
    m = re.search(r"SCOPE:\s*([A-Za-z/ -]+?)(?:\.|\(|\n)", text)
    if m:
        scope = m.group(1).strip()
    elif re.search(r"PLATFORM-SCOPE|platform-scope|PLATFORM\b", text):
        scope = "PLATFORM"
    elif re.search(r"TENANT-SCOPE|tenant-bound|TENANT\b", text):
        scope = "TENANT"
    role = ""
    m = re.search(r"ROLE:\s*(.+?)(?:\n\n|\nSCOPE:|\nSAFETY:|\nTRIGGERS?:)", text, re.S)
    if m:
        role = re.sub(r"\s+", " ", m.group(1)).strip()
    if not role:
        # fall back to the first sentence of the module docstring after the banner
        body = re.sub(r"={3,}", "", mdoc)
        body = re.sub(r"^[\s\W]+", "", body)
        role = re.sub(r"\s+", " ", body).strip()[:240]
    return scope, role[:260]


print("=" * 30, "AGENTS", "=" * 30)
fabric = AgentFabric()
rows = []
for name in sorted(fabric._archetypes):
    cls = type(fabric._archetypes[name])
    try:
        inst = fabric._archetypes[name]
        model = getattr(inst, "model", "?")
        gate = getattr(inst, "human_gate", "?")
        try:
            tools = inst.tools
        except Exception:
            tools = [t.get("name") for t in (inst.get_tools() or [])]
    except Exception as e:
        model, gate, tools = "?", "?", [f"<err {e}>"]
    scope, role = docmeta(cls)
    rows.append((name, scope, model, gate, action_of.get(name, "—"), tools, role))

for name, scope, model, gate, action, tools, role in rows:
    print(f"\n### {name}")
    print(f"scope={scope} | model={model} | human_gate={gate} | action={action}")
    print(f"tools={tools}")
    print(f"role={role}")

print(f"\nTOTAL AGENTS: {len(rows)} (registry classes: {len(_ARCHETYPE_CLASSES)})")

print("\n" + "=" * 30, "WORKFLOWS", "=" * 30)
for fn in sorted(os.listdir(WF_DIR)):
    if not fn.endswith(".py") or fn in ("__init__.py", "base.py", "processor.py"):
        continue
    src = open(os.path.join(WF_DIR, fn)).read()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            # trigger: find EventTrigger(namespace=,type=,phase=) in the class
            csrc = ast.get_source_segment(src, node) or ""
            trig = re.search(r'namespace\s*=\s*["\']([^"\']+)["\'][\s\S]{0,120}?type\s*=\s*["\']([^"\']+)["\'][\s\S]{0,80}?phase\s*=\s*["\']([^"\']+)["\']', csrc)
            trigger = f"{trig.group(1)}:{trig.group(2)}:{trig.group(3)}" if trig else "—"
            # AI_INVOKE actions in step order
            actions = re.findall(r'action\s*=\s*["\'](tool\.[a-z_.]+)["\']', csrc)
            agents = [TOOL_ACTION_TO_ARCHETYPE.get(a, "?") for a in actions]
            steptypes = re.findall(r'StepType\.(\w+)', csrc)
            if trigger == "—" and not actions:
                continue
            print(f"\n### {node.name}  ({fn})")
            print(f"trigger={trigger}")
            print(f"steptypes={steptypes}")
            print(f"agents={list(zip(actions, agents))}")
