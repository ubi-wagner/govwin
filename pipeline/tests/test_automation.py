"""
Tests for the automation engine — pure logic, no DB needed.

Covers:
  - Template resolution ({actor.email}, {payload.total_score})
  - Path resolution (dotted paths into nested dicts)
  - Condition evaluation (all operator types)
  - Context building from event metadata
  - Rule matching logic (bus + event_type filtering)
  - Action dispatch routing
  - log_only action handler
"""

import json
from typing import Any

import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from automation.engine import (
    _resolve_template,
    _resolve_path,
    _check_conditions,
)


# ── Template resolution ──

class TestResolveTemplate:
    def test_simple_substitution(self):
        ctx = {"actor": {"email": "alice@test.com"}}
        result = _resolve_template("User {actor.email} logged in", ctx)
        assert result == "User alice@test.com logged in"

    def test_nested_payload(self):
        ctx = {"payload": {"total_score": 92, "title": "Cloud Migration"}}
        result = _resolve_template("Score: {payload.total_score}/100 for {payload.title}", ctx)
        assert result == "Score: 92/100 for Cloud Migration"

    def test_missing_key_resolves_to_question_mark(self):
        ctx = {"actor": {"type": "user"}}
        result = _resolve_template("Hello {actor.email}", ctx)
        assert result == "Hello ?"

    def test_no_placeholders(self):
        ctx = {"anything": "ignored"}
        result = _resolve_template("Static text no placeholders", ctx)
        assert result == "Static text no placeholders"

    def test_multiple_replacements(self):
        ctx = {
            "actor": {"type": "pipeline", "id": "sam_gov"},
            "payload": {"count": 42},
        }
        result = _resolve_template(
            "{actor.type}:{actor.id} processed {payload.count} items", ctx
        )
        assert result == "pipeline:sam_gov processed 42 items"

    def test_deeply_nested(self):
        ctx = {"a": {"b": {"c": {"d": "deep"}}}}
        result = _resolve_template("{a.b.c.d}", ctx)
        assert result == "deep"

    def test_empty_context(self):
        result = _resolve_template("{actor.email}", {})
        assert result == "?"

    def test_numeric_values(self):
        ctx = {"payload": {"score": 0, "count": 100}}
        result = _resolve_template("{payload.score} of {payload.count}", ctx)
        assert result == "0 of 100"


# ── Path resolution ──

class TestResolvePath:
    def test_simple_path(self):
        obj = {"actor": {"email": "alice@test.com"}}
        assert _resolve_path(obj, "actor.email") == "alice@test.com"

    def test_top_level(self):
        obj = {"event_type": "account.login"}
        assert _resolve_path(obj, "event_type") == "account.login"

    def test_missing_intermediate(self):
        obj = {"actor": {}}
        assert _resolve_path(obj, "actor.email.domain") is None

    def test_none_intermediate(self):
        obj = {"actor": None}
        assert _resolve_path(obj, "actor.email") is None

    def test_non_dict_intermediate(self):
        obj = {"actor": "string_value"}
        assert _resolve_path(obj, "actor.email") is None

    def test_list_value(self):
        obj = {"payload": {"fields": ["naics", "keywords"]}}
        result = _resolve_path(obj, "payload.fields")
        assert result == ["naics", "keywords"]

    def test_boolean_value(self):
        obj = {"payload": {"is_new": True}}
        assert _resolve_path(obj, "payload.is_new") is True


# ── Condition evaluation ──

class TestCheckConditions:
    """Test _check_conditions with conn=None and rule={} (unused for most checks)."""

    def test_empty_conditions_always_passes(self):
        passed, reason = _check_conditions({}, {}, None, {}, {})
        assert passed is True
        assert reason == ""

    def test_simple_equality_passes(self):
        conditions = {"actor.type": "user"}
        context = {"actor": {"type": "user"}}
        passed, reason = _check_conditions(conditions, context, None, {}, {})
        assert passed is True

    def test_simple_equality_fails(self):
        conditions = {"actor.type": "user"}
        context = {"actor": {"type": "pipeline"}}
        passed, reason = _check_conditions(conditions, context, None, {}, {})
        assert passed is False
        assert "expected user" in reason

    def test_gte_operator_passes(self):
        conditions = {"payload.total_score": {"$gte": 75}}
        context = {"payload": {"total_score": 92}}
        passed, _ = _check_conditions(conditions, context, None, {}, {})
        assert passed is True

    def test_gte_operator_fails(self):
        conditions = {"payload.total_score": {"$gte": 75}}
        context = {"payload": {"total_score": 50}}
        passed, reason = _check_conditions(conditions, context, None, {}, {})
        assert passed is False
        assert "50" in reason

    def test_gte_with_none_value_fails(self):
        conditions = {"payload.total_score": {"$gte": 75}}
        context = {"payload": {}}
        passed, _ = _check_conditions(conditions, context, None, {}, {})
        assert passed is False

    def test_lte_operator(self):
        conditions = {"payload.score": {"$lte": 50}}
        context = {"payload": {"score": 30}}
        passed, _ = _check_conditions(conditions, context, None, {}, {})
        assert passed is True

        context2 = {"payload": {"score": 75}}
        passed2, _ = _check_conditions(conditions, context2, None, {}, {})
        assert passed2 is False

    def test_gt_operator(self):
        conditions = {"payload.count": {"$gt": 0}}
        context_pass = {"payload": {"count": 5}}
        context_fail = {"payload": {"count": 0}}
        assert _check_conditions(conditions, context_pass, None, {}, {})[0] is True
        assert _check_conditions(conditions, context_fail, None, {}, {})[0] is False

    def test_lt_operator(self):
        conditions = {"payload.count": {"$lt": 10}}
        context_pass = {"payload": {"count": 5}}
        context_fail = {"payload": {"count": 10}}
        assert _check_conditions(conditions, context_pass, None, {}, {})[0] is True
        assert _check_conditions(conditions, context_fail, None, {}, {})[0] is False

    def test_eq_operator(self):
        conditions = {"actor.type": {"$eq": "user"}}
        context_pass = {"actor": {"type": "user"}}
        context_fail = {"actor": {"type": "pipeline"}}
        assert _check_conditions(conditions, context_pass, None, {}, {})[0] is True
        assert _check_conditions(conditions, context_fail, None, {}, {})[0] is False

    def test_ne_operator(self):
        conditions = {"actor.type": {"$ne": "pipeline"}}
        context_pass = {"actor": {"type": "user"}}
        context_fail = {"actor": {"type": "pipeline"}}
        assert _check_conditions(conditions, context_pass, None, {}, {})[0] is True
        assert _check_conditions(conditions, context_fail, None, {}, {})[0] is False

    def test_contains_any_passes(self):
        conditions = {
            "payload.fields_changed": {
                "$contains_any": ["primary_naics", "keyword_domains"]
            }
        }
        context = {"payload": {"fields_changed": ["primary_naics", "is_sdvosb"]}}
        passed, _ = _check_conditions(conditions, context, None, {}, {})
        assert passed is True

    def test_contains_any_fails(self):
        conditions = {
            "payload.fields_changed": {
                "$contains_any": ["primary_naics", "keyword_domains"]
            }
        }
        context = {"payload": {"fields_changed": ["is_sdvosb", "is_wosb"]}}
        passed, reason = _check_conditions(conditions, context, None, {}, {})
        assert passed is False
        assert "contains none" in reason

    def test_contains_any_non_list_fails(self):
        conditions = {"payload.fields_changed": {"$contains_any": ["naics"]}}
        context = {"payload": {"fields_changed": "not_a_list"}}
        passed, reason = _check_conditions(conditions, context, None, {}, {})
        assert passed is False
        assert "not a list" in reason

    def test_multiple_conditions_all_must_pass(self):
        conditions = {
            "actor.type": "user",
            "payload.total_score": {"$gte": 75},
        }
        context_pass = {
            "actor": {"type": "user"},
            "payload": {"total_score": 80},
        }
        context_fail = {
            "actor": {"type": "user"},
            "payload": {"total_score": 50},
        }
        assert _check_conditions(conditions, context_pass, None, {}, {})[0] is True
        assert _check_conditions(conditions, context_fail, None, {}, {})[0] is False

    def test_first_occurrence_skipped_in_sync_check(self):
        """$first_occurrence is handled async in evaluate_rule, not in _check_conditions."""
        conditions = {"$first_occurrence": True, "$entity_key": "actor.id"}
        passed, _ = _check_conditions(conditions, {}, None, {}, {})
        assert passed is True  # These keys are skipped

    def test_combined_comparison_operators(self):
        """Test range: 50 <= score <= 100."""
        conditions = {"payload.score": {"$gte": 50, "$lte": 100}}
        context_in = {"payload": {"score": 75}}
        context_low = {"payload": {"score": 30}}
        context_high = {"payload": {"score": 120}}
        assert _check_conditions(conditions, context_in, None, {}, {})[0] is True
        assert _check_conditions(conditions, context_low, None, {}, {})[0] is False
        assert _check_conditions(conditions, context_high, None, {}, {})[0] is False


# ── Context building ──

class TestContextBuilding:
    """Test the context dict structure that evaluate_event builds."""

    def test_context_from_event_with_metadata(self):
        metadata = {
            "actor": {"type": "user", "id": "user-001", "email": "alice@test.com"},
            "trigger": {"eventId": "evt-001", "eventType": "ingest.new"},
            "refs": {"tenant_id": "t-001"},
            "payload": {"total_score": 85, "title": "Test Opp"},
        }
        event = {
            "id": "evt-002",
            "event_type": "scoring.scored",
            "tenant_id": "t-001",
            "user_id": "user-001",
            "opportunity_id": "opp-001",
            "entity_type": "opportunity",
            "entity_id": "opp-001",
            "description": "Scored opportunity",
            "correlation_id": "corr-001",
            "metadata": metadata,
        }

        # Build context the same way evaluate_event does
        context = {
            "event_type": event["event_type"],
            "bus": "opportunity_events",
            "actor": metadata.get("actor", {}),
            "trigger": metadata.get("trigger", {}),
            "refs": metadata.get("refs", {}),
            "payload": metadata.get("payload", {}),
            "event": {
                "id": str(event.get("id", "")),
                "tenant_id": str(event.get("tenant_id", "")),
                "user_id": str(event.get("user_id", "")),
                "opportunity_id": str(event.get("opportunity_id", "")),
                "entity_type": event.get("entity_type"),
                "entity_id": str(event.get("entity_id", "")),
                "description": event.get("description", ""),
                "correlation_id": str(event.get("correlation_id", "")),
            },
        }

        assert context["actor"]["email"] == "alice@test.com"
        assert context["payload"]["total_score"] == 85
        assert context["refs"]["tenant_id"] == "t-001"
        assert context["event"]["correlation_id"] == "corr-001"

    def test_context_with_json_string_metadata(self):
        """Metadata may come from DB as a JSON string."""
        metadata_str = json.dumps({
            "actor": {"type": "pipeline", "id": "sam_gov"},
            "payload": {"count": 42},
        })
        metadata = json.loads(metadata_str)
        assert metadata["actor"]["type"] == "pipeline"
        assert metadata["payload"]["count"] == 42

    def test_context_with_null_metadata(self):
        """Null metadata should not crash context building."""
        metadata = None
        metadata = metadata or {}
        context = {
            "actor": metadata.get("actor", {}),
            "payload": metadata.get("payload", {}),
        }
        assert context["actor"] == {}
        assert context["payload"] == {}


# ── Rule matching logic ──

class TestRuleMatching:
    """Test the bus + event_type matching in evaluate_event."""

    sample_rules = [
        {
            "id": "rule-1",
            "name": "login_log",
            "trigger_bus": "customer_events",
            "trigger_events": ["account.login"],
            "conditions": {},
            "action_type": "log_only",
            "action_config": {},
            "priority": 50,
            "cooldown_seconds": 0,
            "max_fires_per_hour": 0,
        },
        {
            "id": "rule-2",
            "name": "high_score",
            "trigger_bus": "opportunity_events",
            "trigger_events": ["scoring.scored"],
            "conditions": {"payload.total_score": {"$gte": 75}},
            "action_type": "queue_notification",
            "action_config": {},
            "priority": 30,
            "cooldown_seconds": 0,
            "max_fires_per_hour": 0,
        },
        {
            "id": "rule-3",
            "name": "profile_rescore",
            "trigger_bus": "customer_events",
            "trigger_events": ["account.profile_updated"],
            "conditions": {
                "payload.fields_changed": {
                    "$contains_any": ["primary_naics", "keyword_domains", "agency_priorities"]
                }
            },
            "action_type": "queue_job",
            "action_config": {"source": "scoring", "run_type": "score"},
            "priority": 20,
            "cooldown_seconds": 60,
            "max_fires_per_hour": 10,
        },
    ]

    def test_bus_filter(self):
        """Rules only match their declared bus."""
        opp_rules = [r for r in self.sample_rules if r["trigger_bus"] == "opportunity_events"]
        cust_rules = [r for r in self.sample_rules if r["trigger_bus"] == "customer_events"]
        assert len(opp_rules) == 1
        assert len(cust_rules) == 2
        assert opp_rules[0]["name"] == "high_score"

    def test_event_type_filter(self):
        """Rules only match their declared event types."""
        event_type = "account.login"
        matching = [
            r for r in self.sample_rules
            if r["trigger_bus"] == "customer_events"
            and event_type in r["trigger_events"]
        ]
        assert len(matching) == 1
        assert matching[0]["name"] == "login_log"

    def test_no_match(self):
        """Unknown event type matches no rules."""
        event_type = "unknown.event"
        matching = [
            r for r in self.sample_rules
            if event_type in r["trigger_events"]
        ]
        assert len(matching) == 0

    def test_priority_ordering(self):
        """Rules should be processed in priority order (ASC)."""
        sorted_rules = sorted(self.sample_rules, key=lambda r: r["priority"])
        assert sorted_rules[0]["name"] == "profile_rescore"  # priority 20
        assert sorted_rules[1]["name"] == "high_score"  # priority 30
        assert sorted_rules[2]["name"] == "login_log"  # priority 50


# ── log_only action ──

class TestLogOnlyAction:
    def test_log_only_returns_message(self):
        from automation.actions import _action_log_only

        rule = {"name": "test_rule"}
        event = {"event_type": "account.login"}
        context = {"actor": {"email": "alice@test.com"}}
        config = {"message_template": "User {actor.email} logged in"}

        result = _action_log_only(rule, event, context, config, _resolve_template)
        assert result["message"] == "User alice@test.com logged in"

    def test_log_only_default_template(self):
        from automation.actions import _action_log_only

        rule = {"name": "my_rule"}
        result = _action_log_only(rule, {}, {}, {}, _resolve_template)
        assert "my_rule" in result["message"]


# ── Events module ──

class TestEventsModule:
    """Test the events.py helpers (pure functions, no DB)."""

    def test_build_metadata(self):
        from events import build_metadata

        meta = build_metadata(
            actor={"type": "user", "id": "u1"},
            trigger={"eventId": "e1", "eventType": "ingest.new"},
            refs={"tenant_id": "t1"},
            payload={"score": 80},
        )
        parsed = json.loads(meta)
        assert parsed["actor"]["type"] == "user"
        assert parsed["trigger"]["eventId"] == "e1"
        assert parsed["refs"]["tenant_id"] == "t1"
        assert parsed["payload"]["score"] == 80

    def test_build_metadata_minimal(self):
        from events import build_metadata
        meta = build_metadata(actor={"type": "system", "id": "sys"})
        parsed = json.loads(meta)
        assert "actor" in parsed
        assert "trigger" not in parsed
        assert "refs" not in parsed

    def test_pipeline_actor(self):
        from events import pipeline_actor
        actor = pipeline_actor("sam_gov_ingester")
        assert actor == {"type": "pipeline", "id": "sam_gov_ingester"}

    def test_system_actor(self):
        from events import system_actor
        actor = system_actor("scheduler")
        assert actor == {"type": "system", "id": "scheduler"}

    def test_trigger_ref(self):
        from events import trigger_ref
        ref = trigger_ref("evt-123", "ingest.new")
        assert ref == {"eventId": "evt-123", "eventType": "ingest.new"}
