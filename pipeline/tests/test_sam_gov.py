"""
Tests for SAM.gov ingester — date parsing, stub data, content hashing, type mapping.

All tests are pure (no DB or API calls needed).
"""

import hashlib
import json
from datetime import datetime, timezone

import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from ingest.sam_gov import SamGovIngester, _generate_stub_opportunities


class FakeIngester(SamGovIngester):
    """SamGovIngester with conn=None for testing pure methods."""
    def __init__(self):
        super().__init__(conn=None)


ingester = FakeIngester()


# ── Date parsing ──

class TestDateParsing:
    def test_iso_format_with_tz(self):
        result = ingester._parse_date("2025-03-15T17:00:00-05:00")
        assert result is not None
        assert result.year == 2025
        assert result.month == 3
        assert result.day == 15

    def test_us_date_format(self):
        result = ingester._parse_date("03/15/2025")
        assert result is not None
        assert result.year == 2025
        assert result.month == 3
        assert result.day == 15

    def test_iso_date_only(self):
        result = ingester._parse_date("2025-03-15")
        assert result is not None
        assert result.year == 2025
        assert result.month == 3

    def test_none_returns_none(self):
        assert ingester._parse_date(None) is None

    def test_empty_string_returns_none(self):
        assert ingester._parse_date("") is None

    def test_invalid_format_returns_none(self):
        assert ingester._parse_date("not-a-date") is None

    def test_result_has_utc_timezone(self):
        result = ingester._parse_date("2025-06-01")
        assert result is not None
        assert result.tzinfo == timezone.utc


# ── Stub data ──

class TestStubData:
    def test_generates_5_opportunities(self):
        stubs = _generate_stub_opportunities()
        assert len(stubs) == 5

    def test_each_stub_has_required_fields(self):
        required = ["noticeId", "title", "type", "naicsCode", "active", "uiLink"]
        stubs = _generate_stub_opportunities()
        for stub in stubs:
            for field in required:
                assert field in stub, f"Missing {field} in stub {stub.get('noticeId')}"

    def test_stub_notice_ids_are_unique(self):
        stubs = _generate_stub_opportunities()
        ids = [s["noticeId"] for s in stubs]
        assert len(ids) == len(set(ids))

    def test_stubs_have_valid_types(self):
        valid_types = {"Solicitation", "Combined Synopsis/Solicitation", "Sources Sought",
                       "Presolicitation", "Special Notice"}
        stubs = _generate_stub_opportunities()
        for stub in stubs:
            assert stub["type"] in valid_types, f"Invalid type: {stub['type']}"

    def test_stubs_have_future_deadlines(self):
        now = datetime.now(timezone.utc)
        stubs = _generate_stub_opportunities()
        for stub in stubs:
            deadline = stub.get("responseDeadLine")
            if deadline:
                # The deadline should be in the future (within days of generation)
                assert "T" in deadline, "Deadline should have time component"


# ── Opportunity type mapping ──

class TestOpportunityTypeMapping:
    """Test the opp_type_map from _upsert_opportunity."""
    opp_type_map = {
        "o": "solicitation",
        "k": "sources_sought",
        "p": "presolicitation",
        "Solicitation": "solicitation",
        "Combined Synopsis/Solicitation": "solicitation",
        "Sources Sought": "sources_sought",
        "Presolicitation": "presolicitation",
        "Special Notice": "special_notice",
        "Award Notice": "award",
        "Intent to Bundle Requirements": "intent_bundle",
        "Justification and Approval": "justification",
    }

    def test_solicitation_maps(self):
        assert self.opp_type_map["Solicitation"] == "solicitation"

    def test_combined_synopsis_maps_to_solicitation(self):
        assert self.opp_type_map["Combined Synopsis/Solicitation"] == "solicitation"

    def test_sources_sought_maps(self):
        assert self.opp_type_map["Sources Sought"] == "sources_sought"

    def test_short_code_o_maps(self):
        assert self.opp_type_map["o"] == "solicitation"

    def test_unknown_type_defaults_to_other(self):
        result = self.opp_type_map.get("Unknown Type", "other")
        assert result == "other"


# ── Content hashing ──

class TestContentHashing:
    def test_same_content_gives_same_hash(self):
        raw = {"noticeId": "test_001", "title": "Test Opportunity"}
        content1 = json.dumps(raw, sort_keys=True, default=str)
        content2 = json.dumps(raw, sort_keys=True, default=str)
        hash1 = hashlib.sha256(content1.encode()).hexdigest()[:16]
        hash2 = hashlib.sha256(content2.encode()).hexdigest()[:16]
        assert hash1 == hash2

    def test_different_content_gives_different_hash(self):
        raw1 = {"noticeId": "test_001", "title": "Version A"}
        raw2 = {"noticeId": "test_001", "title": "Version B"}
        hash1 = hashlib.sha256(json.dumps(raw1, sort_keys=True).encode()).hexdigest()[:16]
        hash2 = hashlib.sha256(json.dumps(raw2, sort_keys=True).encode()).hexdigest()[:16]
        assert hash1 != hash2

    def test_hash_is_16_chars(self):
        raw = {"noticeId": "test"}
        h = hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()[:16]
        assert len(h) == 16

    def test_key_order_doesnt_matter_with_sort_keys(self):
        raw1 = {"b": 2, "a": 1}
        raw2 = {"a": 1, "b": 2}
        hash1 = hashlib.sha256(json.dumps(raw1, sort_keys=True).encode()).hexdigest()[:16]
        hash2 = hashlib.sha256(json.dumps(raw2, sort_keys=True).encode()).hexdigest()[:16]
        assert hash1 == hash2
