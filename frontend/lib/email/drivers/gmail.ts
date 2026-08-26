/**
 * The Gmail transport, behind the seam.
 *
 * This is `lib/email.ts`'s send path, moved rather than rewritten. The MIME it builds is
 * byte-identical to what the platform sent before the seam existed, including the two things that
 * look like defects and are deliberately left alone for now:
 *
 *   • The multipart/alternative carries only a text/html part. A text alternative is worth adding —
 *     some gateways score text-less mail — but adding it here would change what every recipient
 *     receives, and the conversion of eleven call sites has to be provably a refactor. The seam
 *     RESOLVES `text` so the Postmark driver can send both; this driver keeps today's bytes.
 *   • The Resend fallback stays. It fires only when Gmail is unconfigured or throws, and removing
 *     it would change behaviour on any deployment that has `RESEND_API_KEY` set. It belongs to the
 *     Gmail path, not to the seam, which is why it moved here with it.
 *
 * ⚠️ THIS FILE AND THE POSTMARK DRIVER ARE THE ONLY PLACES A TRANSPORT MAY BE IMPORTED.
 * `__tests__/email-transport-boundary.test.ts` fails the build otherwise. A seam nothing is forced
 * through is a suggestion — and the storage abstraction was bypassed by two routes, one of them
 * customer-facing, before its own boundary test existed.
 */
import { google } from 'googleapis';
import type { DriverResult, EmailDriver, ResolvedMessage } from '../types';
import { formatFrom, isDefaultPlatformSender } from '../sender-identity';

/**
 * The pre-seam Resend fallback defaulted to `noreply@`, while the Gmail path defaulted to
 * `platform@` — two From addresses for the same message, decided by which transport fired. Almost
 * certainly a latent bug; preserved here because the conversion has to be provably a refactor, and
 * because nothing establishes that `platform@` is a verified Resend sender. It disappears with
 * Resend itself at the Postmark cutover.
 */
const LEGACY_RESEND_FROM = 'RFP Pipeline <noreply@rfppipeline.com>';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const FALLBACK_RESEND_KEY = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;

let _cachedAuth: InstanceType<typeof google.auth.OAuth2> | null = null;

function getAuth() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;
  if (_cachedAuth) return _cachedAuth;
  try {
    const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
    _cachedAuth = oauth2;
    return oauth2;
  } catch (err) {
    console.error('[email/gmail] failed to create OAuth2 client:', err);
    return null;
  }
}

/**
 * The boundary string used `Date.now()`. Kept, because it is a MIME separator and not a rendered
 * value — the hydration hazard that rule guards against (B79) is a `Date.now()` read during React
 * render, and this runs on the server inside a request handler.
 */
function buildMimeMessage(message: ResolvedMessage): string {
  const boundary = '----=_Part_' + Date.now().toString(36);
  const lines = [
    `From: ${formatFrom(message.sender)}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    message.sender.replyTo ? `Reply-To: ${message.sender.replyTo}` : '',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    message.html,
    '',
    `--${boundary}--`,
  ].filter(Boolean);
  return lines.join('\r\n');
}

export const gmailDriver: EmailDriver = {
  name: 'gmail',

  async send(message: ResolvedMessage): Promise<DriverResult> {
    let gmailError: string | undefined;

    const auth = getAuth();
    if (auth) {
      try {
        const gmail = google.gmail({ version: 'v1', auth });
        const raw = Buffer.from(buildMimeMessage(message))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        return { messageId: res.data.id ?? null, error: null };
      } catch (err) {
        gmailError = err instanceof Error ? err.message : String(err);
        if (err && typeof err === 'object' && 'response' in err) {
          const gErr = err as { response?: { data?: { error?: { message?: string; status?: string } } } };
          if (gErr.response?.data?.error?.message) {
            gmailError = `${gErr.response.data.error.status ?? 'ERROR'}: ${gErr.response.data.error.message}`;
          }
        }
        console.error('[email/gmail] send failed:', gmailError);
      }
    }

    if (FALLBACK_RESEND_KEY) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${FALLBACK_RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: isDefaultPlatformSender(message.sender)
              ? LEGACY_RESEND_FROM
              : formatFrom(message.sender),
            to: message.to,
            subject: message.subject,
            html: message.html,
            ...(message.sender.replyTo ? { reply_to: message.sender.replyTo } : {}),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error('[email/gmail] resend fallback failed:', err);
          return { messageId: null, error: String(err?.message ?? 'unknown') };
        }
        const data = await res.json();
        return { messageId: data?.id ?? null, error: null };
      } catch (err) {
        console.error('[email/gmail] resend fallback error:', err);
        return { messageId: null, error: String(err) };
      }
    }

    return {
      messageId: null,
      error: gmailError
        ? `Gmail failed: ${gmailError}`
        : 'No email provider configured (need GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN or RESEND_API_KEY)',
    };
  },
};
