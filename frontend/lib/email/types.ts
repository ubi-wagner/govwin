/**
 * The outbound-mail contract. One shape, every send in the platform.
 *
 * Mirrors the Python dataclasses in `services/cms/src/email/types.py` field for field — the CRM
 * sends the nudges and the frontend sends the account mail, and they write the same ledger table.
 * Two contracts that drift produce two idempotency schemes, which is the same as none.
 *
 * Design: docs/EMAIL_INTERFACE_DESIGN.md · as-built: docs/EMAIL_BUILD_LOG.md
 */

/**
 * Which transport a message belongs on. This is a property of the MESSAGE, not a global setting,
 * because the two kinds solve different problems and neither transport can do the other's job:
 *
 *   transactional  → Postmark. Bounce webhooks, a suppression list, and a send volume that does not
 *                    walk into Workspace's ~2,000/day recipient cap.
 *   correspondence → Gmail. A human emailing a human. Gmail puts it in the sender's Sent folder and
 *                    threads the reply into their inbox; Postmark does neither, so the same message
 *                    sent that way vanishes from the sender's own history.
 */
export type EmailKind = 'transactional' | 'correspondence';

/** Where a send row stands. `suppressed` is not a failure — see SendResult.suppressed. */
export type SendStatus = 'pending' | 'sent' | 'failed' | 'suppressed';

/**
 * Who the message is from, resolved as an object and never assembled at the call site.
 *
 * That indirection is the whole reason per-tenant sending domains stay a configuration change
 * rather than a rewrite: `fromAddress` becomes tenant-derived and nothing else moves.
 *
 * Option C, decided: the envelope is always a platform-authenticated address and the tenant's
 * identity lives in the display name and Reply-To.
 *
 *     From:     "Kate Ulepic via RFP Pipeline" <notifications@rfppipeline.com>
 *     Reply-To: kate@foundation3dp.com
 *
 * Sending as `kate@foundation3dp.com` directly would leave SPF unaligned and DKIM signed by our
 * domain, so any recipient enforcing DMARC — the default at .gov — quarantines it. It tests clean
 * against permissive mailboxes and fails silently against exactly the recipients who matter.
 */
export interface SenderIdentity {
  /** Always a platform-authenticated address. Never a tenant's own mailbox. */
  fromAddress: string;
  /** Display name. This is where the tenant's identity goes. */
  fromName: string;
  /** Who should receive the reply. Null for a closed-loop message nobody should reply to. */
  replyTo: string | null;
  /** Postmark message stream. Ignored by the Gmail driver. */
  stream: string;
}

/** A message handed to the seam. Only `to`, `subject`, `html` and `kind` are required. */
export interface OutboundMessage {
  to: string;
  subject: string;
  html: string;

  /**
   * Plain-text alternative. Generated from `html` when absent — some gateways score text-less
   * multipart mail as suspicious, and an empty text part is worse than a derived one.
   */
  text?: string;

  kind: EmailKind;

  /** Resolved from the tenant when absent. See `resolveSender`. */
  sender?: SenderIdentity;

  /**
   * OURS, stable, carried for the life of the message. Minted when absent.
   *
   * This is what turns "we sent something" into "this send belongs to that workflow step". It is
   * recorded at send time because it CANNOT be retrofitted: you cannot put a token on mail that
   * has already left.
   */
  correlationId?: string;

  /**
   * The originating trigger event id. A replayed event must reserve nothing and send nothing.
   * Minted when absent — a caller with no natural key gets a unique one, which is the same as
   * having no idempotency, and that is the correct default for a one-off human action.
   */
  idempotencyKey?: string;

  /** Owning tenant, or null for platform scope (a notification owned by no tenant). */
  tenantId?: string | null;

  /** The CRM template name, when the body came from one. Recorded for the audit trail. */
  template?: string | null;

  /** Provider-side filtering and analytics, e.g. ['nudge', 'delivery']. */
  tags?: string[];

  /** Echoed back on delivery webhooks. Keep it small and string-valued — Postmark's limit. */
  metadata?: Record<string, string>;
}

export interface SendResult {
  /** 'gmail' | 'postmark' | 'skipped' — an open vocabulary, by design. */
  provider: string;

  /** The RFC 5322 Message-ID. Recorded so a future inbound reply can resolve to this send. */
  messageId: string | null;

  /** The provider took the message. This is the only field that means "it went". */
  accepted: boolean;

  error: string | null;

  /**
   * Refused before dispatch because the address is on the suppression list.
   *
   * DELIBERATELY NOT AN ERROR. A send refused because the address hard-bounced last week is the
   * system working. Collapsing it into `error` would make the suppression list look like an outage
   * in every dashboard that counts failures.
   */
  suppressed: boolean;

  /**
   * A message with this idempotency key was already sent or is in flight. Nothing was sent, and
   * that is the correct outcome — not a failure to report to anyone.
   */
  duplicate: boolean;

  /** Always populated, including on failure — the caller can correlate a send that did not go. */
  correlationId: string;

  /** The `email_sends` row id, or null when the send was refused before a row was reserved. */
  sendId: string | null;
}

/**
 * What a transport must implement. Deliberately tiny: everything else — suppression, idempotency,
 * the ledger, sender resolution — happens once in the seam rather than once per driver.
 */
export interface EmailDriver {
  readonly name: string;
  /** Never throws. A transport failure is a returned error, not an exception. */
  send(message: ResolvedMessage): Promise<DriverResult>;
}

/**
 * An OutboundMessage after the seam has filled in everything optional.
 *
 * Every field is REQUIRED here, which is the point: a driver receives a fully specified message and
 * never has to decide what a missing sender or a missing correlation id means. Defaulting in two
 * places is how two drivers end up disagreeing about what was sent.
 */
export interface ResolvedMessage extends Omit<
  OutboundMessage, 'sender' | 'text' | 'correlationId' | 'idempotencyKey' | 'tenantId' | 'template' | 'tags' | 'metadata'
> {
  sender: SenderIdentity;
  text: string;
  correlationId: string;
  idempotencyKey: string;
  tenantId: string | null;
  template: string | null;
  tags: string[];
  metadata: Record<string, string>;
}

export interface DriverResult {
  messageId: string | null;
  error: string | null;
}
