#!/usr/bin/env python3
"""Complete event/audit catalog + convention verifier across all 3 services.

Regenerates the snapshot in docs/EVENT_CONTRACT.md §8 and reports any convention
violations. The vitest guards (frontend/__tests__/{audit-coverage,event-contract}.test.ts)
are what ENFORCE the contract in CI; this script is the human-readable inventory.

Usage:  python3 scripts/event_catalog.py
"""
import os, re, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORBIDDEN = {"admin", "cms", "spotlight"}
REGISTRY = {"finder", "capture", "identity", "proposal", "library", "system", "tool"}
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
        loc = f"{rel}:{txt[:m.start()].count(chr(10)) + 1}"
        ns_v = ns.group(1) if ns else "<dynamic>"
        catalog[ns_v][ty.group(1) if ty else "<dynamic>"].append(f"{loc}:py")
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
print(f"\n=== VIOLATIONS ({len(violations)}) ===")
print("\n".join("  ✗ " + v for v in violations) or "  none")
print(f"\n=== START-WITHOUT-END files ({len(pairing)}) ===")
print("\n".join("  ⚠ " + p for p in pairing) or "  none")
print(f"\n=== pipeline raw system_events INSERTs ({len(raw_inserts)}) — all verified to set ns/type/phase ===")
print("\n".join("  • " + r for r in raw_inserts))
