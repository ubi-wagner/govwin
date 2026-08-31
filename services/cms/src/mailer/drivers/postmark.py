"""The Postmark transport, CRM side.

Mirrors `frontend/lib/email/drivers/postmark.ts`. Postmark is the NOTIFICATION system — bounce
webhooks, its own suppression list, and a send volume that does not walk into Workspace's
~2,000-recipients-a-day cap. `correspondence` stays on Gmail regardless: a human's mail sent through
Postmark never lands in that human's Sent folder and its reply arrives as a webhook rather than in
their inbox.

`POSTMARK_API_BASE` overrides the endpoint, mirroring how `ANTHROPIC_BASE_URL` points the AI flows
at the committed test harness. With it set to the local emulator the whole path runs end to end with
no live key and nothing leaving the building; unset, it is the real API and no code path differs.

`POSTMARK_SERVER_TOKEN` must be the **Server API Token**, not the Account token — the account token
manages domains and cannot send, and using it returns a 401 that reads exactly like a wrong key.
"""
from __future__ import annotations

import json
import logging
import os

import httpx

from ..types import DriverResult, ResolvedMessage

logger = logging.getLogger('cms.mailer.postmark')

NAME = 'postmark'
DEFAULT_BASE = 'https://api.postmarkapp.com'


def _format_from(sender) -> str:
    """RFC 5322 From header. Quoting is conditional — see the TypeScript twin for why."""
    name = sender.from_name
    if not name:
        return sender.from_address
    if not any(c in name for c in '()<>[]:;@\\,."'):
        return f'{name} <{sender.from_address}>'
    escaped = name.replace('\\', '\\\\').replace('"', '\\"')
    return f'"{escaped}" <{sender.from_address}>'


def _trim_metadata(meta: dict) -> dict:
    """Postmark caps metadata at 10 keys and 80/80 characters; over-length values are rejected."""
    return {str(k)[:20]: str(v)[:80] for k, v in list((meta or {}).items())[:10]}


async def send(message: ResolvedMessage) -> DriverResult:
    """Never raises. A transport failure is a returned error, not an exception."""
    token = os.getenv('POSTMARK_SERVER_TOKEN')
    if not token:
        # A missing key is a configuration error, not a transport failure, and saying which one it
        # is saves someone reading a bounce log for an answer that is in an env var.
        return DriverResult(message_id=None, error='POSTMARK_SERVER_TOKEN is not set')

    base = os.getenv('POSTMARK_API_BASE', DEFAULT_BASE).rstrip('/')
    payload = {
        'From': _format_from(message.sender),
        'To': message.to,
        'Subject': message.subject,
        'HtmlBody': message.html,
        # Unlike the Gmail driver there is no existing behaviour to preserve here, so the text part
        # goes in from the start — Postmark scores text-less mail.
        'TextBody': message.text,
        'MessageStream': message.sender.stream,
        'Metadata': _trim_metadata(message.metadata),
    }
    if message.sender.reply_to:
        payload['ReplyTo'] = message.sender.reply_to
    if message.tags:
        payload['Tag'] = message.tags[0]

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(
                f'{base}/email',
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Postmark-Server-Token': token,
                },
                content=json.dumps(payload),
            )
        try:
            body = res.json()
        except Exception:                                # noqa: BLE001
            body = {}

        if res.status_code >= 400:
            code = int(body.get('ErrorCode') or 0)
            detail = str(body.get('Message') or res.reason_phrase)
            if res.status_code == 401:
                return DriverResult(None, (
                    'Postmark rejected the token (401). This is usually the ACCOUNT token rather '
                    f'than the SERVER token — the account token manages domains and cannot send. {detail}'
                ))
            if code == 406:
                # Postmark's "inactive recipient": the address is on THEIR suppression list. Ours
                # should have caught it first, so reaching here means the two lists have diverged.
                return DriverResult(None, (
                    'Postmark has this address suppressed (406) but ours does not — the two lists '
                    f'have diverged, which means a bounce webhook was missed. {detail}'
                ))
            return DriverResult(None, f'Postmark {res.status_code} ({code}): {detail}')

        # Postmark returns the RFC 5322 Message-ID in `MessageID` — the value a future inbound
        # reply's `In-Reply-To` header will carry, which is why the ledger records it.
        return DriverResult(message_id=body.get('MessageID'), error=None)
    except Exception as e:                               # noqa: BLE001 — contract: never raises
        logger.error('postmark request failed for %s: %s', message.to, e)
        return DriverResult(None, f'Postmark request failed: {e}')
