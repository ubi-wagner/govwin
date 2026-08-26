# Email interface design — Postmark behind a driver seam

**Status:** design, not built. Decisions locked with the operator 2026-08-26; nothing here is
implemented yet.

---

## Why this exists

**No email has ever been sent by this codebase.** Templates render, `notification.requested` carries
the right template name, and `_handle_notification_requested` resolves a recipient — but the Gmail
transport has never run in any environment reachable from development. That is not a criticism of
the code; it is the reason this is the cheapest moment in the product's life to change transport.
Nothing depends on the current path yet.

Two things force the change now:

1. **Delivery management is a step change in volume.** Task nudges, milestone alerts and deliverable
   due-dates are continuous transactional mail. A single delegated Google Workspace mailbox is the
   wrong shape for it — per-mailbox sending quotas, OAuth refresh-token expiry as a silent failure
   mode, and one account's reputation carrying everything.
2. **`notification.failed` today only fires on a render miss.** The system can say "we handed it to
   Gmail" and nothing more. For notifications that are operationally load-bearing — a missed nudge is
   a missed deadline — "sent" is not the same fact as "delivered", and the product currently cannot
   tell them apart.

---

## What already exists, and what it is missing

`services/cms/src/event_listener.py` defines a local wrapper that is already *shaped* like a driver:

```python
async def send_email(to: str, subject: str, html: str, sender: str | None = None) -> dict:
    result = await _gmail_send(delegate_email=sender or _SEND_AS, to_email=to, ...)
    return {'provider': 'gmail', 'message_id': result.get('message_id')}
```

It returns `{provider, message_id}` or `{provider, error}`, which is most of a driver contract. Five
things are missing, and each is a section below:

| missing | why it matters |
|---|---|
| a second driver | one hardcoded transport; changing it today means editing every call site |
| `reply_to` | option C sender identity is impossible without it |
| a suppression list | a hard bounce re-sent is a deliverability and CAN-SPAM problem |
| idempotency | a replayed event double-sends |
| delivery webhooks | "sent" is recorded; "delivered" and "bounced" are not knowable |

---

## The seam

One function. Every send in the platform goes through it.

```python
async def send(message: OutboundMessage) -> SendResult
```

```python
@dataclass(frozen=True)
class OutboundMessage:
    to: str
    subject: str
    html: str
    text: str | None          # generated from html when absent — some gateways score text-less mail
    kind: str                 # 'transactional' | 'correspondence' — selects the driver
    sender: SenderIdentity    # resolved, never assembled at the call site (see below)
    correlation_id: str       # OURS, stable, carried for the life of the message (see below)
    idempotency_key: str      # the trigger event id; a replay must not re-send
    tags: list[str]           # e.g. ['nudge', 'delivery'] — provider-side filtering + analytics
    metadata: dict[str, str]  # tenant_id, task_id … echoed back on webhooks

@dataclass(frozen=True)
class SendResult:
    provider: str             # 'gmail' | 'postmark'
    message_id: str | None    # the RFC 5322 Message-ID — RECORDED, see the correlation contract
    accepted: bool
    error: str | None
    suppressed: bool = False  # refused before sending, not a failure
```

**`suppressed` is deliberately not an error.** A send refused because the address hard-bounced last
week is the system working. Collapsing it into `error` would make the suppression list look like an
outage in every dashboard that counts failures.

### Drivers — selected PER MESSAGE, not globally

`OutboundMessage` carries a `kind`, and the driver is resolved from it:

| kind | driver | what it is |
|---|---|---|
| `transactional` | **Postmark** | milestone alerts, task nudges, deliverable reminders, workflow notifications |
| `correspondence` | **Gmail** | a human emailing a human — sent as that person |

**This is not a compromise between two vendors; they solve different problems.** Postmark is the
notification system, Gmail is the mailbox.

*Why correspondence cannot go through Postmark:* Gmail sending puts the message in the sender's
**Sent folder** and threads the reply into their **inbox**. Postmark does neither — a customer email
sent that way vanishes from the sender's own history and its reply arrives as a webhook. No amount
of `Reply-To` configuration fixes that.

*Why notifications cannot go through Gmail:* Workspace caps around 2,000 recipients/day per mailbox
and API sends count against it — delivery-management nudges across the tenant base walk into that.
No bounce webhooks, no suppression list, and a single OAuth refresh-token expiry silently takes down
every notification in the platform. The failure mode is invisible from the sending side.

`EMAIL_DRIVER` remains the **transactional default**, so Postmark → Gmail is still one variable away
if Postmark has an outage.

### The boundary test

`frontend/__tests__/storage-abstraction-boundary.test.ts` exists because **two routes were found
importing `@aws-sdk/client-s3` directly, one of them customer-facing.** The abstraction was correct
and simply bypassed. Email gets the same guard from day one: a test that fails if anything outside
the driver module imports a transport SDK or `gmail_client` directly.

A seam nothing is forced through is a suggestion.

---

## Sender identity — option C

Decided: **platform envelope, tenant identity in the headers.**

```
From:     "Kate Ulepic via RFP Pipeline" <notifications@rfppipeline.com>
Reply-To: kate@foundation3dp.com
```

**Why not send as `kate@foundation3dp.com` directly.** SPF would not align and DKIM would be signed
by our domain, so any recipient enforcing DMARC — the default at `.gov` and increasingly everywhere —
quarantines or rejects it. It tests clean against permissive mailboxes and silently fails against
exactly the recipients who matter most. That failure mode is invisible from the sending side, which
is what makes it dangerous.

```python
@dataclass(frozen=True)
class SenderIdentity:
    from_address: str       # always a platform-authenticated address
    from_name: str          # "Kate Ulepic via RFP Pipeline"
    reply_to: str | None    # the human who should receive the reply
    stream: str             # Postmark message stream
```

**Resolved as an object, never assembled at the call site.** This is what makes per-tenant sending
domains (full white-label, DKIM delegated to `mail.<tenant>.com`) a later configuration change
rather than a rewrite — `from_address` becomes tenant-derived and nothing else moves.
`services/cms/src/sender_identity.py` already has `resolve_sender()`; it grows a `reply_to` and a
`stream`.

### `Reply-To` is resolved per message, and that matters more than it looks

Two incompatible needs, reconciled by making it part of the resolved identity rather than a global:

| the message | `Reply-To` | why |
|---|---|---|
| collaborator invite, review request | the **human** | a reply should reach a person |
| ToDo nudge with a closed loop | a **system address** | the reply has to come back to the platform |

**External managers make this concrete rather than hypothetical.** Partner managers sit on domains
you do not control — `pjackson@ecinnovates.com`, `sgaffney@ybi.org`. The platform must never send
**as** those addresses; it sends as itself and points the reply at them:

```
From:     "Paul Jackson via RFP Pipeline" <notifications@rfppipeline.com>
Reply-To: pjackson@ecinnovates.com
```

Note the asymmetry with your own domain: sending as `eric@rfppipeline.com` through Postmark *is*
DMARC-aligned, because `rfppipeline.com` is verified. The reason Eric's own correspondence still
goes through Gmail is the Sent folder and threading, not alignment.

### The closed-loop position, decided

**Automation that requires a closed loop will not let the customer set `Reply-To`.** A participant in
a closed loop needs a platform identity — an account — not merely an email address.

That is a security property before it is a commercial one: **inbound email cannot authenticate
anybody.** A `From` header is trivially forged, so a reply that mutates state is either carrying a
bearer token or is unauthenticated input. This platform already has a doctrine for untrusted input —
agent output is *advisory → guardrail → land-or-review*, never an auto-write — and inbound mail is
the same shape.

**So: an inbound reply may ASSOCIATE, never COMPLETE.** It can thread onto the ToDo, appear in the
activity feed, and notify the owner. Completing the ToDo requires an authenticated session.

---

## Suppression

A small table, and it must exist in v1.

```sql
CREATE TABLE email_suppressions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  reason       text NOT NULL,   -- hard_bounce | spam_complaint | manual
  source       text NOT NULL,   -- postmark_webhook | operator
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
```

**Platform-scope (`tenant_id IS NULL`) on purpose.** A hard bounce is a property of the *address*,
not of the tenant that happened to send to it. Scoping it per tenant would let tenant B keep mailing
an address that has already bounced for tenant A, and the reputation damage is shared.

`send()` checks it before dispatch and returns `suppressed=True`. Postmark also maintains its own
suppression list; ours exists so the *product* can explain why a notification did not go — the
operator should not have to log into a vendor dashboard to answer that.

---

## The correlation contract — set from day one

**Every outbound message carries a correlation id, and the provider's `Message-ID` is recorded
against it at send time.** This costs almost nothing now and is *impossible to retrofit*: you cannot
add a token to mail that has already been sent.

```sql
CREATE TABLE email_send_ledger (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id       uuid NOT NULL,          -- ours; the originating event
  idempotency_key      text NOT NULL UNIQUE,   -- a replay cannot double-send
  provider             text NOT NULL,
  provider_message_id  text,                   -- RFC 5322 Message-ID, for reply threading
  kind                 text NOT NULL,
  to_email             text NOT NULL,
  template             text,
  sent_at              timestamptz NOT NULL DEFAULT now()
);
```

One table, three jobs:

1. **Idempotency** — `UNIQUE (idempotency_key)`. Postmark has no native idempotency, so this is it.
   The key is the `trigger_event_id` the listener already threads through.
2. **Webhook association** — Postmark echoes `metadata` back, so a delivery or bounce resolves to the
   correlation and therefore to the workflow step that caused the send.
3. **Reply association, later** — an inbound reply carries `In-Reply-To: <original Message-ID>` by
   RFC, automatically, from every mail client. Matching that against `provider_message_id` resolves
   the reply to its originating nudge **with no token in the body and no plus-addressing**. The
   CRM's existing `sweep_inbox` is already the right place to do it.

**Nothing reads (3) yet, and it is still built now.** The alternative is a future feature that can
only work for mail sent after it shipped.

---

## Closing the loop: webhooks → events

Postmark posts delivery outcomes back. Those become events on the existing spine, which is what
turns "we sent it" into "it landed".

| Postmark webhook | new event |
|---|---|
| Delivery | `system:notification.delivered:single` |
| Bounce (hard) | `system:notification.bounced:single` + suppression row |
| SpamComplaint | `system:notification.complained:single` + suppression row |

`system:notification.failed` keeps its existing meaning — the message could not be *built or
handed over*. Delivery outcomes are a different fact and get different types; overloading `failed`
would make "template missing" and "recipient's mailbox is full" indistinguishable in the audit trail.

**Endpoint:** `POST /api/webhooks/postmark`, verified against `POSTMARK_WEBHOOK_SECRET`. It must be
added to `middleware.ts`'s public paths (it carries no session) and to the audit-coverage allowlist
with a reason, or the existing guards will correctly reject it.

**These three types must be registered.** The event namespace registry is closed
(`finder · capture · identity · proposal · library · system · tool`) and `event-contract.test.ts`
fails on anything unregistered. These sit under `system`, so no new namespace is needed — but the
types still need adding to `lib/event-labels.ts`, or they reach a customer's Activity feed as
de-punctuated identifiers, which is B136 all over again.

---

## Environment variables

To be set in Railway on the **CRM service** (`rfp-crm`), which owns sending.

| variable | value | notes |
|---|---|---|
| `EMAIL_DRIVER` | `postmark` | `gmail` keeps the old path; absent defaults to `gmail` |
| `POSTMARK_SERVER_TOKEN` | *(operator-supplied)* | **Server API Token, not the Account token** — the Account token manages domains and cannot send. Using it produces a 401 that reads like a bad key. |
| `POSTMARK_MESSAGE_STREAM` | `outbound` | Postmark's default transactional stream |
| `POSTMARK_WEBHOOK_SECRET` | *(operator-supplied)* | verifies inbound delivery webhooks |
| `EMAIL_FROM_ADDRESS` | `notifications@rfppipeline.com` | must be a verified Postmark sender on the authenticated domain |
| `EMAIL_FROM_NAME` | `RFP Pipeline` | fallback when no tenant identity resolves |

**Domain:** `rfppipeline.com`, authenticated in Postmark with DKIM and a custom Return-Path. DNS
records come from Postmark once the domain is added. **Verify the domain, not individual sender
signatures** — domain verification allows any address at `rfppipeline.com` without registering each
one.

**Two Postmark servers: production and staging.** Each has its own `POSTMARK_SERVER_TOKEN`, activity
log and reputation. A leaked staging token then cannot send as production, and test traffic cannot
pollute the log that answers "did this customer actually get it?".

### The DNS detail that breaks mail which already worked

Google and Postmark will both send as `rfppipeline.com`, so **both must appear in a single SPF
record**:

```
v=spf1 include:_spf.google.com include:spf.mtasv.net ~all
```

A domain may have exactly **one** SPF record. Publishing a second one is a `permerror` that fails
**both** senders — which is the classic way adding an email provider breaks the mail that was already
working. DKIM is unaffected: Google signs with its selector, Postmark with its own, and DMARC passes
on either.

### How few sending addresses

Every sending address accrues reputation separately, and recipient-side filters and corporate
allow-lists key on the address. Three, with distinct reply expectations — not fifteen by topic:

- **`notifications@`** — automated; differentiation comes from the *display name* (option C), not
  from a different address
- **`support@`** — a real monitored mailbox
- **`billing@`** — if invoicing is ever sent

A monitored fallback inbox is worth having **before the first nudge goes out**: when a `Reply-To`
person has left the company, their replies have to land somewhere.

---

## The one thing that stays the same

**The frontend keeps emitting `notification.requested` and never sends directly.** The async seam is
correct and is not being changed. Giving the frontend a second sending path would create exactly the
two-paths-drift this codebase has produced repeatedly — one credential in two files (B109, B111), one
bucket name under two variables, one account with two expected passwords (B146). One sender, one
place.

---

## Not in scope

- **Per-tenant sending domains (option D).** The interface is shaped for it; the DNS onboarding flow
  and per-tenant reputation warming are a separate piece of work.
- **Inbound reply parsing.** The *hooks* ship now — `provider_message_id` is recorded, so a future
  `In-Reply-To` match resolves any reply to its originating nudge. What is deferred is the consumer.
  When it is built, an inbound reply **associates but never completes**: inbound email cannot
  authenticate anyone, so it is untrusted input under the same advisory-not-auto-write doctrine the
  agent fabric already follows.
- **Marketing / broadcast.** Postmark's separate broadcast stream exists precisely so this can be
  added later without contaminating transactional reputation. Nothing here sends it.
- **Open and click tracking.** Available; deliberately deferred. It has privacy implications for
  government recipients that deserve their own decision rather than arriving as a default.

---

## Build order

1. The `send()` seam + `OutboundMessage`/`SendResult` **including `kind`, `correlation_id` and the
   `email_send_ledger` ledger**, with the Gmail driver behind it and every existing call site converted.
   **No behaviour change to what is sent** — this step is provably a refactor, and the existing tests
   are the proof. The correlation contract lands here rather than later because mail sent before it
   exists can never be associated with anything.
2. The boundary test, so step 1 cannot be undone by accident.
3. The Postmark driver, `EMAIL_DRIVER` switch, suppression table and send ledger.
4. The webhook endpoint, the three new event types, their labels.
5. Flip `EMAIL_DRIVER=postmark`. Gmail remains one variable away.

Step 1 is the only one that touches existing code; steps 3–5 are additive. That ordering means the
risky part is a refactor with tests, and the new part cannot break what already works.
