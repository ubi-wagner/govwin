"""The Gmail transport, behind the seam.

This is `event_listener.send_email()`'s body, moved rather than rewritten. It calls the same
`workers.gmail_client.send_email` with the same arguments, so the MIME that reaches a recipient is
byte-identical to what the CRM sent before the seam existed — including the two omissions that look
like defects and are deliberately preserved:

  • `body_text` is NOT passed, so the multipart/alternative carries only the HTML part. The seam
    RESOLVES the text alternative so the Postmark driver can send both; changing it here would
    change what every recipient receives, and the conversion of thirteen call sites has to be
    provably a refactor.
  • `from_name` is passed only when a sender identity actually carries one. The pre-seam call
    passed none, so `From:` was the bare delegate address. Supplying a display name for every
    message is a visible change to every notification the platform sends.
"""
from __future__ import annotations

import logging

from ..types import DriverResult, ResolvedMessage

logger = logging.getLogger('cms.mailer.gmail')

NAME = 'gmail'


async def send(message: ResolvedMessage) -> DriverResult:
    """Never raises. A transport failure is a returned error, not an exception."""
    from ...workers.gmail_client import send_email as _gmail_send

    try:
        result = await _gmail_send(
            delegate_email=message.sender.from_address,
            to_email=message.to,
            subject=message.subject,
            body_html=message.html,
            # See the header: both omissions are preservation, not oversight.
            from_name=message.sender.from_name or None,
        )
        return DriverResult(message_id=result.get('message_id'), error=None)
    except Exception as e:                                   # noqa: BLE001 — contract: never raises
        logger.error('gmail send failed for %s: %s', message.to, e)
        return DriverResult(message_id=None, error=str(e))
