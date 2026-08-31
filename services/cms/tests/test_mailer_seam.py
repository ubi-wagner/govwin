"""What `mailer.send()` guarantees, independent of any transport.

The four things the seam owns — suppression, idempotency, the ledger, sender resolution — are
asserted against a stub driver, because they must hold identically whichever transport is selected.
A driver-specific test would prove them for Gmail and say nothing about Postmark.

The ORDERING assertions matter as much as the outcomes. "Reserved before dispatch" is the whole
idempotency mechanism, and a test that only checked the return value would pass against an
implementation that sends first and records afterwards — which double-sends on every replay.

Mirrors `frontend/__tests__/email-seam.test.ts`. Where the two seams deliberately differ — a ledger
failure REFUSES on the frontend and DEGRADES here — both behaviours are asserted in their own file,
so a future change that quietly aligns them has to delete a test that says why.
"""
from __future__ import annotations

import asyncio
import sys
import os

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src import mailer                                  # noqa: E402
from src.mailer import identity_from_address, html_to_text   # noqa: E402
from src.mailer.types import DriverResult, OutboundMessage   # noqa: E402


BASE = dict(to='kate@example.test', subject='Hello', html='<p>Hi</p>', kind='transactional')


class _Stub:
    """A driver plus a recording of the order in which the seam touched its collaborators."""

    def __init__(self):
        self.order: list[str] = []
        self.calls: list = []
        self.result = DriverResult(message_id='mid-1', error=None)
        self.raises: Exception | None = None
        self.NAME = 'gmail'

    async def send(self, message):
        self.order.append('dispatch')
        self.calls.append(message)
        if self.raises:
            raise self.raises
        return self.result


@pytest.fixture
def seam(monkeypatch):
    """Wire a stub driver and a stub ledger, and hand back both so tests can steer them."""
    stub = _Stub()
    state = {'suppression': None, 'reserve': ('ok', 'send-1'), 'confirm': [], 'suppressed_rows': []}

    async def suppression_for(email):
        stub.order.append('suppression')
        return state['suppression']

    async def reserve(**kw):
        stub.order.append('reserve')
        state['reserve_kw'] = kw
        return state['reserve']

    async def confirm(**kw):
        stub.order.append('confirm')
        state['confirm'].append(kw)

    async def record_suppressed(**kw):
        stub.order.append('record_suppressed')
        state['suppressed_rows'].append(kw)
        return 'send-s'

    monkeypatch.setattr(mailer.ledger, 'suppression_for', suppression_for)
    monkeypatch.setattr(mailer.ledger, 'reserve', reserve)
    monkeypatch.setattr(mailer.ledger, 'confirm', confirm)
    monkeypatch.setattr(mailer.ledger, 'record_suppressed', record_suppressed)
    monkeypatch.setattr(mailer, '_DRIVERS', {'gmail': stub})
    monkeypatch.setattr(mailer, 'gmail_driver', stub)
    return stub, state


def run(msg):
    return asyncio.run(mailer.send(msg))


# ── the happy path ───────────────────────────────────────────────────────────────────────────

def test_reserves_before_it_dispatches_and_confirms_after(seam):
    stub, state = seam
    r = run(OutboundMessage(**BASE))
    assert stub.order == ['suppression', 'reserve', 'dispatch', 'confirm']
    assert r.accepted is True
    assert r.message_id == 'mid-1'
    assert r.send_id == 'send-1'


def test_mints_a_correlation_id_and_returns_it(seam):
    stub, state = seam
    r = run(OutboundMessage(**BASE))
    assert len(r.correlation_id) == 36
    assert state['reserve_kw']['correlation_id'] == r.correlation_id


def test_carries_correlation_and_tenant_into_provider_metadata(seam):
    stub, _ = seam
    tid = '11111111-1111-4111-8111-111111111111'
    run(OutboundMessage(**BASE, tenant_id=tid, metadata={'task_id': 't1'}))
    md = stub.calls[0].metadata
    assert md['task_id'] == 't1'
    assert md['tenant_id'] == tid
    assert md['correlation_id'] == stub.calls[0].correlation_id


def test_hands_the_driver_a_fully_resolved_message(seam):
    stub, _ = seam
    run(OutboundMessage(**BASE))
    m = stub.calls[0]
    assert m.sender.from_address
    assert m.text                      # derived from the html
    assert m.idempotency_key
    assert m.tenant_id is None
    assert m.tags == []


# ── refusals ─────────────────────────────────────────────────────────────────────────────────

def test_rejects_a_malformed_recipient_without_touching_the_database(seam):
    stub, _ = seam
    r = run(OutboundMessage(**{**BASE, 'to': 'not-an-address'}))
    assert r.accepted is False
    assert r.error == 'INVALID_RECIPIENT'
    assert stub.order == []            # the cheapest check runs first, on purpose


def test_suppression_is_not_an_error_and_still_leaves_a_row(seam):
    stub, state = seam
    state['suppression'] = 'hard_bounce'
    r = run(OutboundMessage(**BASE))
    assert r.suppressed is True
    assert r.error is None             # the system working, not an outage
    assert r.accepted is False
    assert r.send_id == 'send-s'       # the operator can still answer "why did this not go?"
    assert stub.order == ['suppression', 'record_suppressed']
    assert stub.calls == []


def test_a_replayed_idempotency_key_sends_nothing(seam):
    stub, state = seam
    state['reserve'] = ('duplicate', None)
    r = run(OutboundMessage(**BASE, idempotency_key='event-42'))
    assert r.duplicate is True
    assert r.error is None
    assert r.accepted is False
    assert stub.calls == []


# ── the one deliberate difference from the frontend seam ─────────────────────────────────────

def test_an_unwritable_ledger_DEGRADES_here_rather_than_refusing(seam):
    """The frontend refuses; this sends anyway, and says so.

    The CRM has a second replay guard the frontend does not — `_check_dedup()` on `automation_log`
    — so a ledger failure costs the NEW layer, not the ONLY layer. Failing closed would let one
    wrong connection string silence every notification on the platform, which is worse than the
    duplicate it would be preventing.
    """
    stub, state = seam
    state['reserve'] = ('degraded', None)
    r = run(OutboundMessage(**BASE))
    assert r.accepted is True          # the mail went
    assert r.degraded is True          # and the caller is told the reservation did not
    assert stub.order == ['suppression', 'reserve', 'dispatch']
    assert state['confirm'] == []      # nothing to confirm against — no row was reserved


# ── failures close the ledger ────────────────────────────────────────────────────────────────

def test_a_driver_error_is_recorded_as_failed(seam):
    stub, state = seam
    stub.result = DriverResult(message_id=None, error='mailbox full')
    r = run(OutboundMessage(**BASE))
    assert r.accepted is False
    assert r.error == 'mailbox full'
    assert state['confirm'][0]['status'] == 'failed'
    assert state['confirm'][0]['error'] == 'mailbox full'


def test_a_driver_that_raises_still_closes_the_row(seam):
    """Without this the reservation stays 'pending' forever and its key is burned: every retry
    finds the key taken and refuses, so one bad throw silences that message for good."""
    stub, state = seam
    stub.raises = RuntimeError('socket hang up')
    r = run(OutboundMessage(**BASE))
    assert r.accepted is False
    assert len(state['confirm']) == 1
    assert state['confirm'][0]['status'] == 'failed'


def test_never_raises_whatever_the_driver_does(seam):
    stub, _ = seam
    stub.raises = RuntimeError('boom')
    assert run(OutboundMessage(**BASE)) is not None


# ── driver selection ─────────────────────────────────────────────────────────────────────────

def test_correspondence_is_pinned_to_gmail_and_ignores_EMAIL_DRIVER(seam, monkeypatch):
    # Postmark cannot do this job: the message would not appear in the sender's Sent folder and its
    # reply would arrive as a webhook rather than in their inbox.
    stub, _ = seam
    monkeypatch.setenv('EMAIL_DRIVER', 'postmark')
    r = run(OutboundMessage(**{**BASE, 'kind': 'correspondence'}))
    assert r.provider == 'gmail'


def test_an_unknown_driver_falls_back_rather_than_dead_ending(seam, monkeypatch):
    stub, _ = seam
    monkeypatch.setenv('EMAIL_DRIVER', 'carrier-pigeon')
    r = run(OutboundMessage(**BASE))
    assert r.provider == 'gmail'
    assert r.accepted is True


# ── html_to_text ─────────────────────────────────────────────────────────────────────────────

def test_html_to_text_keeps_the_link_target():
    # "Click here" with no URL is worse than no text part at all.
    text = html_to_text('<p>Reset it: <a href="https://x.test/r?t=abc">Reset Password</a></p>')
    assert 'https://x.test/r?t=abc' in text
    assert 'Reset Password' in text
    assert '<a' not in text


def test_html_to_text_drops_style_and_script():
    assert html_to_text('<style>.a{color:red}</style><script>alert(1)</script><p>Hi</p>') == 'Hi'


def test_html_to_text_decodes_entities():
    assert html_to_text('<p>Tom &amp; Jerry &lt;3</p>') == 'Tom & Jerry <3'


# ── sender identity ──────────────────────────────────────────────────────────────────────────

def test_an_already_resolved_address_is_not_re_resolved():
    """`resolve_sender()` ranks an identity hint and the namespace ABOVE its template heuristic.

    Feeding its output back in as `default` with the template still attached would let the heuristic
    override a decision made with more context — a message deliberately sent as automation@ whose
    template name contains "welcome" would come back out as engagement@. That is a silent change of
    sender on exactly the mail a customer sees.
    """
    identity = identity_from_address('automation@rfppipeline.com')
    assert identity.from_address == 'automation@rfppipeline.com'
    assert identity.from_name == ''    # the Gmail driver then passes no display name, as before

    # And the resolver really would have moved it, which is what makes the above load-bearing.
    from src.sender_identity import resolve_sender
    assert resolve_sender(template='welcome_email',
                          default='automation@rfppipeline.com') != 'automation@rfppipeline.com'
