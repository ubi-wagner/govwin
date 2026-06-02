"""INC-8 — no phantom executors / silent no-ops (EVENT_CONTRACT_V3 gap 8;
CLAUDE_CLIFFNOTES Mistake 21).

A live automation rule must never point at a missing handler. Migration 050
seeded a 'CMS Content Unpublish Bridge' rule (action_type=unpublish_content)
with NO handler, so every unpublish event fell through to a silent no-op.

These tests are self-maintaining structural guards:
  - every action the listener dedups (its declared "I handle this" set) must
    have a real dispatch branch in _do_action_inner;
  - unpublish_content specifically is wired (regression lock);
  - the ai/review route no longer claims to invoke the non-existent
    proposal.review_section tool.
"""
import inspect
import pathlib
import re

import pytest

from src import event_listener as el


def _dedup_action_set() -> set[str]:
    """The action types the listener dedups == the set it expects to handle."""
    src = inspect.getsource(el._execute_rule)
    m = re.search(r"in \(([^)]*)\) and pool", src)
    assert m, "could not locate the dedup action tuple in _execute_rule"
    return {a.strip().strip("'\"") for a in m.group(1).split(",") if a.strip()}


def test_every_dedup_action_has_a_dispatch_branch():
    """No phantom executor: anything deduped must actually be dispatched."""
    dispatch_src = inspect.getsource(el._do_action_inner)
    missing = [a for a in _dedup_action_set() if f"'{a}'" not in dispatch_src]
    assert not missing, f"deduped actions with no dispatch branch (phantoms): {missing}"


def test_unpublish_content_is_wired():
    """Regression lock for the migration-050 live-rule-without-handler gap."""
    assert hasattr(el, "_action_unpublish_content"), "unpublish_content handler missing"
    assert "'unpublish_content'" in inspect.getsource(el._do_action_inner)
    assert "unpublish_content" in _dedup_action_set()


def test_publish_and_unpublish_are_symmetric():
    """Both bridge directions must have handlers (migration 050 seeds both rules)."""
    assert hasattr(el, "_action_publish_content")
    assert hasattr(el, "_action_unpublish_content")


def test_ai_review_route_has_no_phantom_tool_invocation():
    """The route must not claim a client-side invoke of a non-existent tool."""
    route = (
        pathlib.Path(__file__).resolve().parents[3]
        / "frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/review/route.ts"
    )
    if not route.exists():
        pytest.skip("frontend route not present in this checkout")
    text = route.read_text()
    assert "invoke('proposal.review_section')" not in text
    assert 'invoke("proposal.review_section")' not in text
