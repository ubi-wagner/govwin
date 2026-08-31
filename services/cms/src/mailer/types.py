"""The outbound-mail contract, CRM side.

Mirrors `frontend/lib/email/types.ts` field for field. The CRM sends the nudges and the frontend
sends the account mail, and they write the SAME `email_sends` table in the main database. Two
contracts that drift produce two idempotency schemes, which is the same as none.

Design: docs/EMAIL_INTERFACE_DESIGN.md · as-built: docs/EMAIL_BUILD_LOG.md

NOT NAMED `email`. A package called `src/email/` shadows the standard library's `email` for anything
that reaches it by absolute import — and `workers/gmail_client.py` does exactly that
(`from email.mime.multipart import MIMEMultipart`). The collision would be intermittent and would
depend on sys.path, which is the worst kind.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

EmailKind = Literal['transactional', 'correspondence']
SendStatus = Literal['pending', 'sent', 'failed', 'suppressed']


@dataclass(frozen=True)
class SenderIdentity:
    """Who the message is from — resolved as an object, never assembled at the call site.

    Option C: the envelope is always a platform-authenticated address and the tenant's identity
    lives in the display name and the Reply-To.

        From:     "Kate Ulepic via RFP Pipeline" <notifications@rfppipeline.com>
        Reply-To: kate@foundation3dp.com

    Sending as the tenant's own address directly leaves SPF unaligned and DKIM signed by our domain,
    so any recipient enforcing DMARC — the default at .gov — quarantines it. It tests clean against
    permissive mailboxes and fails silently against exactly the recipients who matter.
    """

    from_address: str
    from_name: str
    reply_to: Optional[str] = None
    stream: str = 'outbound'


@dataclass(frozen=True)
class OutboundMessage:
    to: str
    subject: str
    html: str
    kind: EmailKind = 'transactional'

    #: Generated from `html` when absent — some gateways score text-less multipart mail.
    text: Optional[str] = None

    #: Resolved from the sender-identity module when absent.
    sender: Optional[SenderIdentity] = None

    #: OURS, stable, carried for the life of the message. For a workflow NOTIFY step this is the
    #: trigger event id, which is what makes a delivery webhook resolve back to the step that
    #: caused the send. Minted when absent.
    correlation_id: Optional[str] = None

    #: The originating trigger event id. A replayed event must reserve nothing and send nothing.
    #: Minted when absent — a caller with no natural key gets a unique one, which is the correct
    #: default for a one-off human action.
    idempotency_key: Optional[str] = None

    #: Owning tenant, or None for platform scope (a notification owned by no tenant).
    tenant_id: Optional[str] = None

    #: The CRM template name, when the body came from one.
    template: Optional[str] = None

    tags: list[str] = field(default_factory=list)

    #: Echoed back on delivery webhooks. String values only — Postmark's limit.
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ResolvedMessage:
    """An OutboundMessage after the seam has filled in everything optional.

    Every field is required here, which is the point: a driver receives a fully specified message
    and never has to decide what a missing sender or a missing correlation id means. Defaulting in
    two places is how two drivers end up disagreeing about what was sent.
    """

    to: str
    subject: str
    html: str
    text: str
    kind: EmailKind
    sender: SenderIdentity
    correlation_id: str
    idempotency_key: str
    tenant_id: Optional[str]
    template: Optional[str]
    tags: list[str]
    metadata: dict[str, str]


@dataclass(frozen=True)
class DriverResult:
    message_id: Optional[str]
    error: Optional[str]


@dataclass(frozen=True)
class SendResult:
    provider: str
    message_id: Optional[str] = None
    accepted: bool = False
    error: Optional[str] = None

    #: Refused before dispatch because the address is on the suppression list. DELIBERATELY NOT AN
    #: ERROR — a send refused because the address hard-bounced last week is the system working, and
    #: collapsing it into `error` would make the suppression list look like an outage in every
    #: dashboard that counts failures.
    suppressed: bool = False

    #: A message with this idempotency key was already sent or is in flight. Nothing was sent, and
    #: that is the correct outcome — not a failure to report to anyone.
    duplicate: bool = False

    correlation_id: str = ''

    #: The `email_sends` row id, or None when no row was reserved (refused early, or the ledger was
    #: unavailable and the seam ran degraded).
    send_id: Optional[str] = None

    #: The ledger could not be reached or refused the write, so this send happened WITHOUT its
    #: idempotency reservation. See the note in `mailer/ledger.py`.
    degraded: bool = False

    def as_legacy_dict(self) -> dict:
        """The `{provider, message_id} | {provider, error}` shape the pre-seam wrapper returned.

        Six call sites in `event_listener.py` log this dict and branch on `result.get('error')`.
        Returning the old shape keeps the conversion a refactor; the richer fields are on the
        dataclass for anything that wants them.
        """
        out: dict = {'provider': self.provider}
        if self.message_id:
            out['message_id'] = self.message_id
        if self.error:
            out['error'] = self.error
        if self.suppressed:
            out['suppressed'] = True
        if self.duplicate:
            out['duplicate'] = True
        return out
