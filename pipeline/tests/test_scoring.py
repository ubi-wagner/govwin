"""Unit tests for the scoring subsystem.

The top-level match_tenants() function in workflows/actions/score_tenants.py
requires a live asyncpg connection to query the DB and emit events — those
paths are skip-guarded below with a clear reason.

The private helper _calculate_match_scores() is a pure function that takes
two plain dicts and returns a scores dict.  All scoring-factor math is
exercised here without any DB or I/O.

Scoring factors (documented in the source):
  NAICS overlap:      0-30 pts  (proportional to overlap fraction × 30)
  Keyword overlap:    0-25 pts  (matched keywords × 5, capped at 25)
  Agency preference:  0-20 pts  (binary: 20 if agency in profile, else 0)
  Set-aside match:    0-10 pts  (binary: 10 if set_aside_type in profile, else 0)
  Program type:          0 pts  (deferred — no program_preferences column yet)
  Timeline proximity: 0-5  pts  (5 if <30 days, 3 if <60, 1 if <90, 0 otherwise)
  Max achievable:       90 pts  (cap at 100, but type_score=0 so real max is 90)
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

import pytest

from workflows.actions.score_tenants import (
    _calculate_match_scores,
    _calculate_bucket_scores,
    SPOTLIGHT_BUCKETS,
)


# ---------------------------------------------------------------------------
# Fixtures / factory helpers
# ---------------------------------------------------------------------------

def _sol(**overrides) -> dict:
    """Return a minimal solicitation (opportunity row) dict."""
    base = {
        "naics_codes": [],
        "agency": "",
        "tech_focus_areas": [],
        "set_aside_type": None,
        "title": "",
        "description": "",
        "program_type": None,
        "close_date": None,
    }
    base.update(overrides)
    return base


def _profile(**overrides) -> dict:
    """Return a minimal tenant profile dict."""
    base = {
        "naics_codes": [],
        "keywords": [],
        "agency_priorities": [],
        "set_aside_types": [],
        "technology_focus": "",
        "research_areas": [],
        "target_agencies": [],
        "min_surface_score": 40,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# NAICS score (0-30 pts)
# ---------------------------------------------------------------------------

class TestNaicsScore:
    def test_no_overlap_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(naics_codes=["541715"]),
            _profile(naics_codes=["999999"]),
        )
        assert scores["naics_score"] == 0

    def test_full_overlap_single_code_scores_30(self):
        scores = _calculate_match_scores(
            _sol(naics_codes=["541715"]),
            _profile(naics_codes=["541715"]),
        )
        assert scores["naics_score"] == 30

    def test_partial_overlap_scores_proportionally(self):
        # sol has 2 codes, profile matches 1 → overlap/max(sol,1) = 1/2 → 15 pts
        scores = _calculate_match_scores(
            _sol(naics_codes=["541715", "518210"]),
            _profile(naics_codes=["541715"]),
        )
        assert scores["naics_score"] == 15

    def test_empty_sol_naics_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(naics_codes=[]),
            _profile(naics_codes=["541715"]),
        )
        assert scores["naics_score"] == 0

    def test_empty_profile_naics_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(naics_codes=["541715"]),
            _profile(naics_codes=[]),
        )
        assert scores["naics_score"] == 0

    def test_multiple_matches_capped_at_30(self):
        # 3/3 overlap = 30 pts (not 90)
        scores = _calculate_match_scores(
            _sol(naics_codes=["541715", "518210", "541511"]),
            _profile(naics_codes=["541715", "518210", "541511"]),
        )
        assert scores["naics_score"] == 30


# ---------------------------------------------------------------------------
# Keyword / tech-focus score (0-25 pts, each match = 5 pts)
# ---------------------------------------------------------------------------

class TestKeywordScore:
    def test_no_keyword_match_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=["quantum computing"], description="", title=""),
            _profile(keywords=["machine learning"]),
        )
        assert scores["keyword_score"] == 0

    def test_tech_focus_area_matches_profile_keyword(self):
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=["machine learning"]),
            _profile(keywords=["machine learning"]),
        )
        assert scores["keyword_score"] == 5
        assert "machine learning" in scores["matched_keywords"]

    def test_keyword_matched_in_description(self):
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=[], description="We research autonomous systems here."),
            _profile(keywords=["autonomous systems"]),
        )
        assert scores["keyword_score"] == 5
        assert "autonomous systems" in scores["matched_keywords"]

    def test_keyword_matched_in_title(self):
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=[], title="SBIR: Quantum Radar Research", description=""),
            _profile(keywords=["quantum radar"]),
        )
        assert scores["keyword_score"] == 5

    def test_multiple_keywords_accumulate(self):
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=["AI", "robotics", "sensors"]),
            _profile(keywords=["AI", "robotics", "sensors"]),
        )
        assert scores["keyword_score"] == 15

    def test_keyword_score_capped_at_25(self):
        # 6 matches × 5 = 30 → capped at 25
        keywords = ["kw1", "kw2", "kw3", "kw4", "kw5", "kw6"]
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=keywords),
            _profile(keywords=keywords),
        )
        assert scores["keyword_score"] == 25

    def test_matched_keywords_list_capped_at_20(self):
        """matched_keywords returned must be ≤ 20 entries."""
        many_kw = [f"kw{i}" for i in range(25)]
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=many_kw),
            _profile(keywords=many_kw),
        )
        assert len(scores["matched_keywords"]) <= 20

    def test_tech_focus_area_matches_technology_focus_text(self):
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=["machine learning"]),
            _profile(keywords=[], technology_focus="machine learning"),
        )
        assert scores["keyword_score"] == 5

    def test_tech_focus_area_matches_research_areas(self):
        scores = _calculate_match_scores(
            _sol(tech_focus_areas=["quantum computing"]),
            _profile(keywords=[], research_areas=["quantum computing"]),
        )
        assert scores["keyword_score"] == 5


# ---------------------------------------------------------------------------
# Agency score (0-20 pts — binary)
# ---------------------------------------------------------------------------

class TestAgencyScore:
    def test_agency_in_priorities_scores_20(self):
        scores = _calculate_match_scores(
            _sol(agency="dept of defense"),
            _profile(agency_priorities=["dept of defense"]),
        )
        assert scores["agency_score"] == 20

    def test_agency_in_target_agencies_scores_20(self):
        scores = _calculate_match_scores(
            _sol(agency="national science foundation"),
            _profile(agency_priorities=[], target_agencies=["national science foundation"]),
        )
        assert scores["agency_score"] == 20

    def test_agency_not_in_profile_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(agency="dept of energy"),
            _profile(agency_priorities=["dept of defense"]),
        )
        assert scores["agency_score"] == 0

    def test_agency_match_is_case_insensitive(self):
        scores = _calculate_match_scores(
            _sol(agency="DEPT OF DEFENSE"),
            _profile(agency_priorities=["dept of defense"]),
        )
        assert scores["agency_score"] == 20

    def test_empty_sol_agency_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(agency=""),
            _profile(agency_priorities=["dept of defense"]),
        )
        assert scores["agency_score"] == 0


# ---------------------------------------------------------------------------
# Set-aside score (0-10 pts — binary)
# ---------------------------------------------------------------------------

class TestSetAsideScore:
    def test_set_aside_match_scores_10(self):
        scores = _calculate_match_scores(
            _sol(set_aside_type="small business set-aside"),
            _profile(set_aside_types=["small business set-aside"]),
        )
        assert scores["set_aside_score"] == 10

    def test_set_aside_mismatch_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(set_aside_type="8(a)"),
            _profile(set_aside_types=["small business set-aside"]),
        )
        assert scores["set_aside_score"] == 0

    def test_no_set_aside_on_sol_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(set_aside_type=None),
            _profile(set_aside_types=["small business set-aside"]),
        )
        assert scores["set_aside_score"] == 0

    def test_set_aside_match_is_case_insensitive(self):
        scores = _calculate_match_scores(
            _sol(set_aside_type="SMALL BUSINESS SET-ASIDE"),
            _profile(set_aside_types=["small business set-aside"]),
        )
        assert scores["set_aside_score"] == 10


# ---------------------------------------------------------------------------
# Program type score (always 0 in V1 — no profile column yet)
# ---------------------------------------------------------------------------

class TestProgramTypeScore:
    def test_type_score_is_zero(self):
        """No program_preferences column exists in V1 — type_score must be 0."""
        scores = _calculate_match_scores(
            _sol(program_type="sbir_phase_1"),
            _profile(),
        )
        assert scores["type_score"] == 0


# ---------------------------------------------------------------------------
# Timeline score (0-5 pts)
# ---------------------------------------------------------------------------

class TestTimelineScore:
    def _sol_with_close(self, days: int) -> dict:
        return _sol(close_date=datetime.now(timezone.utc) + timedelta(days=days))

    def test_within_30_days_scores_5(self):
        scores = _calculate_match_scores(self._sol_with_close(15), _profile())
        assert scores["timeline_score"] == 5

    def test_exactly_30_days_scores_5(self):
        # days_until_close = 30 → condition is 0 < d <= 30 → True
        scores = _calculate_match_scores(self._sol_with_close(30), _profile())
        assert scores["timeline_score"] == 5

    def test_31_to_60_days_scores_3(self):
        scores = _calculate_match_scores(self._sol_with_close(45), _profile())
        assert scores["timeline_score"] == 3

    def test_61_to_90_days_scores_1(self):
        scores = _calculate_match_scores(self._sol_with_close(75), _profile())
        assert scores["timeline_score"] == 1

    def test_over_90_days_scores_zero(self):
        scores = _calculate_match_scores(self._sol_with_close(100), _profile())
        assert scores["timeline_score"] == 0

    def test_past_close_date_scores_zero(self):
        scores = _calculate_match_scores(
            _sol(close_date=datetime.now(timezone.utc) - timedelta(days=1)),
            _profile(),
        )
        assert scores["timeline_score"] == 0

    def test_no_close_date_scores_zero(self):
        scores = _calculate_match_scores(_sol(close_date=None), _profile())
        assert scores["timeline_score"] == 0


# ---------------------------------------------------------------------------
# Total score composition and cap
# ---------------------------------------------------------------------------

class TestTotalScore:
    def test_all_zeros_gives_zero_total(self):
        scores = _calculate_match_scores(_sol(), _profile())
        assert scores["total_score"] == 0

    def test_total_equals_sum_of_factors(self):
        sol = _sol(
            naics_codes=["541715"],
            agency="dept of defense",
            tech_focus_areas=["ai"],
            set_aside_type="small business set-aside",
            close_date=datetime.now(timezone.utc) + timedelta(days=15),
        )
        profile = _profile(
            naics_codes=["541715"],
            agency_priorities=["dept of defense"],
            keywords=["ai"],
            set_aside_types=["small business set-aside"],
        )
        scores = _calculate_match_scores(sol, profile)
        expected = (
            scores["naics_score"]
            + scores["keyword_score"]
            + scores["agency_score"]
            + scores["set_aside_score"]
            + scores["type_score"]
            + scores["timeline_score"]
        )
        assert scores["total_score"] == min(expected, 100)

    def test_total_never_exceeds_100(self):
        """Even with all factors maximised, total is capped at 100."""
        keywords = [f"kw{i}" for i in range(6)]
        sol = _sol(
            naics_codes=["541715"],
            agency="dept of defense",
            tech_focus_areas=keywords,
            set_aside_type="small business set-aside",
            close_date=datetime.now(timezone.utc) + timedelta(days=5),
        )
        profile = _profile(
            naics_codes=["541715"],
            agency_priorities=["dept of defense"],
            keywords=keywords,
            set_aside_types=["small business set-aside"],
        )
        scores = _calculate_match_scores(sol, profile)
        assert scores["total_score"] <= 100

    def test_result_dict_has_all_expected_keys(self):
        scores = _calculate_match_scores(_sol(), _profile())
        expected_keys = {
            "total_score", "naics_score", "keyword_score", "agency_score",
            "set_aside_score", "type_score", "timeline_score", "matched_keywords",
        }
        assert expected_keys == set(scores.keys())


# ---------------------------------------------------------------------------
# match_tenants() — DB-required, skip-guarded
# ---------------------------------------------------------------------------

@pytest.mark.skip(
    reason=(
        "match_tenants() requires a live asyncpg connection to query "
        "curated_solicitations, opportunities, tenants, tenant_profiles, and "
        "emit system_events rows. No test DB is available in this environment. "
        "Run integration tests against a real DB with 'make test-integration'."
    )
)
async def test_match_tenants_requires_live_db():
    from workflows.actions.score_tenants import match_tenants
    await match_tenants(conn=None, solicitation_id="00000000-0000-0000-0000-000000000000")


# ---------------------------------------------------------------------------
# Spotlight bucket scoring (C5) — _calculate_bucket_scores
# ---------------------------------------------------------------------------

class TestBucketScores:
    """Per-bucket scores are deterministic, 0-100, and derived from the existing
    match component scores."""

    def _scores(self, **overrides) -> dict:
        base = {
            "total_score": 0, "naics_score": 0, "keyword_score": 0,
            "agency_score": 0, "set_aside_score": 0, "type_score": 0,
            "timeline_score": 0, "matched_keywords": [],
        }
        base.update(overrides)
        return base

    def test_returns_all_five_buckets(self):
        out = _calculate_bucket_scores(self._scores())
        assert set(out.keys()) == set(SPOTLIGHT_BUCKETS)

    def test_zero_signals_zero_buckets(self):
        out = _calculate_bucket_scores(self._scores())
        assert all(v == 0 for v in out.values())

    def test_all_scores_clamped_0_100(self):
        # Max out every component; every bucket must stay within [0, 100].
        out = _calculate_bucket_scores(self._scores(
            naics_score=30, keyword_score=25, agency_score=20,
            set_aside_score=10, timeline_score=5,
        ))
        assert all(0 <= v <= 100 for v in out.values())

    def test_keyword_drives_technology_innovation(self):
        out = _calculate_bucket_scores(self._scores(keyword_score=25))
        assert out["technology_innovation"] == 100  # 25 * 4.0, clamped
        # A bucket that doesn't weight keyword stays low.
        assert out["prior_funding"] == 0

    def test_agency_drives_prior_funding_and_capabilities(self):
        out = _calculate_bucket_scores(self._scores(agency_score=20))
        assert out["prior_funding"] == 80   # 20 * 4.0
        assert out["capabilities"] == 40    # 20 * 2.0
        assert out["technology_innovation"] == 0

    def test_readiness_uses_timeline_and_set_aside(self):
        out = _calculate_bucket_scores(self._scores(timeline_score=5, set_aside_score=10))
        # 5*8 + 10*6 = 100, clamped
        assert out["readiness"] == 100

    def test_integration_with_match_scores_shape(self):
        # The output of _calculate_match_scores feeds straight in.
        scores = _calculate_match_scores(
            _sol(naics_codes=["541715"], agency="DARPA"),
            _profile(naics_codes=["541715"], target_agencies=["DARPA"]),
        )
        out = _calculate_bucket_scores(scores)
        assert set(out.keys()) == set(SPOTLIGHT_BUCKETS)
        assert all(isinstance(v, int) and 0 <= v <= 100 for v in out.values())
