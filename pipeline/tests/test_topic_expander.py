"""Unit tests for pipeline.src.ingest.topic_expander pure helpers.

No DB, no HTTP, no network calls. All DB-touching paths (expand_solicitation_topics,
_upsert_topic, _load_profile, _emit_topics_expanded) use a fake async connection.

Covers:
  - _derive_source_id: format ``{solicitation_id[:8]}-{topic_number}``
  - _content_hash: md5 stability, determinism, sensitivity
  - render_topic_url: happy-path token substitution, empty-on-missing-token,
    empty-on-blank-pattern, URL encoding
"""
from __future__ import annotations

import hashlib

import pytest

from ingest.topic_expander import (
    _content_hash,
    _derive_source_id,
    render_topic_url,
)


# ---------------------------------------------------------------------------
# _derive_source_id
# ---------------------------------------------------------------------------

class TestDeriveSourceId:
    def test_basic_format(self):
        """source_id = first_8_chars_of_solicitation_id + '-' + topic_number."""
        sol_id = "abcdef12-1234-5678-90ab-cdef12345678"
        topic = "AF251-001"
        result = _derive_source_id(sol_id, topic)
        assert result == "abcdef12-AF251-001"

    def test_uses_first_8_chars_of_uuid(self):
        """Only the first 8 characters of solicitation_id are used."""
        sol_id = "12345678-dead-beef-cafe-000000000000"
        result = _derive_source_id(sol_id, "T001")
        assert result.startswith("12345678-")
        assert result == "12345678-T001"

    def test_short_solicitation_id(self):
        """If solicitation_id is shorter than 8 chars, uses all of it."""
        result = _derive_source_id("abc", "X1")
        assert result == "abc-X1"

    def test_matches_frontend_bulk_add_topics_formula(self):
        """Mirrors JS: solicitationId.slice(0,8) + '-' + topicNumber."""
        # JS reference: `${solicitationId.slice(0,8)}-${topicNumber}`
        sol_id = "ffffffff-aaaa-bbbb-cccc-dddddddddddd"
        topic = "N252-042"
        assert _derive_source_id(sol_id, topic) == "ffffffff-N252-042"

    def test_deterministic_across_calls(self):
        """Same inputs always produce the same result."""
        args = ("11111111-2222-3333-4444-555555555555", "AF-001")
        assert _derive_source_id(*args) == _derive_source_id(*args)


# ---------------------------------------------------------------------------
# _content_hash
# ---------------------------------------------------------------------------

class TestContentHash:
    def test_returns_hex_md5(self):
        """Result is a 32-char hex string (MD5)."""
        h = _content_hash("sol-1234", "T001", "A title")
        assert len(h) == 32
        assert all(c in "0123456789abcdef" for c in h)

    def test_deterministic(self):
        """Same inputs → same hash on every call."""
        args = ("sol-abc", "AF251-001", "Test Topic Title")
        assert _content_hash(*args) == _content_hash(*args)

    def test_matches_manual_md5(self):
        """Hash equals md5(solicitation_id || topic_number || title)."""
        sol_id = "aabb-ccdd"
        topic = "N252-007"
        title = "Novel Sensor"
        expected = hashlib.md5(
            f"{sol_id}{topic}{title}".encode("utf-8")
        ).hexdigest()
        assert _content_hash(sol_id, topic, title) == expected

    def test_sensitivity_to_title(self):
        """Different titles produce different hashes."""
        h1 = _content_hash("sol", "T1", "Title A")
        h2 = _content_hash("sol", "T1", "Title B")
        assert h1 != h2

    def test_sensitivity_to_topic_number(self):
        """Different topic_numbers produce different hashes."""
        h1 = _content_hash("sol", "T1", "Same Title")
        h2 = _content_hash("sol", "T2", "Same Title")
        assert h1 != h2

    def test_sensitivity_to_solicitation_id(self):
        """Different solicitation_ids produce different hashes."""
        h1 = _content_hash("sol-A", "T1", "Same Title")
        h2 = _content_hash("sol-B", "T1", "Same Title")
        assert h1 != h2

    def test_different_instances_produce_same_hash(self):
        """Hash depends only on inputs, not on any module state."""
        # Call multiple times to confirm stability.
        args = ("11111111-2222-3333-4444", "AF251-042", "Hypersonic Sensors")
        hashes = {_content_hash(*args) for _ in range(5)}
        assert len(hashes) == 1


# ---------------------------------------------------------------------------
# render_topic_url
# ---------------------------------------------------------------------------

class TestRenderTopicUrl:
    def test_basic_token_substitution(self):
        """{topicNumber} is replaced with the corresponding token value."""
        pattern = "https://example.gov/topics/{topicNumber}"
        result = render_topic_url(pattern, {"topicNumber": "AF251-001"})
        assert result == "https://example.gov/topics/AF251-001"

    def test_multiple_tokens(self):
        """All tokens in the pattern are substituted."""
        pattern = "https://example.gov/{solicitationNumber}/topics/{topicNumber}"
        result = render_topic_url(
            pattern,
            {"solicitationNumber": "SBIR-2025", "topicNumber": "AF251-042"},
        )
        assert result == "https://example.gov/SBIR-2025/topics/AF251-042"

    def test_url_encodes_special_chars(self):
        """Token values with special characters are percent-encoded."""
        pattern = "https://example.gov/topics/{topicNumber}"
        result = render_topic_url(pattern, {"topicNumber": "AF 251/001"})
        assert " " not in result
        assert "/" not in result.split("topics/", 1)[-1]
        assert "AF" in result

    def test_empty_on_missing_token(self):
        """If a referenced token is absent from the dict, returns ''."""
        pattern = "https://example.gov/topics/{topicNumber}"
        result = render_topic_url(pattern, {})
        assert result == ""

    def test_empty_on_none_token_value(self):
        """If a token value is None, returns ''."""
        pattern = "https://example.gov/topics/{topicNumber}"
        result = render_topic_url(pattern, {"topicNumber": None})
        assert result == ""

    def test_empty_on_blank_token_value(self):
        """If a token value is whitespace-only, returns ''."""
        pattern = "https://example.gov/topics/{topicNumber}"
        result = render_topic_url(pattern, {"topicNumber": "   "})
        assert result == ""

    def test_empty_on_none_pattern(self):
        """None pattern → empty string."""
        assert render_topic_url(None, {"topicNumber": "T1"}) == ""

    def test_empty_on_blank_pattern(self):
        """Empty/whitespace pattern → empty string."""
        assert render_topic_url("", {"topicNumber": "T1"}) == ""
        assert render_topic_url("   ", {"topicNumber": "T1"}) == ""

    def test_pattern_with_no_tokens_returns_literal(self):
        """A pattern with no placeholders is returned as-is."""
        url = "https://example.gov/topics/list"
        assert render_topic_url(url, {}) == url

    def test_partial_token_match_returns_empty(self):
        """If pattern has 2 tokens but only 1 supplied, returns ''."""
        pattern = "https://example.gov/{solicitationNumber}/{topicNumber}"
        result = render_topic_url(pattern, {"topicNumber": "T1"})
        assert result == ""
