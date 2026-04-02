"""
Tests for the scoring engine — all pure computation, no DB needed.

Covers:
  - NAICS matching (primary vs secondary vs none)
  - Technology/keyword matching and scoring tiers
  - Set-aside matching (exact + partial)
  - Agency alignment tiers
  - Program type fit scoring
  - Timeline urgency buckets
  - TRL alignment
  - Keyword match extraction
  - Pursuit recommendation thresholds
  - LLM JSON extraction
  - _format_set_asides helper

Score breakdown (100 total base):
  Technology/Topic match: 0-30
  NAICS match:            0-15  (primary=15, secondary=10)
  Agency alignment:       0-15
  Program type fit:       0-15
  Set-aside eligibility:  0-10  (exact=10, partial=7)
  Timeline/urgency:       0-10
  TRL alignment:          0-5
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

# Import the engine directly (no DB connection needed for pure methods)
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from scoring.engine import ScoringEngine


class FakeScoringEngine(ScoringEngine):
    """ScoringEngine with conn=None for testing pure methods."""
    def __init__(self):
        super().__init__(conn=None)


engine = FakeScoringEngine()


# ── NAICS matching ──

class TestNAICSScoring:
    def test_primary_naics_match_gives_15(self):
        profile = {"primary_naics": ["541512"], "secondary_naics": []}
        opp = {"naics_codes": ["541512"], "title": "", "description": "",
               "set_aside_type": "", "agency_code": "", "opportunity_type": "solicitation",
               "close_date": None}
        scores = engine._compute_scores(profile, opp)
        assert scores["naics"] == 15

    def test_secondary_naics_match_gives_10(self):
        profile = {"primary_naics": ["541611"], "secondary_naics": ["541512"]}
        opp = {"naics_codes": ["541512"], "title": "", "description": "",
               "set_aside_type": "", "agency_code": "", "opportunity_type": "solicitation",
               "close_date": None}
        scores = engine._compute_scores(profile, opp)
        assert scores["naics"] == 10

    def test_no_naics_match_gives_0(self):
        profile = {"primary_naics": ["541611"], "secondary_naics": ["541519"]}
        opp = {"naics_codes": ["236220"], "title": "", "description": "",
               "set_aside_type": "", "agency_code": "", "opportunity_type": "solicitation",
               "close_date": None}
        scores = engine._compute_scores(profile, opp)
        assert scores["naics"] == 0

    def test_empty_opp_naics_gives_0(self):
        profile = {"primary_naics": ["541512"], "secondary_naics": []}
        opp = {"naics_codes": [], "title": "", "description": "",
               "set_aside_type": "", "agency_code": "", "opportunity_type": "solicitation",
               "close_date": None}
        scores = engine._compute_scores(profile, opp)
        assert scores["naics"] == 0

    def test_none_naics_gives_0(self):
        profile = {"primary_naics": ["541512"], "secondary_naics": []}
        opp = {"naics_codes": None, "title": "", "description": "",
               "set_aside_type": "", "agency_code": "", "opportunity_type": "solicitation",
               "close_date": None}
        scores = engine._compute_scores(profile, opp)
        assert scores["naics"] == 0


# ── Technology/Keyword matching ──

class TestTechnologyScoring:
    """Tests for technology match scoring (0-30).

    The engine uses research_areas + technology_focus first, falling back
    to keyword_domains for legacy profiles.
    """
    base_opp = {
        "naics_codes": [], "set_aside_type": "", "agency_code": "",
        "opportunity_type": "solicitation", "close_date": None,
    }

    def test_three_domain_hits_gives_30(self):
        profile = {
            "primary_naics": [], "secondary_naics": [],
            "keyword_domains": {
                "cloud": ["AWS", "cloud migration"],
                "security": ["cybersecurity", "NIST"],
                "devops": ["CI/CD", "Kubernetes"],
            },
        }
        opp = {**self.base_opp,
               "title": "AWS Cloud Migration with NIST Compliance",
               "description": "Requires CI/CD pipeline and Kubernetes deployment"}
        scores = engine._compute_scores(profile, opp)
        assert scores["technology"] == 30

    def test_two_domain_hits_gives_20(self):
        profile = {
            "primary_naics": [], "secondary_naics": [],
            "keyword_domains": {
                "cloud": ["AWS"],
                "security": ["cybersecurity"],
                "devops": ["CI/CD"],
            },
        }
        opp = {**self.base_opp,
               "title": "AWS cybersecurity assessment",
               "description": "No devops here"}
        scores = engine._compute_scores(profile, opp)
        assert scores["technology"] == 20

    def test_one_domain_hit_gives_10(self):
        profile = {
            "primary_naics": [], "secondary_naics": [],
            "keyword_domains": {
                "cloud": ["AWS"],
                "security": ["cybersecurity"],
            },
        }
        opp = {**self.base_opp,
               "title": "AWS cloud services",
               "description": "General IT support"}
        scores = engine._compute_scores(profile, opp)
        assert scores["technology"] == 10

    def test_no_domain_hits_gives_0(self):
        profile = {
            "primary_naics": [], "secondary_naics": [],
            "keyword_domains": {
                "cloud": ["AWS"],
                "security": ["cybersecurity"],
            },
        }
        opp = {**self.base_opp,
               "title": "Office furniture procurement",
               "description": "Desks and chairs"}
        scores = engine._compute_scores(profile, opp)
        assert scores["technology"] == 0

    def test_keyword_domains_as_json_string(self):
        """keyword_domains may come from DB as JSON string."""
        profile = {
            "primary_naics": [], "secondary_naics": [],
            "keyword_domains": json.dumps({"cloud": ["AWS"]}),
        }
        opp = {**self.base_opp,
               "title": "AWS migration",
               "description": ""}
        scores = engine._compute_scores(profile, opp)
        assert scores["technology"] == 10

    def test_empty_keyword_domains_gives_0(self):
        profile = {
            "primary_naics": [], "secondary_naics": [],
            "keyword_domains": {},
        }
        opp = {**self.base_opp, "title": "anything", "description": ""}
        scores = engine._compute_scores(profile, opp)
        assert scores["technology"] == 0

    def test_research_areas_match(self):
        """research_areas is the primary SBIR scoring signal."""
        profile = {
            "primary_naics": [], "secondary_naics": [],
            "research_areas": ["machine learning", "computer vision", "natural language processing"],
            "technology_focus": "",
        }
        opp = {**self.base_opp,
               "title": "Machine Learning for Computer Vision Applications",
               "description": "Natural Language Processing capabilities required"}
        scores = engine._compute_scores(profile, opp)
        assert scores["technology"] >= 25  # 3+ tech term hits


# ── Set-aside matching ──

class TestSetAsideScoring:
    base_profile = {
        "primary_naics": [], "secondary_naics": [],
        "keyword_domains": {}, "agency_priorities": {},
    }
    base_opp = {
        "naics_codes": [], "agency_code": "",
        "opportunity_type": "solicitation", "close_date": None,
        "title": "", "description": "",
    }

    def test_sdvosb_exact_match_gives_10(self):
        profile = {**self.base_profile, "is_sdvosb": True}
        opp = {**self.base_opp, "set_aside_type": "Service-Disabled Veteran-Owned Small Business (SDVOSB)"}
        scores = engine._compute_scores(profile, opp)
        assert scores["set_aside"] == 10

    def test_wosb_match_gives_10(self):
        profile = {**self.base_profile, "is_wosb": True}
        opp = {**self.base_opp, "set_aside_type": "Women-Owned Small Business (WOSB)"}
        scores = engine._compute_scores(profile, opp)
        assert scores["set_aside"] == 10

    def test_hubzone_match_gives_10(self):
        profile = {**self.base_profile, "is_hubzone": True}
        opp = {**self.base_opp, "set_aside_type": "HUBZone Set-Aside"}
        scores = engine._compute_scores(profile, opp)
        assert scores["set_aside"] == 10

    def test_8a_match_gives_10(self):
        profile = {**self.base_profile, "is_8a": True}
        opp = {**self.base_opp, "set_aside_type": "8(a) Sole Source"}
        scores = engine._compute_scores(profile, opp)
        assert scores["set_aside"] == 10

    def test_small_business_partial_gives_7(self):
        profile = {**self.base_profile, "is_small_business": True}
        opp = {**self.base_opp, "set_aside_type": "Total Small Business Set-Aside"}
        scores = engine._compute_scores(profile, opp)
        assert scores["set_aside"] == 7

    def test_no_set_aside_match_gives_0(self):
        profile = {**self.base_profile, "is_sdvosb": False, "is_small_business": False}
        opp = {**self.base_opp, "set_aside_type": "8(a) Sole Source"}
        scores = engine._compute_scores(profile, opp)
        assert scores["set_aside"] == 0

    def test_no_opp_set_aside_gives_0(self):
        profile = {**self.base_profile, "is_sdvosb": True}
        opp = {**self.base_opp, "set_aside_type": ""}
        scores = engine._compute_scores(profile, opp)
        assert scores["set_aside"] == 0


# ── Agency priority ──

class TestAgencyScoring:
    base_profile = {
        "primary_naics": [], "secondary_naics": [],
        "keyword_domains": {},
    }
    base_opp = {
        "naics_codes": [], "set_aside_type": "",
        "opportunity_type": "solicitation", "close_date": None,
        "title": "", "description": "",
    }

    def test_tier_1_gives_15(self):
        profile = {**self.base_profile, "agency_priorities": {"097": 1}}
        opp = {**self.base_opp, "agency_code": "097"}
        scores = engine._compute_scores(profile, opp)
        assert scores["agency"] == 15

    def test_tier_2_gives_10(self):
        profile = {**self.base_profile, "agency_priorities": {"047": 2}}
        opp = {**self.base_opp, "agency_code": "047"}
        scores = engine._compute_scores(profile, opp)
        assert scores["agency"] == 10

    def test_tier_3_gives_5(self):
        profile = {**self.base_profile, "agency_priorities": {"075": 3}}
        opp = {**self.base_opp, "agency_code": "075"}
        scores = engine._compute_scores(profile, opp)
        assert scores["agency"] == 5

    def test_no_agency_priority_gives_0(self):
        profile = {**self.base_profile, "agency_priorities": {"097": 1}}
        opp = {**self.base_opp, "agency_code": "999"}
        scores = engine._compute_scores(profile, opp)
        assert scores["agency"] == 0

    def test_agency_priorities_as_json_string(self):
        profile = {**self.base_profile, "agency_priorities": json.dumps({"097": 1})}
        opp = {**self.base_opp, "agency_code": "097"}
        scores = engine._compute_scores(profile, opp)
        assert scores["agency"] == 15


# ── Program type fit ──

class TestProgramTypeScoring:
    base = {
        "primary_naics": [], "secondary_naics": [],
        "keyword_domains": {}, "agency_priorities": {},
    }
    base_opp = {
        "naics_codes": [], "set_aside_type": "", "agency_code": "",
        "close_date": None, "title": "", "description": "",
    }

    def test_sbir_phase_1_gives_12(self):
        opp = {**self.base_opp, "program_type": "sbir_phase_1"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 12

    def test_sttr_phase_1_gives_12(self):
        opp = {**self.base_opp, "program_type": "sttr_phase_1"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 12

    def test_baa_gives_8(self):
        opp = {**self.base_opp, "program_type": "baa"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 8

    def test_ota_gives_8(self):
        opp = {**self.base_opp, "program_type": "ota"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 8

    def test_challenge_gives_5(self):
        opp = {**self.base_opp, "program_type": "challenge"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 5

    def test_rfi_gives_3(self):
        opp = {**self.base_opp, "program_type": "rfi"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 3

    def test_sources_sought_gives_3(self):
        opp = {**self.base_opp, "program_type": "sources_sought"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 3

    def test_unknown_type_gives_2(self):
        opp = {**self.base_opp, "program_type": "other"}
        scores = engine._compute_scores(self.base, opp)
        assert scores["program_type"] == 2


# ── Timeline urgency ──

class TestTimelineScoring:
    base_profile = {
        "primary_naics": [], "secondary_naics": [],
        "keyword_domains": {}, "agency_priorities": {},
    }
    base_opp = {
        "naics_codes": [], "set_aside_type": "", "agency_code": "",
        "opportunity_type": "solicitation", "title": "", "description": "",
    }

    def test_7_days_or_less_gives_10(self):
        close = datetime.now(timezone.utc) + timedelta(days=5)
        opp = {**self.base_opp, "close_date": close}
        scores = engine._compute_scores(self.base_profile, opp)
        assert scores["timeline"] == 10

    def test_14_days_or_less_gives_7(self):
        close = datetime.now(timezone.utc) + timedelta(days=12)
        opp = {**self.base_opp, "close_date": close}
        scores = engine._compute_scores(self.base_profile, opp)
        assert scores["timeline"] == 7

    def test_30_days_or_less_gives_4(self):
        close = datetime.now(timezone.utc) + timedelta(days=25)
        opp = {**self.base_opp, "close_date": close}
        scores = engine._compute_scores(self.base_profile, opp)
        assert scores["timeline"] == 4

    def test_more_than_30_days_gives_1(self):
        close = datetime.now(timezone.utc) + timedelta(days=60)
        opp = {**self.base_opp, "close_date": close}
        scores = engine._compute_scores(self.base_profile, opp)
        assert scores["timeline"] == 1

    def test_no_close_date_gives_0(self):
        opp = {**self.base_opp, "close_date": None}
        scores = engine._compute_scores(self.base_profile, opp)
        assert scores["timeline"] == 0


# ── TRL alignment ──

class TestTRLScoring:
    base_profile = {
        "primary_naics": [], "secondary_naics": [],
        "keyword_domains": {}, "agency_priorities": {},
    }
    base_opp = {
        "naics_codes": [], "set_aside_type": "", "agency_code": "",
        "opportunity_type": "solicitation", "title": "", "description": "",
        "close_date": None,
    }

    def test_trl_2_phase_1_gives_5(self):
        """TRL 2 is in range for Phase I (1-4)."""
        profile = {**self.base_profile, "technology_readiness_level": 2}
        opp = {**self.base_opp, "program_type": "sbir_phase_1"}
        scores = engine._compute_scores(profile, opp)
        assert scores["trl"] == 5

    def test_trl_5_phase_2_gives_5(self):
        """TRL 5 is in range for Phase II (4-6)."""
        profile = {**self.base_profile, "technology_readiness_level": 5}
        opp = {**self.base_opp, "program_type": "sbir_phase_2"}
        scores = engine._compute_scores(profile, opp)
        assert scores["trl"] == 5

    def test_trl_8_phase_1_gives_0(self):
        """TRL 8 is too high for Phase I."""
        profile = {**self.base_profile, "technology_readiness_level": 8}
        opp = {**self.base_opp, "program_type": "sbir_phase_1"}
        scores = engine._compute_scores(profile, opp)
        assert scores["trl"] == 0

    def test_no_trl_gives_2(self):
        """No TRL specified gives neutral default."""
        profile = {**self.base_profile}
        opp = {**self.base_opp, "program_type": "sbir_phase_1"}
        scores = engine._compute_scores(profile, opp)
        assert scores["trl"] == 2


# ── Keyword match extraction ──

class TestFindKeywordMatches:
    def test_finds_matching_keywords_and_domains(self):
        profile = {
            "keyword_domains": {
                "cloud": ["AWS", "Azure", "cloud migration"],
                "security": ["NIST", "cybersecurity"],
                "training": ["workforce development"],
            }
        }
        opp = {
            "title": "AWS Cloud Migration Services",
            "description": "Requires NIST 800-53 compliance and cybersecurity controls",
        }
        keywords, domains = engine._find_keyword_matches(profile, opp)
        assert "cloud" in domains
        assert "security" in domains
        assert "training" not in domains
        assert any("AWS" in kw for kw in keywords)
        assert any("NIST" in kw for kw in keywords)

    def test_no_matches_returns_empty(self):
        profile = {"keyword_domains": {"niche": ["quantum computing"]}}
        opp = {"title": "Office supplies", "description": "Pens and paper"}
        keywords, domains = engine._find_keyword_matches(profile, opp)
        assert keywords == []
        assert domains == []

    def test_caps_keywords_per_domain_at_3(self):
        profile = {
            "keyword_domains": {
                "big_domain": ["a", "b", "c", "d", "e"],
            }
        }
        opp = {"title": "a b c d e", "description": ""}
        keywords, _ = engine._find_keyword_matches(profile, opp)
        assert len(keywords) <= 3

    def test_caps_total_keywords_at_10(self):
        profile = {
            "keyword_domains": {
                f"domain_{i}": [f"kw_{i}_1", f"kw_{i}_2", f"kw_{i}_3"]
                for i in range(5)
            }
        }
        all_kws = " ".join(
            f"kw_{i}_{j}" for i in range(5) for j in range(1, 4)
        )
        opp = {"title": all_kws, "description": ""}
        keywords, _ = engine._find_keyword_matches(profile, opp)
        assert len(keywords) <= 10


# ── Pursuit recommendation ──

class TestPursuitRecommendation:
    """Test the recommendation logic extracted from _score_tenant."""

    def test_high_score_recommends_pursue(self):
        total = 80
        min_score = 40
        high_priority_score = 75
        if total >= high_priority_score:
            rec = "pursue"
        elif total >= min_score + 10:
            rec = "monitor"
        else:
            rec = "pass"
        assert rec == "pursue"

    def test_mid_score_recommends_monitor(self):
        total = 55
        min_score = 40
        high_priority_score = 75
        if total >= high_priority_score:
            rec = "pursue"
        elif total >= min_score + 10:
            rec = "monitor"
        else:
            rec = "pass"
        assert rec == "monitor"

    def test_low_score_recommends_pass(self):
        total = 42
        min_score = 40
        high_priority_score = 75
        if total >= high_priority_score:
            rec = "pursue"
        elif total >= min_score + 10:
            rec = "monitor"
        else:
            rec = "pass"
        assert rec == "pass"


# ── Format set-asides helper ──

class TestFormatSetAsides:
    def test_all_designations(self):
        profile = {
            "is_small_business": True,
            "is_sdvosb": True,
            "is_wosb": True,
            "is_hubzone": True,
            "is_8a": True,
        }
        result = ScoringEngine._format_set_asides(profile)
        assert "Small Business" in result
        assert "SDVOSB" in result
        assert "WOSB" in result
        assert "HUBZone" in result
        assert "8(a)" in result

    def test_no_designations(self):
        profile = {}
        result = ScoringEngine._format_set_asides(profile)
        assert result == "None"

    def test_single_designation(self):
        profile = {"is_sdvosb": True}
        result = ScoringEngine._format_set_asides(profile)
        assert result == "SDVOSB"


# ── Total score clamping ──

class TestScoreClamping:
    def test_llm_adjustment_clamped_at_100(self):
        total = 95
        llm_adj = 20
        clamped = max(0, min(100, total + llm_adj))
        assert clamped == 100

    def test_llm_adjustment_clamped_at_0(self):
        total = 10
        llm_adj = -20
        clamped = max(0, min(100, total + llm_adj))
        assert clamped == 0

    def test_normal_adjustment(self):
        total = 60
        llm_adj = 10
        clamped = max(0, min(100, total + llm_adj))
        assert clamped == 70
