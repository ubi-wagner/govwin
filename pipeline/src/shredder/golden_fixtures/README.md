# Shredder Golden Fixtures

Regression suite for the Phase 1 §D shredder. Each fixture is a real
DoD / DoW SBIR, STTR, or CSO solicitation PDF with a hand-curated
`expected.json` describing what the shredder SHOULD produce. The
regression test (`pipeline/tests/test_shredder_regression.py`) runs
the live shredder against each fixture and compares the output to
`expected.json`; divergence is treated as a prompt regression.

## Directory layout

```
golden_fixtures/
├── <fixture_id>/
│   ├── extracted.md          — pymupdf4llm output, capped at 200K chars (committed)
│   ├── expected.json          — hand-curated truth (edit when prompts change)
│   └── notes.md              — human context: what's in this RFP, known quirks
└── README.md                 — this file
```

## The 5 fixtures

| Fixture ID | Source PDF (in `docs/`) | Archetype |
|---|---|---|
| `dod_25_1_sbir_baa` | `DoD 25.1 SBIR BAA FULL_02032025.pdf` | DoD SBIR Phase I umbrella BAA |
| `dod_25_2_sbir_baa` | `DoD 25.2 SBIR BAA FULL_04212025.pdf` | **Cross-cycle pair** (25.1 + 25.2 prove §H pre-fill) |
| `dod_25_a_sttr_baa` | `DoD 25.A STTR BAA FULL_12202024.pdf` | DoD STTR (distinct from SBIR) |
| `af_x24_5_cso` | `AF_X24.5_CSO.pdf` | Air Force CSO — slide deck instead of pages |
| `dow_2026_sbir_baa` | `DoW 2026 SBIR BAA FULL_R1_04132026.pdf` | Latest cycle + DoD→DoW agency rename |

## Workflow

### Regenerating `extracted.md` (if a PDF changes or pymupdf upgrades)

```bash
cd pipeline
python scripts/extract_golden_text.py
```

This re-runs `shredder.extractor.extract_text_from_pdf` against every
source PDF in `docs/` and writes the (cap-truncated) markdown to
each fixture's `extracted.md`. Commit the diff.

### Recording `expected.json` from a real Claude run (requires API key)

```bash
cd pipeline
export ANTHROPIC_API_KEY=sk-ant-...
python scripts/record_golden_output.py         # all fixtures
python scripts/record_golden_output.py dod_25_1_sbir_baa  # one fixture
```

This runs the full shredder pipeline (section extraction + per-section
compliance extraction) against each fixture's `extracted.md` using
the current `prompts/v1/*.txt`, then writes the result to
`expected.json`. **Commit the diff** — it becomes the new golden
output for the regression test.

### Running the regression test

```bash
cd pipeline
# Mock mode (default) — replays expected.json, no API key needed
pytest tests/test_shredder_regression.py

# Live mode — calls real Claude, compares output to expected.json
ANTHROPIC_API_KEY=sk-ant-... SHREDDER_LIVE=1 pytest tests/test_shredder_regression.py
```

Mock mode is always green; it proves the runner plumbing handles
real-sized documents correctly. Live mode is the actual prompt
regression check — failures mean the prompts drifted or Claude
changed behavior.

## When to update `expected.json`

- **Prompt change** (editing `prompts/v1/*.txt`): run the recorder,
  eyeball the diff against the old `expected.json`, commit if the
  diff looks like an intended improvement (not regression).
- **Model change** (bumping `SHREDDER_MODEL` default in `runner.py`):
  same drill — record + eyeball + commit.
- **New PDF**: add a new fixture directory, run
  `scripts/extract_golden_text.py` to populate `extracted.md`, then
  the recorder to populate `expected.json`.

## What goes in `expected.json`

The shape matches what `runner.shred_solicitation` returns via
`ai_extracted`:

```json
{
  "prompt_version": 1,
  "model": "claude-sonnet-4-6",
  "sections": [
    { "key": "submission_format", "title": "...", "page_range": "24-32",
      "summary": "...", "raw_text_excerpt": "..." }
  ],
  "compliance_matches": [
    { "variable_name": "page_limit_technical", "value": 15,
      "source_excerpt": "...", "page": null, "confidence": 1.0,
      "_section": "submission_format" }
  ]
}
```

The regression test tolerates minor noise — it compares by:

1. Set of section `key` values present (strict equality)
2. Compliance match `variable_name` and coerced `value` per match
3. Confidence >= 0.7 on all emitted matches

It ignores `source_excerpt`, `summary`, `page_range`, and the
order of matches — these drift cosmetically between runs without
indicating a real regression.
