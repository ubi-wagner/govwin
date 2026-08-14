"""OVERLAY-2: request_advisory_overlay threads a market-relevant section_id into the overlay
payload, so market_analyst's pre_augment (get_section_context requires section_id) anchors on a
real section instead of erroring. Best-effort: no sections ⇒ the key is omitted (pre_augment
safe-skips; the fan-out + reconcile still run). Hermetic — fake conn + captured emit, no DB/key."""
import sys
import unittest.mock
import uuid

sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

import events
from workflows.actions.advisory_actions import request_advisory_overlay, _resolve_market_section

PROP = "22222222-2222-2222-2222-222222222222"
TENANT = "33333333-3333-3333-3333-333333333333"
SID = "11111111-1111-1111-1111-111111111111"


class FakeConn:
    """Returns one section row (or none) for the resolver's fetchrow."""
    def __init__(self, section_id):
        self._sid = section_id

    async def fetchrow(self, _q, *_a):
        return {"id": uuid.UUID(self._sid)} if self._sid else None


def _capture(monkeypatch):
    cap = {}

    async def fake_emit(conn, namespace, type, phase, tenant_id=None, payload=None, parent_event_id=None):
        if phase == "end":
            cap["payload"] = payload
        return "evt-id"

    monkeypatch.setattr(events, "emit_event", fake_emit)
    return cap


async def test_overlay_payload_carries_resolved_section_id(monkeypatch):
    cap = _capture(monkeypatch)
    res = await request_advisory_overlay(
        FakeConn(SID), adversarial=True, proposal_id=PROP, tenant_id=TENANT, policy="auto")
    assert res["requested"] is True
    # market_analyst's pre_augment maps payload.section_id — it must be present now.
    assert cap["payload"]["section_id"] == SID
    assert cap["payload"]["policy"] == "auto"
    assert cap["payload"]["proposal_id"] == PROP


async def test_no_sections_omits_section_id_but_still_requests(monkeypatch):
    cap = _capture(monkeypatch)
    res = await request_advisory_overlay(
        FakeConn(None), adversarial=True, proposal_id=PROP, tenant_id=TENANT)
    # Overlay still fires (fan-out + reconcile are independent of pre_augment); the key is omitted
    # so pre_augment safe-skips rather than passing a null section that would error.
    assert res["requested"] is True
    assert "section_id" not in cap["payload"]


async def test_not_adversarial_is_a_safe_noop(monkeypatch):
    cap = _capture(monkeypatch)
    res = await request_advisory_overlay(FakeConn(SID), adversarial=False, proposal_id=PROP)
    assert res["requested"] is False and "payload" not in cap  # never emits, never dead-ends


async def test_resolver_is_best_effort():
    assert await _resolve_market_section(FakeConn(SID), None) is None  # no proposal
    assert await _resolve_market_section(FakeConn(None), PROP) is None  # no sections


def test_pre_augment_step_reads_payload_section_id():
    """The consumer side: the overlay's pre_augment step maps payload.section_id → market_analyst."""
    from workflows.advisory_overlay import AdvisoryOverlay
    from workflows.base import StepType
    pre = next(s for s in AdvisoryOverlay.steps if s.name == "pre_augment")
    assert pre.step_type == StepType.AI_INVOKE
    assert pre.action == "tool.market.analyze_sota"
    assert pre.input_map.get("section_id") == "payload.section_id"
