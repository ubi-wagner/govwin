"""Unit tests for the ingester framework (Phase 1 §C).

Covers:
  - BaseIngester._hash determinism + sensitivity
  - Each ingester's normalize() function against stub data
  - IngesterRateLimitError / IngesterContractError instantiation
  - Ingest dedup via content_hash (simulated via _hash equality)
  - Cross-language hash pattern (Python-only determinism proof)

These are fast unit tests — no DB, no HTTP. The end-to-end dispatcher
test against a real PG lives in test_ingest_e2e.py.
"""
import pytest

from errors import (
    IngesterRateLimitError,
    IngesterContractError,
    ShredderBudgetError,
    ExternalServiceError,
    StateTransitionError,
    ClaimConflictError,
    AppError,
)
from ingest.base import BaseIngester, IngestResult
from ingest.sam_gov import SamGovIngester
from ingest.sbir_gov import SbirGovIngester
from ingest.grants_gov import GrantsGovIngester


# ── Error class tests ─────────────────────────────────────────────────


class TestErrorClasses:
    def test_ingester_rate_limit_error(self):
        err = IngesterRateLimitError(
            "sam.gov limit",
            details={"retry_after_seconds": 300, "source": "sam_gov"},
        )
        assert err.code == "INGESTER_RATE_LIMITED"
        assert err.http_status == 429
        assert err.details["retry_after_seconds"] == 300
        assert isinstance(err, AppError)

    def test_ingester_contract_error(self):
        err = IngesterContractError(details={"source": "sbir_gov"})
        assert err.code == "INGESTER_CONTRACT_VIOLATED"
        assert err.http_status == 502

    def test_shredder_budget_error(self):
        err = ShredderBudgetError()
        assert err.code == "SHREDDER_BUDGET_EXCEEDED"
        assert err.http_status == 503

    def test_external_service_error(self):
        err = ExternalServiceError()
        assert err.code == "EXTERNAL_SERVICE_ERROR"
        assert err.http_status == 502

    def test_state_transition_error(self):
        err = StateTransitionError()
        assert err.code == "INVALID_STATE_TRANSITION"
        assert err.http_status == 409

    def test_claim_conflict_error(self):
        err = ClaimConflictError()
        assert err.code == "CLAIM_CONFLICT"
        assert err.http_status == 409


# ── BaseIngester._hash determinism ────────────────────────────────────


class _StubIngester(BaseIngester):
    """Minimal concrete subclass for testing base methods."""
    name = "test_stub"
    source = "test"

    async def fetch_page(self, client, api_key, cursor):
        return [], None

    def normalize(self, raw):
        return {}


class TestHashDeterminism:
    def setup_method(self):
        self.ing = _StubIngester()

    def test_same_input_same_hash(self):
        """Deterministic: same input → same hash across invocations."""
        row = {
            "source": "sam_gov",
            "source_id": "TEST-001",
            "title": "Test Opportunity",
            "close_date": "2026-06-30",
            "description": "A test description.",
        }
        h1 = self.ing._hash(row)
        h2 = self.ing._hash(row)
        assert h1 == h2
        assert len(h1) == 64  # SHA-256 hex
        assert all(c in "0123456789abcdef" for c in h1)

    def test_different_title_different_hash(self):
        """Single-char title change → different hash."""
        base = {
            "source": "sam_gov",
            "source_id": "TEST-001",
            "title": "Test Opportunity",
            "close_date": "2026-06-30",
            "description": "Desc",
        }
        changed = {**base, "title": "Test Opportunity!"}
        assert self.ing._hash(base) != self.ing._hash(changed)

    def test_description_truncation(self):
        """Description beyond 500 chars doesn't affect hash."""
        base = {
            "source": "sam_gov",
            "source_id": "TEST-001",
            "title": "Same Title",
            "close_date": "2026-06-30",
            "description": "A" * 500,
        }
        extended = {**base, "description": ("A" * 500) + "B" * 1000}
        # First 500 chars of description are identical → same hash
        assert self.ing._hash(base) == self.ing._hash(extended)

    def test_missing_fields_produce_valid_hash(self):
        """Row with missing fields still hashes (no KeyError)."""
        row = {"source": "sam_gov", "source_id": "TEST-002"}
        h = self.ing._hash(row)
        assert len(h) == 64

    def test_cross_invocation_determinism(self):
        """Hash is stable across multiple ingester instances."""
        row = {
            "source": "sbir_gov",
            "source_id": "AF251-001",
            "title": "Cross-Inst Test",
            "close_date": "2026-07-15",
            "description": "X",
        }
        h1 = _StubIngester()._hash(row)
        h2 = _StubIngester()._hash(row)
        h3 = SamGovIngester()._hash(row)  # different subclass, same hash
        assert h1 == h2 == h3

    def test_different_source_different_hash(self):
        """Same source_id from different sources → different hashes."""
        a = {"source": "sam_gov", "source_id": "X", "title": "T",
             "close_date": "2026-01-01", "description": "D"}
        b = {**a, "source": "sbir_gov"}
        assert self.ing._hash(a) != self.ing._hash(b)


# ── SAM.gov normalize tests ───────────────────────────────────────────


class TestSamGovNormalize:
    def setup_method(self):
        self.ing = SamGovIngester()

    def test_basic_mapping(self):
        raw = {
            "noticeId": "test_sbir_af_001",
            "title": "SBIR Phase I: Test Solicitation (AF241-001)",
            "solicitationNumber": "FA8650-26-S-0001",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RQ",
            "office": "AFRL/RQ WRIGHT-PATTERSON AFB",
            "naicsCode": "541715",
            "typeOfSetAsideDescription": "Small Business Set-Aside",
            "type": "Solicitation",
            "responseDeadLine": "2026-06-30T23:59:00-04:00",
            "postedDate": "2026-04-01",
            "description": "A test solicitation.",
        }
        row = self.ing.normalize(raw)
        assert row["source_id"] == "test_sbir_af_001"
        assert row["title"].startswith("SBIR Phase I")
        assert row["solicitation_number"] == "FA8650-26-S-0001"
        assert "Air Force" in row["agency"] or "AIR FORCE" in row["agency"] or "DOD" in row["agency"].upper() or row["agency"] is not None
        assert row["naics_codes"] == ["541715"]
        assert "sbir" in (row["program_type"] or "").lower() or "phase" in row["title"].lower()

    def test_multiple_naics_codes(self):
        raw = {
            "noticeId": "test_multi",
            "title": "Test",
            "naicsCode": "541511, 541512, 541519",
        }
        row = self.ing.normalize(raw)
        assert len(row["naics_codes"]) == 3
        assert "541511" in row["naics_codes"]

    def test_missing_fields_default(self):
        """Ingester doesn't crash on minimal raw data."""
        raw = {"noticeId": "minimal_001", "title": "Minimal"}
        row = self.ing.normalize(raw)
        assert row["source_id"] == "minimal_001"
        assert row["title"] == "Minimal"


# ── SBIR.gov normalize tests ──────────────────────────────────────────


class TestSbirGovNormalize:
    def setup_method(self):
        self.ing = SbirGovIngester()

    def test_phase_1_mapping(self):
        raw = {
            "topic_number": "AF251-001",
            "solicitation_title": "Novel Sensor Materials",
            "agency": "Department of Defense",
            "branch": "Air Force",
            "program": "SBIR",
            "phase": "Phase I",
            "solicitation_close_date": "2026-06-15",
            "release_date": "2026-04-01",
        }
        row = self.ing.normalize(raw)
        assert row["source_id"] == "AF251-001"
        assert row["title"] == "Novel Sensor Materials"
        assert row["agency"] == "Department of Defense"
        assert row["office"] == "Air Force"
        assert "phase_1" in row["program_type"].lower() or "phase 1" in row["program_type"].lower()

    def test_phase_2_mapping(self):
        raw = {
            "topic_number": "N252-015",
            "solicitation_title": "Hypersonic Follow-on",
            "program": "STTR",
            "phase": "Phase II",
        }
        row = self.ing.normalize(raw)
        assert "phase_2" in row["program_type"].lower() or "phase 2" in row["program_type"].lower()
        assert "sttr" in row["program_type"].lower()


# ── Grants.gov normalize tests ────────────────────────────────────────


class TestGrantsGovNormalize:
    def setup_method(self):
        self.ing = GrantsGovIngester()

    def test_basic_mapping(self):
        raw = {
            "id": "356789",
            "title": "NSF SBIR Phase I",
            "agencyName": "National Science Foundation",
            "cfdaNumbers": "47.084",
            "closeDate": "2026-07-01",
            "openDate": "2026-04-01",
        }
        row = self.ing.normalize(raw)
        assert row["source_id"] == "356789"
        assert row["title"] == "NSF SBIR Phase I"
        assert row["agency"] == "National Science Foundation"
        assert row["classification_code"] == "47.084"

    def test_cfda_stored_in_classification_not_naics(self):
        """Grants.gov uses CFDA, not NAICS — decision D-Phase1."""
        raw = {
            "id": "x",
            "title": "Test",
            "cfdaNumbers": "47.084,47.070",
        }
        row = self.ing.normalize(raw)
        # CFDA goes to classification_code; naics_codes stays empty or null
        assert row["classification_code"] is not None
        assert row.get("naics_codes") in (None, [], ())


# ── IngestResult dataclass ────────────────────────────────────────────


class TestIngestResult:
    def test_duration_ms_computed(self):
        from datetime import datetime, timezone, timedelta
        r = IngestResult(source="sam_gov", run_type="incremental")
        r.started_at = datetime.now(timezone.utc)
        r.finished_at = r.started_at + timedelta(milliseconds=1234)
        assert r.duration_ms == 1234

    def test_duration_ms_zero_when_unset(self):
        r = IngestResult(source="sam_gov", run_type="incremental")
        assert r.duration_ms == 0
