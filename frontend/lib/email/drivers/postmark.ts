/**
 * The Postmark transport.
 *
 * Postmark is the NOTIFICATION system: bounce webhooks, a suppression list of its own, and a send
 * volume that does not walk into Workspace's ~2,000-recipients-a-day cap. It is not a replacement
 * for Gmail — `correspondence` stays on Gmail, because a human's mail sent through Postmark never
 * lands in that human's Sent folder and its reply arrives as a webhook instead of in their inbox.
 *
 * ── EMULATION ────────────────────────────────────────────────────────────────────────────────
 * `POSTMARK_API_BASE` overrides the endpoint, mirroring how `ANTHROPIC_BASE_URL` points the AI
 * flows at the committed test harness (docs/AI_FLOWS_PROOF.md). With it set to the local emulator
 * the whole path runs end to end — driver selection, the Postmark request body, the ledger row, the
 * webhook — with no live key and no mail leaving the building. Unset, it is the real API and nothing
 * about the code path differs.
 *
 * ── THE TOKEN THAT LOOKS LIKE A BAD KEY ──────────────────────────────────────────────────────
 * `POSTMARK_SERVER_TOKEN` must be the **Server API Token**, not the Account token. The Account
 * token manages domains and cannot send; using it returns a 401 that reads exactly like a wrong
 * key, which is why the error below says so rather than passing the provider's message through.
 *
 * ⚠️ THIS FILE AND THE GMAIL DRIVER ARE THE ONLY PLACES A TRANSPORT MAY BE REACHED.
 * `__tests__/email-transport-boundary.test.ts` fails the build otherwise.
 */
import type { DriverResult, EmailDriver, ResolvedMessage } from '../types';
import { formatFrom } from '../sender-identity';

const DEFAULT_BASE = 'https://api.postmarkapp.com';

/** Postmark caps metadata at 10 keys and 80/80 characters; over-length values are rejected. */
function trimMetadata(meta: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta).slice(0, 10)) {
    out[k.slice(0, 20)] = String(v).slice(0, 80);
  }
  return out;
}

export const postmarkDriver: EmailDriver = {
  name: 'postmark',

  async send(message: ResolvedMessage): Promise<DriverResult> {
    const token = process.env.POSTMARK_SERVER_TOKEN;
    if (!token) {
      // A missing key is a configuration error, not a transport failure, and saying which one it
      // is here saves someone reading a bounce log for an answer that is in an env var.
      return { messageId: null, error: 'POSTMARK_SERVER_TOKEN is not set' };
    }

    const base = (process.env.POSTMARK_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');

    try {
      const res = await fetch(`${base}/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Postmark-Server-Token': token,
        },
        body: JSON.stringify({
          From: formatFrom(message.sender),
          To: message.to,
          Subject: message.subject,
          HtmlBody: message.html,
          // Postmark scores text-less mail, and unlike the Gmail driver this one is new — there is
          // no existing behaviour to preserve, so the text part goes in from the start.
          TextBody: message.text,
          ...(message.sender.replyTo ? { ReplyTo: message.sender.replyTo } : {}),
          MessageStream: message.sender.stream,
          ...(message.tags.length ? { Tag: message.tags[0] } : {}),
          Metadata: trimMetadata(message.metadata),
        }),
      });

      const body = await res.json().catch(() => ({} as Record<string, unknown>));

      if (!res.ok) {
        const code = Number(body?.ErrorCode ?? 0);
        const detail = String(body?.Message ?? res.statusText);
        if (res.status === 401) {
          return {
            messageId: null,
            error: `Postmark rejected the token (401). This is usually the ACCOUNT token rather `
              + `than the SERVER token — the account token manages domains and cannot send. ${detail}`,
          };
        }
        // 406 is Postmark's "inactive recipient": the address is on THEIR suppression list. Ours
        // should already have caught it, so reaching here means the two lists have diverged.
        if (code === 406) {
          return {
            messageId: null,
            error: `Postmark has this address suppressed (406) but ours does not — the two lists `
              + `have diverged, which means a bounce webhook was missed. ${detail}`,
          };
        }
        return { messageId: null, error: `Postmark ${res.status} (${code}): ${detail}` };
      }

      // Postmark returns the RFC 5322 Message-ID in `MessageID`. This is the value a future inbound
      // reply's `In-Reply-To` header will carry, which is the whole reason the ledger records it.
      return { messageId: (body?.MessageID as string) ?? null, error: null };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[email/postmark] request failed:', detail);
      return { messageId: null, error: `Postmark request failed: ${detail}` };
    }
  },
};
