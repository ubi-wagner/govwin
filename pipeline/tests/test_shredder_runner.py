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


#: Prose that STATES rules the way a federal BAA does, so the locator has something real to find.
#: Padding around it stands in for the ~99% of a BAA that is topic narrative.
_RULE_TEXT = (
    "\n6.0 PROPOSAL SUBMISSION\n"
    "Page Limitations: the Technical Volume shall not exceed 20 pages in length.\n"
    "Font size must be no smaller than 10 point font, Times New Roman, with a one-inch margin.\n"
    "Volume 1 is the Cover Sheet. Volume 2 is the Technical Volume. Volume 3 is the Cost Volume.\n"
    "Proposals are submitted electronically via DSIP and are due no later than the close date.\n"
    "Eligibility: the offeror must be a small business concern and the principal investigator\n"
    "must be primarily employed by the firm. Component-specific instructions supersede these.\n"
)


def _big_solicitation_text(total_chars: int) -> str:
    """A document too large for the section-call budget that nonetheless states its rules.

    The rules sit past the halfway mark deliberately — that is where a real BAA puts them, and a
    prefix-taking reader would never reach them.
    """
    filler = "The topic seeks novel approaches to materials research. " * 200
    head = (filler * ((total_chars // 2) // len(filler) + 1))[: total_chars // 2]
    tail = (filler * ((total_chars // 2) // len(filler) + 1))[: total_chars // 2]
    return head + _RULE_TEXT + tail


@pytest.mark.asyncio
async def test_oversized_solicitation_is_located_not_refused(conn, seed, monkeypatch):
    """A BAA too large to ship whole is EXCERPTED and shredded, not failed.

    REGRESSION. The pre-flight guard used to raise unconditionally above the token budget. That was
    sized when the extractor capped documents at 200K chars; raising the cap to 2M — so a full BAA
    is actually read — put every real federal BAA over the line. Measured on the three in this repo:
    316,863 / 419,138 tokens estimated against a 150,000 budget. Not one AI shred of a real BAA had
    ever succeeded. The run now locates the rule-stating passages and shreds those.
    """
    from shredder import runner as _runner
    from shredder.runner import shred_solicitation

    monkeypatch.setattr(_runner, "MAX_CHARS_PER_DOCUMENT", 900_000)
    big = _big_solicitation_text(900_000)
    assert len(big) > _runner.MAX_SECTION_CALL_CHARS, "fixture must exceed the section-call budget"
    await conn.execute(
        "UPDATE curated_solicitations SET full_text = $2 WHERE id = $1",
        seed["solicitation_id"], big,
    )

    fake = _make_fake_anthropic(
        {"sections": [{"key": "submission", "title": "Proposal Submission",
                       "raw_text_excerpt": "shall not exceed 20 pages"}]},
        {"matches": []},
    )
    result = await shred_solicitation(conn, str(seed["solicitation_id"]), fake)
    assert result["status"] == "ai_analyzed"

    # The section call must have received the EXCERPT, not the whole document.
    section_call = next(c for c in fake._calls if "MASTER VARIABLES" not in c["user_first_line"])
    assert section_call is not None

    # Provenance: the run has to say it read part of the document, or a missing page limit reads
    # as "the BAA does not state one" rather than "we did not send that part".
    ai = await conn.fetchval(
        "SELECT ai_extracted FROM curated_solicitations WHERE id = $1", seed["solicitation_id"]
    )
    blob = json.loads(ai) if isinstance(ai, str) else ai
    src = blob["source_excerpt"]
    assert src["excerpted"] is True
    assert src["source_chars"] == len(big)
    assert src["excerpt_chars"] <= _runner.MAX_SECTION_CALL_CHARS
    assert 0 < src["coverage"] < 1
    # The locator found the rules that sit past the halfway mark — the whole point.
    assert "page_limits" in src["topics_covered"]
    assert "formatting" in src["topics_covered"]

    located = await conn.fetchval(
        "SELECT payload FROM system_events "
        "WHERE namespace='finder' AND type='rfp.sections_located' "
        "ORDER BY created_at DESC LIMIT 1"
    )
    assert located is not None, "an excerpted read must be visible in the event stream"


@pytest.mark.asyncio
async def test_budget_exceeded_raises_and_flips_status(conn, seed, monkeypatch):
    """Oversized text with NO rule-stating passage still fails loudly.

    800K repeated 'A's is not a solicitation: the locator finds nothing, and falling back to a
    prefix would reintroduce the cover-page bug with none of the honesty. The run refuses and names
    the topics it searched for.
    """
    from errors import ShredderBudgetError
    from shredder.runner import shred_solicitation

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

    end_payload = await conn.fetchval(
        "SELECT payload FROM system_events "
        "WHERE namespace='finder' AND type='rfp.shredding.end' "
        "ORDER BY created_at DESC LIMIT 1"
    )
    payload = json.loads(end_payload) if isinstance(end_payload, str) else end_payload
    assert payload["reason"] == "no_locatable_sections"
    assert payload["topics_searched"], "must say what it looked for, not just that it failed"


@pytest.mark.asyncio
async def test_section_extraction_failure_safe_skips(conn, seed):
    """A model failure on section extraction SKIPS the evidence step — it does not crash the run.

    REGRESSION, and a sharp one: the safe-skip commit landed the two READERS of `section_skip` but
    not its assignment, so the name was unbound. Python raises NameError only when that line
    executes, which needs a real section-extraction failure — no unit test reached it, the suite
    stayed green, and the first real document died with
    `name 'section_skip' is not defined` instead of skipping.
    """
    from safe_skip import NEEDS_VERIFICATION_COMMENT
    from shredder.runner import shred_solicitation

    async def _create(**kwargs):
        user_msg = kwargs["messages"][0]["content"]
        if "MASTER VARIABLES:" in user_msg:
            return SimpleNamespace(content=[SimpleNamespace(text=json.dumps({"matches": []}))],
                                   usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        # Never valid JSON, so the retry inside _call_claude also fails and the caller must skip.
        return SimpleNamespace(content=[SimpleNamespace(text="I'm afraid I can't do that.")],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1))

    fake = SimpleNamespace(messages=SimpleNamespace(create=_create), _calls=[])

    result = await shred_solicitation(conn, str(seed["solicitation_id"]), fake)
    assert result["status"] == "ai_analyzed", "a skipped evidence step must not fail the run"

    ai = await conn.fetchval(
        "SELECT ai_extracted FROM curated_solicitations WHERE id = $1", seed["solicitation_id"]
    )
    blob = json.loads(ai) if isinstance(ai, str) else ai
    skip = blob["section_extraction_skipped"]
    assert skip["skipped"] is True
    assert skip["kind"] == "evidence"
    assert skip["comment"] == NEEDS_VERIFICATION_COMMENT
    assert "content" not in skip, "evidence never fabricates"
    assert blob["sections"] == []
