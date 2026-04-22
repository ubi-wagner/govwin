"""Unit tests for Phase 1 §D8 — sync compliance extract.

Tests the thin variant used by the §E `compliance.extract_from_text`
tool. Uses a mock Anthropic client so these tests run anywhere without
API access.
"""
import json
from types import SimpleNamespace

import pytest

from shredder.sync_extract import (
    MAX_FRAGMENT_CHARS,
    SyncExtractError,
    extract_compliance_from_text,
)


def _make_fake_client(response_json: dict):
    """Build a minimal object that quacks like `anthropic.AsyncAnthropic`."""
    async def _create(**kwargs):
        text = json.dumps(response_json)
        return SimpleNamespace(
            content=[SimpleNamespace(text=text)],
            usage=SimpleNamespace(input_tokens=123, output_tokens=45),
        )
    messages = SimpleNamespace(create=_create)
    return SimpleNamespace(messages=messages)


MASTER_VARS = [
    {"name": "page_limit_technical", "data_type": "number", "label": "Technical volume page limit"},
    {"name": "font_family", "data_type": "text", "label": "Required font family"},
    {"name": "taba_allowed", "data_type": "boolean", "label": "TABA funds permitted"},
]


@pytest.mark.asyncio
async def test_happy_path_returns_matches_list():
    fake = _make_fake_client({
        "matches": [
            {"variable_name": "page_limit_technical", "value": 15,
             "source_excerpt": "The Technical Volume shall not exceed 15 pages.",
             "page": None, "confidence": 1.0},
        ]
    })
    matches = await extract_compliance_from_text(
        "The Technical Volume shall not exceed 15 pages.",
        MASTER_VARS, fake,
    )
    assert len(matches) == 1
    assert matches[0]["variable_name"] == "page_limit_technical"
    assert matches[0]["value"] == 15


@pytest.mark.asyncio
async def test_markdown_fenced_json_stripped():
    """Claude sometimes adds ```json fences — we strip them."""
    async def _create(**kwargs):
        return SimpleNamespace(
            content=[SimpleNamespace(text='```json\n{"matches": []}\n```')],
            usage=SimpleNamespace(input_tokens=10, output_tokens=5),
        )
    fake = SimpleNamespace(messages=SimpleNamespace(create=_create))
    matches = await extract_compliance_from_text("Text.", MASTER_VARS, fake)
    assert matches == []


@pytest.mark.asyncio
async def test_empty_fragment_raises():
    with pytest.raises(SyncExtractError, match="non-empty"):
        await extract_compliance_from_text("", MASTER_VARS, _make_fake_client({"matches": []}))


@pytest.mark.asyncio
async def test_whitespace_only_fragment_raises():
    with pytest.raises(SyncExtractError, match="non-empty"):
        await extract_compliance_from_text("   \n  ", MASTER_VARS, _make_fake_client({"matches": []}))


@pytest.mark.asyncio
async def test_oversized_fragment_raises():
    huge = "A" * (MAX_FRAGMENT_CHARS + 10)
    with pytest.raises(SyncExtractError, match="exceeds"):
        await extract_compliance_from_text(huge, MASTER_VARS, _make_fake_client({"matches": []}))


@pytest.mark.asyncio
async def test_non_list_matches_raises():
    fake = _make_fake_client({"matches": "not a list"})
    with pytest.raises(SyncExtractError, match="non-list"):
        await extract_compliance_from_text("Text.", MASTER_VARS, fake)


@pytest.mark.asyncio
async def test_unparseable_json_raises():
    async def _create(**kwargs):
        return SimpleNamespace(
            content=[SimpleNamespace(text="this is definitely not json {{{")],
            usage=SimpleNamespace(input_tokens=10, output_tokens=5),
        )
    fake = SimpleNamespace(messages=SimpleNamespace(create=_create))
    # The ValueError from _call_claude surfaces as-is — sync_extract
    # wraps SyncExtractError only on caller errors, not Claude errors.
    with pytest.raises(ValueError, match="unparseable JSON"):
        await extract_compliance_from_text("Text.", MASTER_VARS, fake)


@pytest.mark.asyncio
async def test_model_override():
    captured = {}
    async def _create(**kwargs):
        captured["model"] = kwargs["model"]
        return SimpleNamespace(
            content=[SimpleNamespace(text='{"matches": []}')],
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        )
    fake = SimpleNamespace(messages=SimpleNamespace(create=_create))
    await extract_compliance_from_text(
        "Text.", MASTER_VARS, fake, model="claude-haiku-4-5-20251001"
    )
    assert captured["model"] == "claude-haiku-4-5-20251001"
