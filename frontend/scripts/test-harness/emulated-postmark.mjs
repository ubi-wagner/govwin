#!/usr/bin/env node
/**
 * Emulated Postmark — a `POST /email` endpoint that stands in for the provider so every path this
 * build added runs END TO END in the sandbox with no live key and nothing leaving the building.
 *
 * Same pattern as `emulated-claude.mjs`: zero product-code change. The drivers read
 * `POSTMARK_API_BASE` (frontend `lib/email/drivers/postmark.ts`, CRM `mailer/drivers/postmark.py`)
 * exactly as the AI flows read `ANTHROPIC_BASE_URL`. Point them here and the driver, the request
 * body, the ledger row, the webhook and the suppression write all execute; unset it and the code
 * path is byte-for-byte the one that talks to Postmark.
 *
 *   node emulated-postmark.mjs
 *   PORT=8788  TOKEN=<expected server token>  WEBHOOK=http://127.0.0.1:3000/api/webhooks/postmark
 *   WEBHOOK_SECRET=<POSTMARK_WEBHOOK_SECRET>  LOG=./emulated-postmark.log.jsonl
 *
 * ── STEERING IT BY RECIPIENT ─────────────────────────────────────────────────────────────────
 * A provider's interesting behaviour is its FAILURES, and they are the half a happy-path emulator
 * never exercises. The local-part prefix selects one, deterministically:
 *
 *   bounce@…      accepted, then a hard Bounce webhook  → suppression row + notification.bounced
 *   complaint@…   accepted, then a SpamComplaint webhook → suppression row + notification.complained
 *   inactive@…    refused 406 — Postmark has it suppressed and we do not: the divergence case
 *   ratelimit@…   refused 429
 *   servererror@… refused 500
 *   anything else accepted, then a Delivery webhook      → notification.delivered
 *
 * ── WHY IT VALIDATES THE TOKEN ───────────────────────────────────────────────────────────────
 * Because the specific failure worth rehearsing is using the ACCOUNT token instead of the SERVER
 * token, which returns a 401 that reads like a wrong key. Set `TOKEN` and the emulator 401s on any
 * other value, so the driver's message for that case is exercised rather than assumed.
 *
 * Deterministic, and every request + every webhook it posts is appended to LOG for review.
 */
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 8788);
const EXPECTED_TOKEN = process.env.TOKEN || '';
const WEBHOOK = process.env.WEBHOOK || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const LOG = process.env.LOG || new URL('./emulated-postmark.log.jsonl', import.meta.url).pathname;

let seq = 0;
const nowIso = () => new Date().toISOString();
const log = (rec) => {
  try { appendFileSync(LOG, JSON.stringify({ at: nowIso(), ...rec }) + '\n'); } catch { /* non-fatal */ }
};

/** Postmark's Message-ID shape: a uuid. The ledger records it for future reply threading. */
const messageId = () => `emu-${String(++seq).padStart(4, '0')}-${Math.abs(hash(String(seq))).toString(16)}`;

/** Deterministic, because `Math.random()` in a harness makes a failing run unreproducible. */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

const BEHAVIOURS = {
  bounce: { accept: true, webhook: 'Bounce' },
  complaint: { accept: true, webhook: 'SpamComplaint' },
  inactive: { accept: false, status: 406, code: 406, message: 'You tried to send to a recipient that has been marked as inactive.' },
  ratelimit: { accept: false, status: 429, code: 429, message: 'Rate limit exceeded.' },
  servererror: { accept: false, status: 500, code: 500, message: 'Internal server error.' },
};

function behaviourFor(to) {
  const local = String(to || '').split('@')[0].toLowerCase();
  for (const [prefix, b] of Object.entries(BEHAVIOURS)) {
    if (local === prefix || local.startsWith(`${prefix}+`) || local.startsWith(`${prefix}-`)) return b;
  }
  return { accept: true, webhook: 'Delivery' };
}

/**
 * Post the delivery outcome back, the way Postmark would.
 *
 * `Metadata` is echoed VERBATIM — that echo is the entire mechanism by which a bounce resolves to
 * the correlation id and therefore to the workflow step that caused the send. An emulator that
 * dropped it would let a broken metadata path pass.
 */
async function fireWebhook(type, { to, id, metadata, tag, stream }) {
  if (!WEBHOOK) return;
  const body = {
    RecordType: type,
    MessageID: id,
    Recipient: to,
    Email: to,
    Metadata: metadata || {},
    Tag: tag || '',
    MessageStream: stream || 'outbound',
    ...(type === 'Bounce'
      ? { Type: 'HardBounce', TypeCode: 1, Description: 'The server was unable to deliver your message.', Inactive: true, BouncedAt: nowIso() }
      : {}),
    ...(type === 'SpamComplaint' ? { Type: 'SpamComplaint', TypeCode: 100000, BouncedAt: nowIso() } : {}),
    ...(type === 'Delivery' ? { DeliveredAt: nowIso(), Details: 'smtp;250 2.0.0 OK' } : {}),
  };
  const raw = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  // POSTMARK DOES NOT SIGN WEBHOOKS. There is no HMAC header to verify; the documented mechanism is
  // HTTP Basic auth on the webhook URL (or a secret in the URL itself) over TLS. Emulating a
  // signature nobody sends would exercise a verification path that can never run in production —
  // the most expensive kind of green. So: Basic auth, exactly as the real thing.
  if (WEBHOOK_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`postmark:${WEBHOOK_SECRET}`).toString('base64')}`;
  }
  try {
    const res = await fetch(WEBHOOK, { method: 'POST', headers, body: raw });
    log({ webhook: type, to, id, status: res.status });
  } catch (err) {
    log({ webhook: type, to, id, error: String(err) });
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'GET' && req.url === '/__emulator/health') return send(200, { ok: true, seq });

    if (req.method !== 'POST' || !req.url.startsWith('/email')) {
      return send(404, { ErrorCode: 404, Message: `emulator has no route for ${req.method} ${req.url}` });
    }

    const token = req.headers['x-postmark-server-token'];
    if (EXPECTED_TOKEN && token !== EXPECTED_TOKEN) {
      log({ request: 'email', rejected: 'token', got: token ? 'a different token' : 'none' });
      // Postmark's real 401 body. The driver turns this into the account-vs-server-token hint.
      return send(401, { ErrorCode: 10, Message: "No Account or Server API tokens were supplied in the HTTP headers. Please add a header for either X-Postmark-Server-Token or X-Postmark-Account-Token." });
    }

    let payload;
    try { payload = JSON.parse(body || '{}'); } catch { return send(422, { ErrorCode: 300, Message: 'Invalid JSON' }); }

    // The two fields whose absence is a real defect in the caller rather than in Postmark.
    if (!payload.From || !payload.To) {
      return send(422, { ErrorCode: 300, Message: 'From and To are required.' });
    }

    const behaviour = behaviourFor(payload.To);
    log({ request: 'email', to: payload.To, from: payload.From, subject: payload.Subject,
          stream: payload.MessageStream, tag: payload.Tag, metadata: payload.Metadata,
          hasText: Boolean(payload.TextBody), replyTo: payload.ReplyTo || null,
          behaviour: behaviour.webhook || `refuse ${behaviour.status}` });

    if (!behaviour.accept) {
      return send(behaviour.status, { ErrorCode: behaviour.code, Message: behaviour.message, To: payload.To });
    }

    const id = messageId();
    send(200, { To: payload.To, SubmittedAt: nowIso(), MessageID: id, ErrorCode: 0, Message: 'OK' });

    // After the response, exactly as Postmark does — the send succeeds and the outcome arrives
    // separately. Firing it synchronously would hide any ordering assumption in the consumer.
    setTimeout(() => fireWebhook(behaviour.webhook, {
      to: payload.To, id, metadata: payload.Metadata, tag: payload.Tag, stream: payload.MessageStream,
    }), 50);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[emulated-postmark] listening on http://127.0.0.1:${PORT}  (log: ${LOG})`);
  console.log(`[emulated-postmark] token check: ${EXPECTED_TOKEN ? 'ON' : 'off (set TOKEN to enable)'}`);
  console.log(`[emulated-postmark] webhooks:    ${WEBHOOK || 'off (set WEBHOOK to enable)'}`);
});
