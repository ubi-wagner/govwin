"""E2E dispatcher-free tests for the shredder runner — Phase 1 §D4.

Runs against a real PG (via TEST_DATABASE_URL), but with a mocked
Anthropic client so no real Claude calls happen.

Verifies:
  - Happy path: sections + compliance matches land in DB
  - ai_extracted JSONB populated with prompt_version stamp
  - namespace column set
  - status flips to 'ai_analyzed'
  - solicitation_compliance row UPSERT with named columns populated
  - Budget enforcement: oversized text raises ShredderBudgetError and
    flips status to 'shredder_failed'
  - Missing-text fallback: no docs + no full_text → 'shredder_failed'
  - start/end events emitted with correlated parent_event_id

Skips cleanly when TEST_DATABASE_URL is unreachable so the rest of
the unit suite stays green in CI without PG dependencies.
"""
import json
import os
import uuid
from types import SimpleNamespace

import asyncpg
import pytest
import pytest_asyncio


TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres@/postgres?host=/tmp/pgtest&port=55432",
)


# ── Fake Anthropic client ──────────────────────────────────────────────


def _make_fake_anthropic(section_response: dict, compliance_response: dict):
    """Return a fake client that responds differently based on prompt content.

    The runner makes one section-extraction call then one compliance
    call per section. The fake dispatches by whether the user message
    contains 'DOCUMENT:' (section extraction) or 'MASTER VARIABLES:'
    (compliance extraction).
    """
    calls = []

    async def _create(**kwargs):
        user_msg = kwargs["messages"][0]["content"]
        calls.append({"system": kwargs["system"][:50], "user_first_line": user_msg.split("\n")[0]})

        if "MASTER VARIABLES:" in user_msg:
            text = json.dumps(compliance_response)
        else:
            text = json.dumps(section_response)
        return SimpleNamespace(
            content=[SimpleNamespace(text=text)],
            usage=SimpleNamespace(input_tokens=200, output_tokens=100),
        )

    client = SimpleNamespace(
        messages=SimpleNamespace(create=_create),
        _calls=calls,
    )
    return client


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


@pytest_asyncio.fixture
async def seed(conn):
    """Create one opportunity + one curated_solicitations row with full_text."""
    opp_id = await conn.fetchval(
        """
        INSERT INTO opportunities (source, source_id, title, agency, office, program_type,
                                    description, is_active)
        VALUES ('sam_gov', $1, $2, 'Department of the Air Force', 'AFWERX',
                'sbir_phase_1', 'test description', true)
        RETURNING id
        """,
        f"shredder-runner-test-{uuid.uuid4()}",
        "Test DAF SBIR 2026.1 Phase I",
    )
    sol_id = await conn.fetchval(
        """
        INSERT INTO curated_solicitations (opportunity_id, namespace, status, full_text)
        VALUES ($1, 'pending', 'released_for_analysis', $2)
        RETURNING id
        """,
        opp_id,
        "This is the full text of the solicitation. "
        "The Technical Volume shall not exceed 15 pages. "
        "Use 11-point Times New Roman font with 1-inch margins.",
    )
    yield {"opportunity_id": opp_id, "solicitation_id": sol_id}

    # Teardown — cascades via FK
    await conn.execute("DELETE FROM system_events WHERE namespace = 'finder'")
    await conn.execute("DELETE FROM solicitation_compliance WHERE solicitation_id = $1", sol_id)
    await conn.execute("DELETE FROM curated_solicitations WHERE id = $1", sol_id)
    await conn.execute("DELETE FROM opportunities WHERE id = $1", opp_id)


# ── Tests ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_happy_path_writes_ai_extracted_and_compliance(conn, seed):
    from shredder.runner import shred_solicitation

    section_response = {
        "sections": [
            {
                "key": "submission_format",
                "title": "Section 7: Proposal Preparation",
                "page_range": "24-32",
                "summary": "Technical volume 15 pages, 11-pt font, 1-inch margins.",
                "raw_text_excerpt": "The Technical Volume shall not exceed 15 pages. Use 11-point Times New Roman font with 1-inch margins.",
            },
        ]
    }
    compliance_response = {
        "matches": [
            {"variable_name": "page_limit_technical", "value": 15,
             "source_excerpt": "Technical Volume shall not exceed 15 pages",
             "page": None, "confidence": 1.0},
            {"variable_name": "font_family", "value": "Times New Roman",
             "source_excerpt": "11-point Times New Roman",
             "page": None, "confidence": 1.0},
            {"variable_name": "font_size", "value": "11",
             "source_excerpt": "11-point Times New Roman",
             "page": None, "confidence": 1.0},
        ]
    }
    fake = _make_fake_anthropic(section_response, compliance_response)

    result = await shred_solicitation(
        conn, str(seed["solicitation_id"]), fake, parent_event_id=None
    )

    assert result["status"] == "ai_analyzed"
    assert result["sections"] == 1
    assert result["compliance_matches"] == 3
    assert result["column_updates"] == 3

    # curated_solicitations state
    row = await conn.fetchrow(
        "SELECT status, namespace, ai_extracted FROM curated_solicitations WHERE id = $1",
        seed["solicitation_id"],
    )
    assert row["status"] == "ai_analyzed"
    assert row["namespace"] == "USAF:AFWERX:SBIR:Phase1"
    ai_blob = json.loads(row["ai_extracted"]) if isinstance(row["ai_extracted"], str) else row["ai_extracted"]
    assert ai_blob["prompt_version"] == 1
    assert len(ai_blob["sections"]) == 1

    # solicitation_compliance row
    comp = await conn.fetchrow(
        "SELECT page_limit_technical, font_family, font_size, verified_by, verified_at, custom_variables "
        "FROM solicitation_compliance WHERE solicitation_id = $1",
        seed["solicitation_id"],
    )
    assert comp["page_limit_technical"] == 15
    assert comp["font_family"] == "Times New Roman"
    assert comp["font_size"] == "11"
    assert comp["verified_by"] is None, "shredder must never set verified_by"
    assert comp["verified_at"] is None, "shredder must never set verified_at"

    # start + end events emitted with parent linkage
    start_row = await conn.fetchrow(
        "SELECT id, payload FROM system_events "
        "WHERE namespace='finder' AND type='rfp.shredding.start' "
        "ORDER BY created_at DESC LIMIT 1"
    )
    end_row = await conn.fetchrow(
        "SELECT parent_event_id, payload FROM system_events "
        "WHERE namespace='finder' AND type='rfp.shredding.end' "
        "ORDER BY created_at DESC LIMIT 1"
    )
    assert start_row is not None
    assert end_row is not None
    assert end_row["parent_event_id"] == start_row["id"]

    end_payload = json.loads(end_row["payload"]) if isinstance(end_row["payload"], str) else end_row["payload"]
    assert end_payload["status"] == "ai_analyzed"
    assert end_payload["sections_extracted"] == 1
    assert end_payload["column_updates_applied"] == 3
    assert end_payload["namespace"] == "USAF:AFWERX:SBIR:Phase1"


@pytest.mark.asyncio
async def test_idempotent_rerun_overwrites_cleanly(conn, seed):
    """Re-running on the same solicitation overwrites ai_extracted."""
    from shredder.runner import shred_solicitation

    section_response = {"sections": [{
        "key": "submission_format", "title": "Proposal Prep",
        "page_range": "1", "summary": "S",
        "raw_text_excerpt": "The Technical Volume shall not exceed 15 pages.",
    }]}
    compliance_response_v1 = {
        "matches": [{"variable_name": "page_limit_technical", "value": 15,
                     "source_excerpt": "", "page": None, "confidence": 1.0}]
    }
    compliance_response_v2 = {
        "matches": [{"variable_name": "page_limit_technical", "value": 20,
                     "source_excerpt": "", "page": None, "confidence": 1.0}]
    }

    await shred_solicitation(
        conn, str(seed["solicitation_id"]),
        _make_fake_anthropic(section_response, compliance_response_v1),
    )
    first = await conn.fetchval(
        "SELECT page_limit_technical FROM solicitation_compliance WHERE solicitation_id = $1",
        seed["solicitation_id"],
    )
    assert first == 15

    await shred_solicitation(
        conn, str(seed["solicitation_id"]),
        _make_fake_anthropic(section_response, compliance_response_v2),
    )
    second = await conn.fetchval(
        "SELECT page_limit_technical FROM solicitation_compliance WHERE solicitation_id = $1",
        seed["solicitation_id"],
    )
    assert second == 20

    # Only one row for this solicitation
    count = await conn.fetchval(
        "SELECT COUNT(*) FROM solicitation_compliance WHERE solicitation_id = $1",
        seed["solicitation_id"],
    )
    assert count == 1


@pytest.mark.asyncio
async def test_no_text_available_flips_to_shredder_failed(conn):
    """Solicitation with no full_text AND no documents → shredder_failed."""
    from shredder.runner import shred_solicitation

    opp_id = await conn.fetchval(
        """
        INSERT INTO opportunities (source, source_id, title, agency, program_type, is_active)
        VALUES ('sam_gov', $1, 'empty test', 'USAF', 'sbir_phase_1', true)
        RETURNING id
        """,
        f"shredder-empty-{uuid.uuid4()}",
    )
    sol_id = await conn.fetchval(
        """
        INSERT INTO curated_solicitations (opportunity_id, namespace, status, full_text)
        VALUES ($1, 'pending', 'released_for_analysis', NULL)
        RETURNING id
        """,
        opp_id,
    )

    fake = _make_fake_anthropic({"sections": []}, {"matches": []})

    try:
        result = await shred_solicitation(conn, str(sol_id), fake)
        assert result["status"] == "shredder_failed"
        assert result["reason"] == "no_text_available"

        status = await conn.fetchval(
            "SELECT status FROM curated_solicitations WHERE id = $1", sol_id
        )
        assert status == "shredder_failed"
    finally:
        await conn.execute("DELETE FROM system_events WHERE namespace = 'finder'")
        await conn.execute("DELETE FROM curated_solicitations WHERE id = $1", sol_id)
        await conn.execute("DELETE FROM opportunities WHERE id = $1", opp_id)


@pytest.mark.asyncio
async def test_budget_exceeded_raises_and_flips_status(conn, seed, monkeypatch):
    """Oversized text triggers ShredderBudgetError + shredder_failed status."""
    from errors import ShredderBudgetError
    from shredder import runner
    from shredder.runner import shred_solicitation

    # Trigger budget breach: est = chars/4 * 1.25 > 150_000 requires
    # ~480_000 chars after the 200K extractor cap. To simulate that,
    # swap the cap and set full_text above the new bar. The runner
    # caps full_text at MAX_CHARS_PER_DOCUMENT, so setting it to a
    # size LARGER than the cap isn't enough — we patch the cap for
    # this test to 800K so the ×1.25 est on 800K chars = 250K tokens.
    from shredder import runner as _runner
    monkeypatch.setattr(_runner, "MAX_CHARS_PER_DOCUMENT", 800_000)
    await conn.execute(
        "UPDATE curated_solicitations SET full_text = $2 WHERE id = $1",
        seed["solicitation_id"],
        "A" * 800_000,
    )

    fake = _make_fake_anthropic({"sections": []}, {"matches": []})

    with pytest.raises(ShredderBudgetError):
        await shred_solicitation(conn, str(seed["solicitation_id"]), fake)

    status = await conn.fetchval(
        "SELECT status FROM curated_solicitations WHERE id = $1",
        seed["solicitation_id"],
    )
    assert status == "shredder_failed"

    # End event payload includes reason=budget_exceeded
    end_payload = await conn.fetchval(
        "SELECT payload FROM system_events "
        "WHERE namespace='finder' AND type='rfp.shredding.end' "
        "ORDER BY created_at DESC LIMIT 1"
    )
    payload = json.loads(end_payload) if isinstance(end_payload, str) else end_payload
    assert payload["reason"] == "budget_exceeded"
    assert payload["estimated_input_tokens"] > runner.MAX_INPUT_TOKENS_PER_RUN
