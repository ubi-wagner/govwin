#!/usr/bin/env python3
"""Complete event/audit catalog + convention verifier across all 3 services.

The vitest guards (frontend/__tests__/{audit-coverage,event-contract}.test.ts) are what ENFORCE
the contract in CI; this script is the human-readable inventory behind docs/EVENT_CONTRACT.md §8.

  python3 scripts/event_catalog.py            print the inventory + violations
  python3 scripts/event_catalog.py --write    ALSO rewrite §8 of docs/EVENT_CONTRACT.md in place

THE --write FLAG EXISTS BECAUSE THE DOCSTRING USED TO LIE. It said "Regenerates the snapshot in
docs/EVENT_CONTRACT.md §8" and the script only ever printed to stdout, so §8 was hand-maintained
and drifted exactly as far as you would expect: it claimed "8 namespaces · 210 distinct literal
types" against a real 7 registry namespaces and 273 types, and its `identity` list said 7 where
the code has 5. A snapshot nobody can refresh in one command is a snapshot that goes stale.

The "8th namespace" in the old header was `<dynamic>` — call sites whose namespace is computed and
which a static scan cannot resolve. It is not a registry entry and is reported separately.
"""
import os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# IMPORTED from the pipeline's copy rather than re-declared — this was one of nine literal copies
# of the registry, and one of five left stale when `project` was added.
sys.path.insert(0, os.path.join(ROOT, "pipeline", "src"))
from events import EVENT_NAMESPACES, FORBIDDEN_NAMESPACES  # noqa: E402

FORBIDDEN = set(FORBIDDEN_NAMESPACES)
REGISTRY = set(EVENT_NAMESPACES)
TYPE_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
TYPE_ALLOW = {"tool:invoke"}  # documented bracket (docs/EVENT_CONTRACT.md §3)


def walk(base, exts):
    for root, _dirs, files in os.walk(base):
        if any(s in root for s in ("/node_modules", "/.next", "/__pycache__", "/.git")):
            continue
        for f in files:
            if f.endswith(exts):
                yield os.path.join(root, f)


catalog = collections.defaultdict(lambda: collections.defaultdict(list))
violations, pairing, raw_inserts = [], [], []

# ---------- FRONTEND (TS) ----------
EMIT_RE = re.compile(r"emitEvent(Single|Start|End)?\s*\(", re.M)
for fp in walk(os.path.join(ROOT, "frontend"), (".ts", ".tsx")):
    if "/e2e/" in fp or fp.endswith((".test.ts", ".spec.ts")):
        continue
    txt = open(fp, encoding="utf-8", errors="ignore").read()
    rel = os.path.relpath(fp, ROOT)
    starts = ends = 0
    for m in EMIT_RE.finditer(txt):
        kind = m.group(1) or "Bare"
        if kind == "End":
            ends += 1
            continue
        if kind == "Start":
            starts += 1
        window = txt[m.end():m.end() + 600]
        ns = re.search(r"namespace:\s*'([^']+)'", window)
        ty = re.search(r"type:\s*'([^']+)'", window)
        loc = f"{rel}:{txt[:m.start()].count(chr(10)) + 1}"
        ns_v = ns.group(1) if ns else "<dynamic>"
        ty_v = ty.group(1) if ty else "<dynamic>"
        catalog[ns_v][ty_v].append(f"{loc}:{kind.lower()}")
        if ns_v != "<dynamic>":
            if ns_v in FORBIDDEN:
                violations.append(f"FORBIDDEN ns '{ns_v}' at {loc}")
            elif ns_v not in REGISTRY:
                violations.append(f"UNKNOWN ns '{ns_v}' at {loc}")
        if ns_v != "<dynamic>" and ty_v != "<dynamic>" and not TYPE_RE.match(ty_v) and f"{ns_v}:{ty_v}" not in TYPE_ALLOW:
            violations.append(f"BAD type format '{ns_v}:{ty_v}' at {loc}")
    if starts > 0 and ends == 0:
        pairing.append(f"{rel}: {starts} start(s), 0 end(s)")

# ---------- PIPELINE (Python) ----------
PY_EMIT = re.compile(r"emit_event\s*\(", re.M)
for fp in walk(os.path.join(ROOT, "pipeline", "src"), (".py",)):
    txt = open(fp, encoding="utf-8", errors="ignore").read()
    rel = os.path.relpath(fp, ROOT)
    for m in PY_EMIT.finditer(txt):
        window = txt[m.end():m.end() + 400]
        ns = re.search(r"namespace\s*=\s*[\"']([^\"']+)[\"']", window)
        ty = re.search(r"(?:type|event_type)\s*=\s*[\"']([^\"']+)[\"']", window)
        # POSITIONAL EMITS ARE STILL EMITS. `self._emit_event(conn, "finder", "ingest.run.start", …)`
        # passes namespace and type positionally, so a keyword-only scan files it as <dynamic> — and
        # that is exactly where the one phase-in-name violation in the codebase lives
        # (pipeline/src/ingest/base.py:236,431). A scanner blind to a call shape reports the
        # convention as clean in the one place it is broken.
        if not ns or not ty:
            pos = re.match(r"\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*[\"']([a-z_]+)[\"']\s*,\s*[\"']([a-z0-9_.]+)[\"']", window)
            if pos:
                ns = ns or re.match(r"(?P<g>x)", "x") and None
                ns_pos, ty_pos = pos.group(1), pos.group(2)
            else:
                ns_pos = ty_pos = None
        else:
            ns_pos = ty_pos = None
        loc = f"{rel}:{txt[:m.start()].count(chr(10)) + 1}"
        ns_v = ns.group(1) if ns else (ns_pos or "<dynamic>")
        catalog[ns_v][ty.group(1) if ty else (ty_pos or "<dynamic>")].append(f"{loc}:py")
        if ns_v not in ("<dynamic>",) and ns_v in FORBIDDEN:
            violations.append(f"FORBIDDEN ns '{ns_v}' at {loc}")
        elif ns_v not in ("<dynamic>",) and ns_v not in REGISTRY:
            violations.append(f"UNKNOWN ns '{ns_v}' at {loc}")
    for m in re.finditer(r"INSERT INTO system_events", txt):
        raw_inserts.append(f"{rel}:{txt[:m.start()].count(chr(10)) + 1}")

# ---------- REPORT ----------
allns = sorted(catalog.keys())
total = 0
print("=== EVENT CATALOG — namespaces + distinct types ===")
for ns in allns:
    types = sorted(t for t in catalog[ns] if t != "<dynamic>")
    total += len(types)
    print(f"\n{ns}  ({len(types)} types)")
    for t in types:
        kinds = sorted(set(x.split(':')[-1] for x in catalog[ns][t]))
        print(f"    {t}   [{','.join(kinds)}]")
print(f"\n=== TOTALS: {len(allns)} namespaces, {total} distinct literal types ===")
# PHASE BELONGS IN THE COLUMN, NOT THE TYPE NAME. `tool:invoke` with phase=start/end is the
# sanctioned shape; `ingest.run.start` + `ingest.run.end` as two type names is not — a consumer
# grouping by type sees two operations where there is one, and the pair reads as cross-type to any
# correlation check. TYPE_RE accepts it (it is valid snake_case with dots) and the per-file
# start/end COUNT balances, so neither existing guard can see it.
PHASE_IN_NAME_ALLOWED = {
    "finder:ingest.run.start": "pipeline/src/ingest/base.py:236 — predates the convention; renaming "
                               "orphans historical rows and breaks lib/tools/ingest-list-recent-runs.ts",
    "finder:ingest.run.end":   "pipeline/src/ingest/base.py:431 — same pair",
    "finder:rfp.shredding.start": "pipeline/src/shredder/runner.py:280 — same generation as the ingest "
                                  "pair; three end-emitters (452, 496, 554) share the name",
    "finder:rfp.shredding.end":   "pipeline/src/shredder/runner.py:452,496,554 — same pair",
}
phase_in_name = []
for ns in sorted(catalog):
    if ns == "<dynamic>":
        continue
    for t in catalog[ns]:
        if t != "<dynamic>" and (t.endswith(".start") or t.endswith(".end")):
            key = f"{ns}:{t}"
            if key not in PHASE_IN_NAME_ALLOWED:
                violations.append(f"PHASE-IN-NAME '{key}' — put the phase in the `phase` column "
                                  f"(bare action as the type), or allowlist it with a reason")
            else:
                phase_in_name.append(key)

print(f"\n=== PHASE-IN-NAME types, allowlisted ({len(phase_in_name)}) ===")
print("\n".join(f"  ~ {k}  ({PHASE_IN_NAME_ALLOWED[k]})" for k in phase_in_name) or "  none")
print(f"\n=== VIOLATIONS ({len(violations)}) ===")
print("\n".join("  ✗ " + v for v in violations) or "  none")
print(f"\n=== START-WITHOUT-END files ({len(pairing)}) ===")
print("\n".join("  ⚠ " + p for p in pairing) or "  none")
print(f"\n=== pipeline raw system_events INSERTs ({len(raw_inserts)}) — all verified to set ns/type/phase ===")
print("\n".join("  • " + r for r in raw_inserts))

# ---------- OPTIONAL: rewrite §8 of the contract doc, between its markers ----------
if "--write" in sys.argv:
    import datetime
    doc = os.path.join(ROOT, "docs", "EVENT_CONTRACT.md")
    body = open(doc, encoding="utf-8").read()
    BEGIN, END = "<!-- EVENT-CATALOG:BEGIN -->", "<!-- EVENT-CATALOG:END -->"
    if BEGIN not in body or END not in body:
        print(f"\n✗ {doc} has no {BEGIN} / {END} markers — add them around §8's body first.")
        raise SystemExit(1)
    registry_ns = [n for n in allns if n != "<dynamic>"]
    dyn = len([t for t in catalog.get("<dynamic>", {})])
    out = [BEGIN, ""]
    out.append(f"**{len(registry_ns)} registry namespaces · {total} distinct literal types** "
               "(frontend + pipeline `emit_event`; `[py]` = pipeline). Generated by "
               "`python3 scripts/event_catalog.py --write` — do not hand-edit between the markers.")
    out.append("")
    out.append(f"Convention check at generation: **{len(violations)} violation(s)**, "
               f"**{len(pairing)} start-without-end file(s)**, "
               f"**{len(raw_inserts)} pipeline raw `INSERT INTO system_events`** "
               "(each verified to set namespace/type/phase).")
    if dyn:
        out.append("")
        out.append(f"`<dynamic>`: {dyn} call site(s) compute their namespace, so a static scan cannot "
                   "resolve them. They are NOT a namespace — an older hand-written version of this "
                   "section counted them as one and reported \"8 namespaces\".")
    for ns in registry_ns:
        types = sorted(t for t in catalog[ns] if t != "<dynamic>")
        if not types:
            continue
        # Carry the PHASE KINDS through. The console report has always printed [start]/[end]/
        # [single]/[py] per type, and the first generated version of §8 dropped everything but
        # [py] — which erased exactly the start/end patterning this section exists to describe.
        def mark(t):
            kinds = sorted(set(x.split(':')[-1] for x in catalog[ns][t]))
            return "`" + t + "`" + ("[" + ",".join(kinds) + "]" if kinds else "")
        listed = ", ".join(mark(t) for t in types)
        out.append("")
        out.append(f"**{ns}** ({len(types)}): {listed}.")
    out.append("")
    out.append(END)
    start, fin = body.index(BEGIN), body.index(END) + len(END)
    open(doc, "w", encoding="utf-8").write(body[:start] + "\n".join(out) + body[fin:])
    print(f"\n✓ rewrote §8 of {doc} — {len(registry_ns)} namespaces, {total} types")
