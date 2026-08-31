/**
 * Who a message is from — resolved as an object, never assembled at the call site.
 *
 * Option C, decided (docs/EMAIL_INTERFACE_DESIGN.md): the envelope is always a
 * platform-authenticated address; the tenant's identity lives in the display name and the Reply-To.
 *
 *     From:     "Kate Ulepic via RFP Pipeline" <notifications@rfppipeline.com>
 *     Reply-To: kate@foundation3dp.com
 *
 * ── THE DEFAULT IS THE CURRENT BEHAVIOUR, ON PURPOSE ─────────────────────────────────────────
 * With no environment set, this returns exactly what `lib/email.ts` produced before the seam
 * existed: `RFP Pipeline <${GOOGLE_WORKSPACE_EMAIL ?? 'platform@rfppipeline.com'}>`. The conversion
 * of the existing call sites has to be provably a refactor, and a refactor that quietly changes the
 * From address of every password reset is not one. `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` are the
 * cutover switch and are unset until the Postmark domain is verified.
 *
 * ── WHY THE FRONTEND AND THE CRM RESOLVE SEPARATELY, FOR NOW ─────────────────────────────────
 * `services/cms/src/sender_identity.py` already resolves three identities (automation@ ·
 * engagement@ · cms_service@) from a DB table plus env, and it is live. Reproducing that here
 * would create a second source of truth for the same question. The frontend's own mail is all
 * platform account mail — resets, invitations, application decisions — which has always gone out
 * as one address, so this file keeps that one address and grows the Reply-To and stream the
 * transport now needs. Unifying the two resolvers is E4's job, from the CRM's model, not this one.
 */
import type { SenderIdentity } from './types';

/** The platform's authenticated envelope address. */
function platformAddress(): string {
  return process.env.EMAIL_FROM_ADDRESS
    || process.env.GOOGLE_WORKSPACE_EMAIL
    || 'platform@rfppipeline.com';
}

function platformName(): string {
  return process.env.EMAIL_FROM_NAME || 'RFP Pipeline';
}

/** Postmark's message stream. Ignored by the Gmail driver, which has no such concept. */
function stream(): string {
  return process.env.POSTMARK_MESSAGE_STREAM || 'outbound';
}

/**
 * Is this the untouched platform default — i.e. did nobody ask for a particular sender?
 *
 * Exists for one reason, and it is a preservation detail rather than a design one: the pre-seam
 * code defaulted the Gmail path to `platform@` and the Resend fallback to `noreply@`, two different
 * addresses for the same message depending on which transport happened to fire. That is almost
 * certainly a latent bug, but "provably a refactor" means preserving it rather than tidying it, so
 * the Gmail driver asks this before choosing the fallback's From. It goes away with Resend at the
 * Postmark cutover.
 */
export function isDefaultPlatformSender(sender: SenderIdentity): boolean {
  return sender.fromAddress === platformAddress() && sender.fromName === platformName();
}

export interface SenderRequest {
  /**
   * A person this message is being sent on behalf of. Produces "Name via RFP Pipeline" as the
   * display name — the tenant identity, in the only place DMARC allows it to go.
   */
  onBehalfOfName?: string | null;

  /**
   * Where a reply should land.
   *
   * NULL IS A REAL ANSWER, not a missing value. A closed-loop message — one whose reply the
   * automation needs to associate back to the originating nudge — must reply to a platform address
   * we control, because a reply sent to the tenant's own mailbox is invisible to us. Callers that
   * want the closed loop pass nothing and get the platform address.
   */
  replyTo?: string | null;
}

export function resolveSender(req: SenderRequest = {}): SenderIdentity {
  const name = req.onBehalfOfName?.trim();
  return {
    fromAddress: platformAddress(),
    fromName: name ? `${name} via ${platformName()}` : platformName(),
    replyTo: req.replyTo?.trim() || null,
    stream: stream(),
  };
}

/**
 * RFC 5322 `From` header.
 *
 * Quoting is CONDITIONAL, and that is not fussiness. An unquoted display name is a sequence of
 * atoms, which may not contain any of the specials below — so `Ulepic, Kate via RFP Pipeline`
 * unquoted is parsed as two addresses and the header is malformed. Quoting unconditionally would
 * also work, but it would change the bytes of every message the platform currently sends, and the
 * conversion of the existing call sites has to be provably a refactor. Names without specials —
 * which is all of them today — produce the identical header they always have.
 */
const RFC5322_SPECIALS = /[()<>[\]:;@\\,."]/;

export function formatFrom(sender: SenderIdentity): string {
  if (!RFC5322_SPECIALS.test(sender.fromName)) {
    return `${sender.fromName} <${sender.fromAddress}>`;
  }
  const escaped = sender.fromName.replace(/["\\]/g, '\\$&');
  return `"${escaped}" <${sender.fromAddress}>`;
}
