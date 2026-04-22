"""Record real-Claude outputs for every golden fixture.

Runs the current `prompts/v1/*.txt` against each fixture's
`extracted.md` via a real `anthropic.AsyncAnthropic` client and writes
the result to `expected.json`. The regression test
(`pipeline/tests/test_shredder_regression.py`) compares the live
shredder output against these recorded values.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    cd pipeline
    python scripts/record_golden_output.py              # all fixtures
    python scripts/record_golden_output.py af_x24_5_cso # one fixture

Writes: `pipeline/src/shredder/golden_fixtures/<fid>/expected.json`.

Run this AFTER any change to `prompts/v1/*.txt` and eyeball the
diff against the prior golden before committing. A clean diff
signals an intended quality improvement; a noisy one signals either
a prompt regression or a Claude behavior shift — inspect before
accepting.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import sys
from typing import Any

REPO_ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from shredder.compliance_mapping import KNOWN_COLUMNS  # noqa: E402
from shredder.namespace import compute_namespace_key  # noqa: E402
from shredder.runner import (  # noqa: E402
    DEFAULT_MODEL,
    _call_claude,
    _load_prompt,
    _split_system_and_examples,
)


FIXTURES_DIR = REPO_ROOT / "src" / "shredder" / "golden_fixtures"

# Hard-coded metadata for each fixture (drives the namespace computation
# that the live runner normally pulls from opportunities.*).
FIXTURE_META: dict[str, dict[str, Any]] = {
    "dod_25_1_sbir_baa":  {"agency": "Department of Defense", "office": None, "program_type": "sbir_phase_1"},
    "dod_25_2_sbir_baa":  {"agency": "Department of Defense", "office": None, "program_type": "sbir_phase_1"},
    "dod_25_a_sttr_baa":  {"agency": "Department of Defense", "office": None, "program_type": "sttr_phase_1"},
    "af_x24_5_cso":       {"agency": "Department of the Air Force", "office": None, "program_type": "cso"},
    "dow_2026_sbir_baa":  {"agency": "Department of War", "office": None, "program_type": "sbir_phase_1"},
}

MASTER_VARIABLES = [
    {"name": name, "data_type": t.__name__, "label": name.replace("_", " ").title()}
    for name, (_col, t) in KNOWN_COLUMNS.items()
]


async def record_fixture(fid: str, client: Any) -> None:
    outdir = FIXTURES_DIR / fid
    extracted_path = outdir / "extracted.md"
    expected_path = outdir / "expected.json"

    if not extracted_path.exists():
        print(f"[skip] {fid}: extracted.md missing (run extract_golden_text.py first)")
        return

    text = extracted_path.read_text(encoding="utf-8")

    # Section extraction
    section_prompt = _load_prompt("section_extraction")
    sys_prompt, user_tmpl = _split_system_and_examples(section_prompt)
    sec_result, sec_in, sec_out = await _call_claude(
        client,
        system_prompt=sys_prompt,
        user_message=f"{user_tmpl}\n\nDOCUMENT:\n{text}",
    )
    sections = sec_result.get("sections", [])
    print(f"  [{fid}] sections: {len(sections)}  (in={sec_in} out={sec_out} tokens)")

    # Compliance extraction per section
    comp_prompt = _load_prompt("compliance_extraction")
    sys_c, user_c = _split_system_and_examples(comp_prompt)
    master = "\n".join(f"- {v['name']} ({v['data_type']}) — {v['label']}" for v in MASTER_VARIABLES)

    all_matches: list[dict[str, Any]] = []
    total_in = sec_in
    total_out = sec_out
    for section in sections:
        section_text = section.get("raw_text_excerpt") or ""
        if not section_text:
            continue
        try:
            result, in_t, out_t = await _call_claude(
                client,
                system_prompt=sys_c,
                user_message=(
                    f"{user_c}\n\nMASTER VARIABLES:\n{master}\n\n"
                    f"SECTION: {section.get('title', '')}\n{section_text}"
                ),
            )
        except Exception as e:
            print(f"  [{fid}] compliance extraction failed for {section.get('key')}: {e}")
            continue
        total_in += in_t
        total_out += out_t
        for m in result.get("matches", []):
            m["_section"] = section.get("key")
            all_matches.append(m)

    meta = FIXTURE_META.get(fid, {})
    namespace = compute_namespace_key(
        meta.get("agency"), meta.get("office"), meta.get("program_type")
    )

    output = {
        "_meta": {
            "fixture_id": fid,
            "source_pdf_hint": None,
            "status": "RECORDED via scripts/record_golden_output.py",
            "namespace_expected": namespace,
            "total_input_tokens": total_in,
            "total_output_tokens": total_out,
        },
        "prompt_version": 1,
        "model": DEFAULT_MODEL,
        "sections": sections,
        "compliance_matches": all_matches,
    }

    expected_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"  [{fid}] wrote {expected_path.relative_to(REPO_ROOT.parent)}")


async def main(selected: list[str]) -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY not set.", file=sys.stderr)
        return 1

    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic SDK not installed. Run `pip install anthropic`.", file=sys.stderr)
        return 1

    client = anthropic.AsyncAnthropic()

    fixtures_to_record = selected or list(FIXTURE_META.keys())
    unknown = [f for f in fixtures_to_record if f not in FIXTURE_META]
    if unknown:
        print(f"ERROR: unknown fixture(s): {unknown}", file=sys.stderr)
        print(f"Known: {list(FIXTURE_META.keys())}", file=sys.stderr)
        return 1

    for fid in fixtures_to_record:
        print(f"\n=== {fid} ===")
        await record_fixture(fid, client)

    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    sys.exit(asyncio.run(main(args)))
