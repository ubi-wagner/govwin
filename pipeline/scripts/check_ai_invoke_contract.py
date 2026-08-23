#!/usr/bin/env python3
"""
THE AI_INVOKE INPUT CONTRACT — does every key a workflow READS actually get WRITTEN?

WHY THIS LENS EXISTS. A declarative `AI_INVOKE` step names its inputs as payload paths
(`"voice": "payload.voice"`). The engine resolves those against the trigger event and hands the
result to the agent. If the emitter never writes that key, `resolve_input` returns None — and the
step runs anyway, with a hole in its input. Nothing raises. Nothing is logged as wrong. A failed or
degraded AI_INVOKE is a SAFE SKIP by design (workflows must never dead-end), which is precisely what
makes this class of defect invisible: a broken input contract and a working one are indistinguishable
from the workflow's own point of view.

`validate()` catches an AI_INVOKE whose ACTION is unmapped, at boot. Nothing catches an AI_INVOKE
whose INPUTS are unmapped, ever. This closes that.

It found B84 on its first run: both Proposal Studio phases read `payload.voice`, and
`requestReviewPhase` — the one canonical emitter for their trigger — never wrote it. Every Studio
draft ran in the house voice while the full-draft button, on the same proposal with the same
persisted `proposals.voice`, ran in the tenant's.

HOW IT DECIDES — and what it deliberately refuses to conclude.

The reference is not the emitter SOURCE (a regex over TypeScript call sites is fragile and would
have its own bugs); it is `system_events` — the payloads real emitters really wrote. That makes the
check evidence rather than inference.

The cost of that choice is the honest part: a trigger nobody has ever fired has no evidence, so this
reports it as UNCOVERED and exits non-zero-worthy only for real misses. An uncovered trigger is not
passing. It is unmeasured, and the fix is to fire it, not to trust it.

One more caveat it prints rather than hides: a key can be present-but-null in every observed payload,
which reads as "written" here. Presence is the contract this checks; a key whose emitter always
writes null is a weaker signal and is called out separately.

A MISS IS A LEAD, NOT A VERDICT — confirm it against the emitter before believing it. Because the
evidence is historical emissions, a miss has two possible causes and they look identical: the emitter
genuinely never writes the key, or the emitter writes it NOW and every stored payload predates that.
So each miss prints when its trigger was last fired; an old timestamp means "re-fire it, then look
again", and a recent one means the gap is real. B84 was confirmed by reading `requestReviewPhase` and
resolving a stored payload through the engine's own `resolve_inputs` — not by trusting this output.

Usage:
    PYTHONPATH=src DATABASE_URL=... python3 scripts/check_ai_invoke_contract.py [--json]

Exit: 0 clean, 1 at least one MISS, 2 could not run.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


async def main() -> int:
    try:
        import asyncpg
    except ImportError:
        print("asyncpg not installed", file=sys.stderr)
        return 2

    logging.disable(logging.CRITICAL)  # registration chatter is not the output
    from workflows.base import (  # noqa: PLC0415 — after sys.path
        StepType,
        _registry,
        all_registered_workflows,
        discover_workflows,
    )

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL required", file=sys.stderr)
        return 2

    discover_workflows()
    trigger_of: dict[str, str] = {}
    for key, cands in _registry.items():
        for c in cands:
            trigger_of.setdefault(c.__name__, key)

    # Every workflow that carries at least one AI_INVOKE, and the payload keys its steps read.
    targets = []
    for c in all_registered_workflows():
        steps = [s for s in c.steps if getattr(s, "step_type", None) == StepType.AI_INVOKE]
        if not steps:
            continue
        reads: dict[str, list[str]] = {}
        for s in steps:
            for path in (s.input_map or {}).values():
                # A quoted literal in an input_map is a constant, not a payload read.
                if isinstance(path, str) and path.startswith("payload."):
                    reads.setdefault(path[len("payload."):], []).append(s.name)
        targets.append((c.__name__, trigger_of.get(c.__name__, "?"), reads))

    conn = await asyncpg.connect(dsn)
    try:
        # Keys actually present in real emitted payloads, per trigger.
        present = {
            f"{r['namespace']}:{r['type']}:{r['phase']}": set(json.loads(r["keys"]))
            for r in await conn.fetch(
                """
                SELECT namespace, type, phase, jsonb_agg(DISTINCT k) AS keys
                FROM system_events, LATERAL jsonb_object_keys(COALESCE(payload,'{}'::jsonb)) k
                GROUP BY 1,2,3
                """
            )
        }
        rows = await conn.fetch(
            "SELECT namespace||':'||type||':'||phase k, count(*) n, max(created_at) last "
            "FROM system_events GROUP BY 1"
        )
        counts = {r["k"]: r["n"] for r in rows}
        last_fired = {r["k"]: r["last"] for r in rows}
        # Keys present but null in EVERY observed payload — written, but never with a value.
        always_null: dict[str, set[str]] = {}
        for r in await conn.fetch(
            """
            SELECT namespace||':'||type||':'||phase AS k, key,
                   bool_and(value = 'null'::jsonb) AS all_null
            FROM system_events, LATERAL jsonb_each(COALESCE(payload,'{}'::jsonb))
            GROUP BY 1,2
            """
        ):
            if r["all_null"]:
                always_null.setdefault(r["k"], set()).add(r["key"])
    finally:
        await conn.close()

    misses, uncovered, hollow = [], [], []
    for name, trig, reads in sorted(targets):
        if counts.get(trig, 0) == 0:
            uncovered.append((name, trig, sorted(reads)))
            continue
        seen = present.get(trig, set())
        gone = sorted(k for k in reads if k not in seen)
        if gone:
            misses.append((name, trig, gone, reads, sorted(seen)))
        null_only = sorted(k for k in reads if k in always_null.get(trig, set()))
        if null_only:
            hollow.append((name, trig, null_only))

    if "--json" in sys.argv:
        print(json.dumps({
            "misses": [{"workflow": n, "trigger": t, "keys": g} for n, t, g, _, _ in misses],
            "uncovered": [{"workflow": n, "trigger": t, "keys": k} for n, t, k in uncovered],
            "always_null": [{"workflow": n, "trigger": t, "keys": k} for n, t, k in hollow],
        }, indent=1))
        return 1 if misses else 0

    total_steps = sum(
        len([s for s in c.steps if getattr(s, "step_type", None) == StepType.AI_INVOKE])
        for c in all_registered_workflows()
    )
    print(f"AI_INVOKE input contract — {len(targets)} workflows, {total_steps} steps\n")

    if misses:
        print("MISS — a step reads a key no real emitted payload has ever carried:")
        for name, trig, gone, reads, seen in misses:
            fired = last_fired.get(trig)
            print(f"  {name}  ({trig})")
            for k in gone:
                print(f"      payload.{k}  <- read by step(s): {', '.join(reads[k])}")
            print(f"      payloads actually carry: {seen}")
            # The timestamp is how you tell a real gap from stale evidence: if the newest payload
            # predates the emitter's last change, re-fire the trigger before believing this.
            print(f"      newest payload for this trigger: {fired}")
        print()
    else:
        print("MISS: none — every key read by a fired workflow is written by its emitter.\n")

    if hollow:
        print("WEAK — key is written but has been null in EVERY observed payload (presence only):")
        for name, trig, keys in hollow:
            print(f"  {name}: {', '.join('payload.' + k for k in keys)}")
        print()

    if uncovered:
        print(f"UNCOVERED — {len(uncovered)} workflow(s) whose trigger has never been emitted here.")
        print("These are UNMEASURED, not passing. Fire the trigger to bring them under the lens.")
        for name, trig, keys in uncovered:
            print(f"  {name:36s} {trig}")
            if keys:
                print(f"      would read: {', '.join(keys)}")
        print()

    return 1 if misses else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
