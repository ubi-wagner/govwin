"""`send()` — the one seam every outbound message from the CRM goes through.

The CRM half is the half that carries the NUDGES: workflow NOTIFY steps, milestone alerts, task
reminders, the hot-closing-soon start nudge. A seam covering only the frontend would leave exactly
the mail that matters outside the ledger, and the correlation contract would be worthless for it.

Design: docs/EMAIL_INTERFACE_DESIGN.md · as-built: docs/EMAIL_BUILD_LOG.md
Mirrors `frontend/lib/email/index.ts`. Both write the same `email_sends` table in the main DB.

── THE ORDER IS THE CONTRACT ─────────────────────────────────────────────────────────────────
  1. validate the recipient        — before any DB call, so a typo costs nothing
  2. resolve sender / text / ids   — a message is never half-specified past this point
  3. suppression check             — refused sends still get a ledger row, or the operator
                                     question "why did this not go?" is answered by silence
  4. RESERVE the ledger row        — before dispatch. This is the idempotency mechanism.
  5. dispatch
  6. confirm the outcome

Step 4 before step 5 is the load-bearing part: send-then-record re-sends on replay after a crash in
between, and a duplicate nudge to a government customer is worse than a missing one.

── ONE DIFFERENCE FROM THE FRONTEND SEAM, AND WHY ────────────────────────────────────────────
When the ledger cannot be written, the frontend REFUSES to send — without the reservation it cannot
tell a first send from a replay and has no other guard. The CRM does have one: `_check_dedup()` on
`automation_log` has always suppressed a repeated action for the same trigger event. So a ledger
failure here costs the NEW layer, not the ONLY layer, and failing closed would let one wrong
connection string silence every notification on the platform. It degrades, sends, and logs loudly.
"""
from __future__ import annotations

import logging
import os
import re
import uuid
from html import unescape
from typing import Optional

from . import ledger
from .drivers import gmail as gmail_driver
from .types import (
    DriverResult, EmailKind, OutboundMessage, ResolvedMessage, SenderIdentity, SendResult,
)

logger = logging.getLogger('cms.mailer')

__all__ = ['send', 'html_to_text', 'resolve_identity', 'OutboundMessage', 'SendResult',
           'SenderIdentity', 'EmailKind']

#: Deliberately permissive — the same shape the rest of the platform validates with.
_EMAIL_SHAPE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')

#: Transports by name. Postmark joins this map in E6.
_DRIVERS = {'gmail': gmail_driver}


def _driver_for(kind: str):
    """Which transport carries this message.

    `correspondence` is pinned to Gmail and is NOT subject to `EMAIL_DRIVER`. A human's mail sent
    through Postmark never appears in that human's Sent folder and its reply arrives as a webhook
    instead of in their inbox — no amount of Reply-To configuration fixes that, so it is not a
    switchable preference.
    """
    if kind == 'correspondence':
        return gmail_driver
    requested = os.getenv('EMAIL_DRIVER', 'gmail')
    driver = _DRIVERS.get(requested)
    if driver:
        return driver
    logger.error("EMAIL_DRIVER=%r names no registered driver; falling back to gmail. Registered: %s",
                 requested, ', '.join(_DRIVERS))
    return gmail_driver


_TAG_RE = re.compile(r'<[^>]+>')
_LINK_RE = re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)


def html_to_text(html: str) -> str:
    """A readable plain-text alternative, derived from the HTML.

    Not a general converter and not trying to be: these are the platform's own notification
    templates. It keeps the link target, because a text part reading "Click here" with no URL is
    worse than no text part at all.
    """
    s = re.sub(r'<style[\s\S]*?</style>', '', html or '', flags=re.I)
    s = re.sub(r'<script[\s\S]*?</script>', '', s, flags=re.I)

    def _link(m: re.Match) -> str:
        href, label = m.group(1), _TAG_RE.sub('', m.group(2)).strip()
        return f'{label} ({href})' if label and label != href else href

    s = _LINK_RE.sub(_link, s)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</(p|div|h[1-6]|li|tr)>', '\n', s, flags=re.I)
    s = re.sub(r'<li\b[^>]*>', '· ', s, flags=re.I)
    s = _TAG_RE.sub('', s)
    s = unescape(s)
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def identity_from_address(address: str, *, reply_to: Optional[str] = None,
                          from_name: str = '') -> SenderIdentity:
    """Wrap an ALREADY-RESOLVED From address, without re-running the resolver.

    This exists because re-resolving is not a no-op. `resolve_sender()` ranks an explicit identity
    hint and the originating namespace ABOVE its template heuristic, so feeding its own output back
    in as `default` — with the template still attached — lets the heuristic override a decision that
    was made with more context. A message deliberately sent as `automation@` whose template name
    contains "welcome" would come back out as `engagement@`: a silent change of sender, on exactly
    the mail a customer sees.
    """
    return SenderIdentity(
        from_address=address,
        from_name=from_name,
        reply_to=reply_to,
        stream=os.getenv('POSTMARK_MESSAGE_STREAM', 'outbound'),
    )


def resolve_identity(
    *, identity: Optional[str] = None, namespace: Optional[str] = None,
    template: Optional[str] = None, default: Optional[str] = None,
    reply_to: Optional[str] = None, from_name: str = '',
) -> SenderIdentity:
    """Wrap the CRM's existing `resolve_sender()` in the seam's identity object.

    `sender_identity.resolve_sender()` is live, DB-backed, and already resolves three identities
    (automation@ · engagement@ · cms_service@) by namespace and template heuristic. It returns an
    ADDRESS. This adds the Reply-To and the message stream the transport now needs, without
    creating a second answer to the question of which address a message goes out as.

    `from_name` defaults to empty, and the Gmail driver then passes no display name — which is what
    the pre-seam call did.
    """
    from ..sender_identity import resolve_sender

    address = resolve_sender(identity=identity, namespace=namespace, template=template,
                             default=default or os.getenv('GOOGLE_WORKSPACE_EMAIL',
                                                          'platform@rfppipeline.com'))
    return SenderIdentity(
        from_address=address,
        from_name=from_name,
        reply_to=reply_to,
        stream=os.getenv('POSTMARK_MESSAGE_STREAM', 'outbound'),
    )


def _refuse(correlation_id: str, error: str) -> SendResult:
    return SendResult(provider='skipped', accepted=False, error=error, correlation_id=correlation_id)


async def send(message: OutboundMessage) -> SendResult:
    """Never raises. Every failure is a returned SendResult."""
    correlation_id = message.correlation_id or str(uuid.uuid4())

    # ── 1 · the recipient, before any database call ───────────────────────────────────────────
    to = (message.to or '').strip()
    if not to or not _EMAIL_SHAPE.match(to):
        logger.error('refusing to send: %r is not an address', message.to)
        return _refuse(correlation_id, 'INVALID_RECIPIENT')

    # ── 2 · resolve everything optional ───────────────────────────────────────────────────────
    idempotency_key = message.idempotency_key or str(uuid.uuid4())
    tenant_id = message.tenant_id
    metadata = dict(message.metadata or {})
    metadata['correlation_id'] = correlation_id
    if tenant_id:
        metadata['tenant_id'] = str(tenant_id)

    resolved = ResolvedMessage(
        to=to,
        subject=message.subject,
        html=message.html,
        text=message.text if message.text is not None else html_to_text(message.html),
        kind=message.kind,
        sender=message.sender or resolve_identity(template=message.template),
        correlation_id=correlation_id,
        idempotency_key=idempotency_key,
        tenant_id=str(tenant_id) if tenant_id else None,
        template=message.template,
        tags=list(message.tags or []),
        metadata=metadata,
    )

    # ── 3 · suppression ───────────────────────────────────────────────────────────────────────
    reason = await ledger.suppression_for(to)
    if reason:
        send_id = await ledger.record_suppressed(
            correlation_id=correlation_id, idempotency_key=idempotency_key, tenant_id=resolved.tenant_id,
            kind=resolved.kind, to_email=to, subject=resolved.subject, template=resolved.template,
            reason=reason, metadata=metadata,
        )
        logger.info('suppressed send to %s (%s)', to, reason)
        return SendResult(provider='skipped', accepted=False, error=None, suppressed=True,
                          correlation_id=correlation_id, send_id=send_id)

    # ── 4 · reserve, before dispatch ──────────────────────────────────────────────────────────
    driver = _driver_for(resolved.kind)
    outcome, send_id = await ledger.reserve(
        correlation_id=correlation_id, idempotency_key=idempotency_key, tenant_id=resolved.tenant_id,
        provider=driver.NAME, kind=resolved.kind, to_email=to, subject=resolved.subject,
        template=resolved.template, metadata=metadata,
    )
    if outcome == 'duplicate':
        logger.info('idempotency key %s already reserved — nothing sent', idempotency_key)
        return SendResult(provider=driver.NAME, accepted=False, error=None, duplicate=True,
                          correlation_id=correlation_id)
    degraded = outcome == 'degraded'

    # ── 5 · dispatch ──────────────────────────────────────────────────────────────────────────
    try:
        result = await driver.send(resolved)
    except Exception as e:                                   # noqa: BLE001 — drivers must not raise
        logger.error('driver %r raised, which it must not: %s', driver.NAME, e)
        result = DriverResult(message_id=None, error=str(e))

    # ── 6 · confirm ───────────────────────────────────────────────────────────────────────────
    if send_id:
        await ledger.confirm(
            send_id=send_id, status='failed' if result.error else 'sent', provider=driver.NAME,
            provider_message_id=result.message_id, error=result.error,
        )

    return SendResult(
        provider=driver.NAME, message_id=result.message_id, accepted=not result.error,
        error=result.error, correlation_id=correlation_id, send_id=send_id, degraded=degraded,
    )
