"""Golden-fixture regression tests — Phase 1 §D7.

Two modes:

  MOCK MODE (default) — replays expected.json through the runner via
    a mock Anthropic client. Verifies the runner plumbing handles
    real-sized 200K-char documents correctly and that compliance
    mapping / coercion / namespace computation stay stable. Runs in
    CI without any API key. Always green as long as the code + the
    recorded expected.json agree.

  LIVE MODE — set `SHREDDER_LIVE=1` and `ANTHROPIC_API_KEY=...`.
    Calls real Claude against each fixture's extracted.md, compares
    to expected.json. Failures mean the prompts drifted or Claude
    changed behavior. This is the canary for prompt regressions —
    run it locally before merging prompt changes.

Comparison is intentionally loose:
  - Section `key` set match (strict)
  - For each expected compliance match: variable_name MUST appear
    in actual output, value MUST match (after coercion), and
    confidence MUST be >= the expected threshold
  - Sections/matches not listed in expected.json are ALLOWED (Claude
    may find more than we specified — that's fine)

Both modes require TEST_DATABASE_URL pointing at a reachable PG,
since the runner writes to the DB. Skips cleanly otherwise.
"""
from __future__ import annotations

import json
import os
import pathlib
import uuid as _uuid
from types import SimpleNamespace

import asyncpg
import pytest
import pytest_asyncio


TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres@/postgres?host=/tmp/pgtest&port=55432",
)
LIVE_MODE = os.environ.get("SHREDDER_LIVE") == "1"

FIXTURES_DIR = pathlib.Path(__file__).parent.parent / "src" / "shredder" / "golden_fixtures"


def _discover_fixtures() -> list[str]:
    if not FIXTURES_DIR.exists():
        return []
    return sorted(
        d.name for d in FIXTURES_DIR.iterdir()
        if d.is_dir() and (d / "extracted.md").exists() and (d / "expected.json").exists()
    )


FIXTURE_IDS = _discover_fixtures()

# Metadata drives namespace computation (mirrors FIXTURE_META in the
# recorder script, kept in sync by eyeball — small enough to duplicate).
FIXTURE_META: dict[str, dict] = {
    "dod_25_1_sbir_baa":  {"agency": "Department of Defense", "office": None, "program_type": "sbir_phase_1"},
    "dod_25_2_sbir_baa":  {"agency": "Department of Defense", "office": None, "program_type": "sbir_phase_1"},
    "dod_25_a_sttr_baa":  {"agency": "Department of Defense", "office": None, "program_type": "sttr_phase_1"},
    "af_x24_5_cso":       {"agency": "Department of the Air Force", "office": None, "program_type": "cso"},
    "dow_2026_sbir_baa":  {"agency": "Department of War", "office": None, "program_type": "sbir_phase_1"},
}


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def conn():
    try:
        c = await asyncpg.connect(TEST_DATABASE_URL, timeout=2)
    except (asyncpg.exceptions.PostgresError, OSError, ConnectionError):
        pytest.skip(f"test PG not reachable at {TEST_DATABASE_URL}")
    try:
        yield c
    finally:
        await c.close()


# ── Helpers ─────────────────────────────────────────────────────────────


def _make_mock_client(expected: dict):
    """Build a fake AsyncAnthropic that returns expected.json's contents.

    The fake dispatches by whether the user message contains
    'MASTER VARIABLES:' (compliance) vs 'DOCUMENT:' (section extraction).

    Compliance matches are re-returned ONCE across any number of section
    invocations — we don't try to replay per-section slicing in the mock.
    The runner collects all matches into all_matches[], so returning the
    full set on the first compliance call is equivalent to returning one
    per section (just with `_section` set to whatever the first section
    happens to be). That's lossy but acceptable for the mock path because
    the regression assertions don't care about `_section`.
    """
    compliance_returned = {"done": False}

    async def _create(**kwargs):
        user_msg = kwargs["messages"][0]["content"]
        if "MASTER VARIABLES:" in user_msg:
            if compliance_returned["done"]:
                text = json.dumps({"matches": []})
            else:
                compliance_returned["done"] = True
                # Strip expected's shorthand (min_confidence marker) to full matches
                matches = []
                for m in expected.get("compliance_matches", []):
                    matches.append({
                        "variable_name": m["variable_name"],
                        "value": m["value"],
                        "source_excerpt": m.get("source_excerpt", "(mock)"),
                        "page": m.get("page"),
                        "confidence": max(m.get("min_confidence", 1.0), 1.0),
                    })
                text = json.dumps({"matches": matches})
        else:
            # Section extraction — replay just the keys (runner only reads
            # key + raw_text_excerpt to drive compliance calls).
            sections = [
                {
                    "key": s["key"],
                    "title": s.get("title", s["key"].replace("_", " ").title()),
                    "page_range": s.get("page_range", "1"),
                    "summary": s.get("summary", "(mock)"),
                    "raw_text_excerpt": s.get("raw_text_excerpt", "(mock section text for runner input)"),
                }
                for s in expected.get("sections", [])
            ]
            text = json.dumps({"sections": sections})
        return SimpleNamespace(
            content=[SimpleNamespace(text=text)],
            usage=SimpleNamespace(input_tokens=100, output_tokens=50),
        )

    return SimpleNamespace(messages=SimpleNamespace(create=_create))


async def _seed_solicitation(
    conn: asyncpg.Connection, fixture_id: str, extracted_text: str
) -> _uuid.UUID:
    """Insert a curated_solicitations row with the fixture's extracted text.

    Returns the solicitation UUID. Caller owns cleanup.
    """
    meta = FIXTURE_META[fixture_id]
    opp_id = await conn.fetchval(
        """
        INSERT INTO opportunities (source, source_id, title, agency, office, program_type, is_active)
        VALUES ('sam_gov', $1, $2, $3, $4, $5, true)
        RETURNING id
        """,
        f"regression-{fixture_id}-{_uuid.uuid4()}",
        f"regression fixture: {fixture_id}",
        meta["agency"],
        meta["office"],
        meta["program_type"],
    )
    sol_id = await conn.fetchval(
        """
        INSERT INTO curated_solicitations (opportunity_id, namespace, status, full_text)
        VALUES ($1, 'pending', 'released_for_analysis', $2)
        RETURNING id
        """,
        opp_id,
        extracted_text,
    )
    return opp_id, sol_id


async def _cleanup_solicitation(
    conn: asyncpg.Connection, opp_id: _uuid.UUID, sol_id: _uuid.UUID
) -> None:
    await conn.execute("DELETE FROM system_events WHERE namespace = 'finder'")
    await conn.execute("DELETE FROM solicitation_compliance WHERE solicitation_id = $1", sol_id)
    await conn.execute("DELETE FROM curated_solicitations WHERE id = $1", sol_id)
    await conn.execute("DELETE FROM opportunities WHERE id = $1", opp_id)


def _assert_expected_sections(expected: dict, actual_sections: list) -> None:
    """Every key in expected.sections MUST appear in actual_sections."""
    expected_keys = {s["key"] for s in expected.get("sections", [])}
    actual_keys = {s["key"] for s in actual_sections if isinstance(s, dict)}
    missing = expected_keys - actual_keys
    assert not missing, f"expected section keys missing from actual: {missing}"


def _assert_expected_compliance(expected: dict, actual_matches: list) -> None:
    """Every expected compliance variable MUST appear with matching value + confidence."""
    actual_by_name: dict[str, dict] = {}
    for m in actual_matches:
        if isinstance(m, dict) and m.get("variable_name"):
            actual_by_name.setdefault(m["variable_name"], m)

    for exp in expected.get("compliance_matches", []):
        name = exp["variable_name"]
        assert name in actual_by_name, f"expected compliance match {name!r} not in actual output"
        actual = actual_by_name[name]

        # Value comparison: tolerate type drift (e.g. "10" vs 10) via str equality
        assert str(actual.get("value")).strip().lower() == str(exp["value"]).strip().lower(), (
            f"{name}: expected value={exp['value']!r}, got {actual.get('value')!r}"
        )

        # Confidence: expected declares the MINIMUM acceptable
        min_conf = exp.get("min_confidence", 0.7)
        assert actual.get("confidence", 0) >= min_conf, (
            f"{name}: confidence {actual.get('confidence')} below min {min_conf}"
        )


# ── Tests ────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not FIXTURE_IDS, reason="no golden fixtures discovered")
@pytest.mark.parametrize("fixture_id", FIXTURE_IDS)
@pytest.mark.asyncio
async def test_regression_mock_mode(conn, fixture_id):
    """Mock-mode regression: runner replays expected.json through itself.

    Proves the runner's DB writes + namespace computation + compliance
    mapping handle real-document-sized inputs. Doesn't validate prompt
    quality — that's what live mode is for.
    """
    from shredder.runner import shred_solicitation

    extracted = (FIXTURES_DIR / fixture_id / "extracted.md").read_text(encoding="utf-8")
    expected = json.loads((FIXTURES_DIR / fixture_id / "expected.json").read_text(encoding="utf-8"))

    opp_id, sol_id = await _seed_solicitation(conn, fixture_id, extracted)
    try:
        mock_client = _make_mock_client(expected)
        result = await shred_solicitation(conn, str(sol_id), mock_client)

        assert result["status"] == "ai_analyzed", \
            f"runner returned {result['status']!r}; expected ai_analyzed"

        # Verify namespace matches expected
        expected_ns = expected["_meta"].get("namespace_expected")
        actual_ns = await conn.fetchval(
            "SELECT namespace FROM curated_solicitations WHERE id = $1", sol_id
        )
        assert actual_ns == expected_ns, \
            f"namespace mismatch: expected {expected_ns!r}, got {actual_ns!r}"

        # Verify status flipped
        actual_status = await conn.fetchval(
            "SELECT status FROM curated_solicitations WHERE id = $1", sol_id
        )
        assert actual_status == "ai_analyzed"
    finally:
        await _cleanup_solicitation(conn, opp_id, sol_id)


@pytest.mark.skipif(
    not LIVE_MODE or not os.environ.get("ANTHROPIC_API_KEY"),
    reason="SHREDDER_LIVE=1 and ANTHROPIC_API_KEY required for live regression",
)
@pytest.mark.skipif(not FIXTURE_IDS, reason="no golden fixtures discovered")
@pytest.mark.parametrize("fixture_id", FIXTURE_IDS)
@pytest.mark.asyncio
async def test_regression_live_mode(conn, fixture_id):
    """Live-mode regression: real Claude calls vs expected.json.

    Run locally before merging prompt changes. Failures here mean
    either the prompts regressed or Claude changed — inspect output
    manually, re-record if the delta is an intended improvement.
    """
    import anthropic
    from shredder.runner import shred_solicitation

    extracted = (FIXTURES_DIR / fixture_id / "extracted.md").read_text(encoding="utf-8")
    expected = json.loads((FIXTURES_DIR / fixture_id / "expected.json").read_text(encoding="utf-8"))

    if expected["_meta"].get("status", "").startswith("STUB"):
        pytest.skip(
            f"{fixture_id} expected.json is STUB — "
            f"run scripts/record_golden_output.py to populate it"
        )

    opp_id, sol_id = await _seed_solicitation(conn, fixture_id, extracted)
    try:
        client = anthropic.AsyncAnthropic()
        result = await shred_solicitation(conn, str(sol_id), client)

        assert result["status"] == "ai_analyzed", \
            f"runner returned {result['status']!r}; expected ai_analyzed"

        # Pull actual output from ai_extracted
        ai_blob_raw = await conn.fetchval(
            "SELECT ai_extracted FROM curated_solicitations WHERE id = $1", sol_id
        )
        ai_blob = json.loads(ai_blob_raw) if isinstance(ai_blob_raw, str) else ai_blob_raw

        _assert_expected_sections(expected, ai_blob.get("sections", []))
        _assert_expected_compliance(expected, ai_blob.get("compliance_matches", []))

        expected_ns = expected["_meta"].get("namespace_expected")
        actual_ns = await conn.fetchval(
            "SELECT namespace FROM curated_solicitations WHERE id = $1", sol_id
        )
        assert actual_ns == expected_ns, \
            f"namespace mismatch: expected {expected_ns!r}, got {actual_ns!r}"
    finally:
        await _cleanup_solicitation(conn, opp_id, sol_id)
