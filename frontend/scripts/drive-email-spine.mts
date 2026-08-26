/**
 * The email spine, driven end to end against the emulator — send → ledger → webhook → suppression.
 *
 * Every other instrument in this build asserts one layer. This one runs the whole path with the
 * REAL product code: the real `send()`, the real Postmark driver, the real ledger writes under RLS,
 * the real webhook route, the real suppression enforcement. Only the provider is emulated, and it
 * is reached the same way production reaches Postmark — over HTTP, with a token header — because
 * `POSTMARK_API_BASE` is the only thing that differs, exactly as `ANTHROPIC_BASE_URL` is for the AI
 * flows (docs/AI_FLOWS_PROOF.md).
 *
 * WHAT IT PROVES THAT A UNIT TEST CANNOT. The unit tests mock the ledger, so they assert that
 * `send()` CALLS it. This asserts the row is actually there afterwards, written through a
 * NOBYPASSRLS-adjacent connection against a table whose write policy denies the application role —
 * a claim only a live database can settle.
 *
 * ⚠️ NOT READ-ONLY. It writes ledger rows, suppression rows and system_events, all fixture-scoped
 * and removed at the end; the footprint is printed every run. Sandbox only.
 *
 *   source scripts/sandbox-env.sh
 *   node frontend/scripts/test-harness/emulated-postmark.mjs &     # PORT=8788
 *   npx tsx frontend/scripts/drive-email-spine.mts
 *
 * Exit 0 the spine holds · 1 a claim failed · 2 could not run.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const PORT = Number(process.env.EMULATOR_PORT || 8788);
const TOKEN = 'emulated-server-token';
const HOOK_SECRET = 'emulated-webhook-secret';

// The environment the product code reads. Set BEFORE importing the seam, because the drivers read
// some of it at module scope.
process.env.EMAIL_DRIVER = 'postmark';
process.env.POSTMARK_SERVER_TOKEN = TOKEN;
process.env.POSTMARK_WEBHOOK_SECRET = HOOK_SECRET;
process.env.POSTMARK_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'notifications@rfppipeline.com';

const OWNER = process.env.DATABASE_URL_OWNER;
if (!OWNER) {
  console.error('DATABASE_URL_OWNER required — source scripts/sandbox-env.sh');
  process.exit(2);
}
const owner = postgres(OWNER, { max: 2, onnotice: () => {} });

let bad = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const no = (m: string) => { console.error(`  WRONG ${m}`); bad++; };

const RUN = randomUUID().slice(0, 8);
const addr = (local: string) => `${local}+${RUN}@example.test`;
const written = { sends: 0, suppressions: 0, events: 0 };

let emulator: ChildProcess | null = null;

async function startEmulator(): Promise<void> {
  emulator = spawn(process.execPath, [new URL('./test-harness/emulated-postmark.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(PORT), TOKEN, WEBHOOK: '', WEBHOOK_SECRET: HOOK_SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  emulator.stderr?.on('data', (d) => process.stderr.write(`[emulator] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/__emulator/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`emulator did not come up on ${PORT}`);
}

/**
 * The webhook is invoked in-process rather than over HTTP.
 *
 * Serving the Next app would prove routing, which `verify-surfaces` already covers, and would put a
 * build between this drive and the code it is measuring. Calling the route handler with a real
 * `Request` exercises everything the route does — the secret check, the ledger lookup, the
 * suppression write, the event — against the live database, which is the part in question here.
 */
async function deliverWebhook(body: Record<string, unknown>) {
  const { POST } = await import('../app/api/webhooks/postmark/route.ts');
  const req = new Request(`https://drive.test/api/webhooks/postmark?token=${HOOK_SECRET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req);
}

async function main() {
  await startEmulator();
  ok(`emulator up on 127.0.0.1:${PORT}`);

  const { send } = await import('../lib/email/index.ts');

  // Two tenants, chosen by created_at — a resolver must select for what its consumer needs, not
  // for whatever a fixture happened to name first (B147).
  const tenants = await owner`SELECT id, slug FROM tenants ORDER BY created_at LIMIT 2`;
  if (tenants.length < 2) {
    console.error(`  CANT-RUN needs two tenants; this box has ${tenants.length}.`);
    process.exit(1);
  }
  const [A, B] = tenants;

  // ── 1 · a send lands, and the ledger says so ───────────────────────────────────────────────
  const key1 = `drive:${RUN}:one`;
  const r1 = await send({
    to: addr('kate'), subject: 'Drive one', html: '<p>Hello <a href="https://x.test">link</a></p>',
    kind: 'transactional', tenantId: A.id, template: 'drive_probe', idempotencyKey: key1,
    tags: ['drive'],
  });
  written.sends++;
  if (!r1.accepted) no(`send refused: ${r1.error}`);
  else if (r1.provider !== 'postmark') no(`provider was '${r1.provider}', expected postmark — EMAIL_DRIVER did not take`);
  else ok(`sent via postmark, provider message id ${r1.messageId}`);

  // Every non-trivial column is ALIASED. This client is a bare `postgres()` with no
  // `transform: { column: { from: toCamel } }` — unlike `lib/db.ts` — so `sent_at` comes back as
  // `sent_at`, and `row.sentAt` reads `undefined`. It did, and this drive reported "sent_at is null
  // on a sent row" against a database where it was correctly set. The finding was the harness.
  const [row1] = await owner`
    SELECT status, provider, provider_message_id AS pmid, tenant_id AS tid, correlation_id AS cid,
           template, sent_at AS "sentAt"
      FROM email_send_ledger WHERE idempotency_key = ${key1}`;
  if (!row1) no('no ledger row was written — the reservation never happened');
  else {
    if (row1.status !== 'sent') no(`ledger status is '${row1.status}', expected 'sent'`);
    else if (row1.pmid !== r1.messageId) no(`ledger provider_message_id '${row1.pmid}' ≠ returned '${r1.messageId}'`);
    else if (row1.tid !== A.id) no(`ledger tenant is '${row1.tid}', expected '${A.id}'`);
    else if (!row1.sentAt) no('ledger sent_at is null on a sent row');
    else ok(`ledger row: sent · tenant ${A.slug} · message id recorded · sent_at set`);
  }

  // ── 2 · a replay sends NOTHING ─────────────────────────────────────────────────────────────
  const before = await fetch(`http://127.0.0.1:${PORT}/__emulator/health`).then((r) => r.json());
  const r2 = await send({
    to: addr('kate'), subject: 'Drive one (replay)', html: '<p>Hello</p>',
    kind: 'transactional', tenantId: A.id, template: 'drive_probe', idempotencyKey: key1,
  });
  const after = await fetch(`http://127.0.0.1:${PORT}/__emulator/health`).then((r) => r.json());
  if (!r2.duplicate) no(`a replayed idempotency key was not refused (accepted=${r2.accepted})`);
  else if (after.seq !== before.seq) no(`the provider was called ${after.seq - before.seq} time(s) on a replay`);
  else ok('a replayed idempotency key reached the provider zero times');

  // ── 3 · a bounce webhook suppresses, and the next send is refused ──────────────────────────
  const bouncer = addr('bounce');
  const key3 = `drive:${RUN}:bounce`;
  const r3 = await send({
    to: bouncer, subject: 'Drive bounce', html: '<p>Hi</p>', kind: 'transactional',
    tenantId: B.id, template: 'drive_probe', idempotencyKey: key3,
  });
  written.sends++;
  if (!r3.accepted) no(`the bounce probe was not accepted by the provider: ${r3.error}`);

  const hookRes = await deliverWebhook({
    RecordType: 'Bounce', Type: 'HardBounce', TypeCode: 1,
    MessageID: r3.messageId, Recipient: bouncer, Description: 'no such user',
    Metadata: { correlation_id: r3.correlationId, tenant_id: B.id },
  });
  written.suppressions++; written.events++;
  if (hookRes.status !== 200) no(`the bounce webhook answered ${hookRes.status}`);
  else {
    const [sup] = await owner`SELECT reason, source FROM email_suppressions WHERE email = ${bouncer.toLowerCase()}`;
    if (!sup) no('a hard bounce did not write a suppression row');
    else if (sup.reason !== 'hard_bounce') no(`suppression reason is '${sup.reason}'`);
    else ok(`hard bounce → suppression row (${sup.reason} · ${sup.source})`);

    const [evt] = await owner`
      SELECT type, tenant_id AS tid, payload FROM system_events
       WHERE type = 'notification.bounced' AND payload->>'recipientEmail' = ${bouncer}
       ORDER BY created_at DESC LIMIT 1`;
    if (!evt) no('a hard bounce emitted no notification.bounced event');
    else if (evt.tid !== B.id) no(`the bounce event is filed under '${evt.tid}', expected the send's tenant '${B.id}'`);
    else if (evt.payload?.resolved !== true) no('the bounce did not resolve to its ledger row — the correlation is not closing');
    else ok(`hard bounce → notification.bounced, resolved to the send, tenant ${B.slug}`);
  }

  // The point of the whole suppression apparatus: the NEXT send is refused before dispatch.
  const seqBefore = (await fetch(`http://127.0.0.1:${PORT}/__emulator/health`).then((r) => r.json())).seq;
  const r4 = await send({
    to: bouncer, subject: 'Drive after bounce', html: '<p>Hi again</p>', kind: 'transactional',
    tenantId: B.id, template: 'drive_probe', idempotencyKey: `drive:${RUN}:after-bounce`,
  });
  written.sends++;
  const seqAfter = (await fetch(`http://127.0.0.1:${PORT}/__emulator/health`).then((r) => r.json())).seq;
  if (!r4.suppressed) no(`a send to a suppressed address was not refused (accepted=${r4.accepted})`);
  else if (r4.error !== null) no(`suppression reported an error (${r4.error}) — it is the system working, not a failure`);
  else if (seqAfter !== seqBefore) no('a suppressed send still reached the provider');
  else if (!r4.sendId) no('a suppressed send left no ledger row — "why did this not go?" is unanswerable');
  else ok('a suppressed address: refused before dispatch, no provider call, ledger row still written');

  // ── 4 · a delivery webhook closes the loop on the happy path ───────────────────────────────
  const delivery = await deliverWebhook({
    RecordType: 'Delivery', MessageID: r1.messageId, Recipient: addr('kate'),
    Metadata: { correlation_id: r1.correlationId, tenant_id: A.id }, Details: 'smtp;250 OK',
  });
  written.events++;
  if (delivery.status !== 200) no(`the delivery webhook answered ${delivery.status}`);
  else {
    const [evt] = await owner`
      SELECT tenant_id AS tid, payload FROM system_events
       WHERE type = 'notification.delivered' AND payload->>'providerMessageId' = ${r1.messageId}
       ORDER BY created_at DESC LIMIT 1`;
    if (!evt) no('a delivery emitted no notification.delivered event');
    else if (evt.payload?.resolved !== true) no('the delivery did not resolve to its ledger row');
    else if (evt.tid !== A.id) no(`the delivery event is filed under '${evt.tid}', expected '${A.id}'`);
    else ok(`delivery → notification.delivered, resolved, tenant ${A.slug}`);
  }

  // ── 5 · the provider's own refusals surface as errors, not as silent success ───────────────
  const r5 = await send({
    to: addr('inactive'), subject: 'Drive inactive', html: '<p>x</p>', kind: 'transactional',
    tenantId: A.id, template: 'drive_probe', idempotencyKey: `drive:${RUN}:inactive`,
  });
  written.sends++;
  if (r5.accepted) no('a 406 from the provider was reported as accepted');
  else if (!/diverged/.test(r5.error ?? '')) no(`a 406 did not produce the divergence message: ${r5.error}`);
  else {
    const [row] = await owner`SELECT status, error FROM email_send_ledger WHERE idempotency_key = ${`drive:${RUN}:inactive`}`;
    if (row?.status !== 'failed') no(`a refused send left the ledger row as '${row?.status}', expected 'failed'`);
    else ok('a provider refusal: error surfaced, ledger row closed as failed');
  }

  // ── 6 · correspondence ignores EMAIL_DRIVER ────────────────────────────────────────────────
  // Gmail is unconfigured here, so this cannot succeed — the assertion is on WHICH driver was
  // chosen, which is the property that matters. Postmark would have "worked", and that is the bug.
  const r6 = await send({
    to: addr('human'), subject: 'Drive correspondence', html: '<p>Hi</p>', kind: 'correspondence',
    tenantId: A.id, idempotencyKey: `drive:${RUN}:corr`,
  });
  written.sends++;
  if (r6.provider !== 'gmail') no(`correspondence was routed to '${r6.provider}' — EMAIL_DRIVER must not apply to it`);
  else ok('correspondence stayed on gmail despite EMAIL_DRIVER=postmark');
}

async function cleanup() {
  try {
    await owner`DELETE FROM email_send_ledger WHERE idempotency_key LIKE ${`drive:${RUN}:%`}`;
    await owner`DELETE FROM email_suppressions WHERE email LIKE ${`%+${RUN}@example.test`}`;
    await owner`DELETE FROM system_events WHERE payload->>'recipientEmail' LIKE ${`%+${RUN}@example.test`}`;
  } catch (err) {
    console.error('  cleanup failed:', err);
  }
  console.log();
  console.log(`  MUTATED ${written.sends} ledger row(s), ${written.suppressions} suppression(s), `
    + `${written.events} event(s) — all fixture-scoped to run ${RUN}, now removed.`);
  emulator?.kill();
  await owner.end();
}

main()
  .then(async () => {
    await cleanup();
    console.log();
    if (bad === 0) console.log('✓ Email spine holds end to end: send · ledger · idempotency · webhook · suppression.');
    else console.error(`✗ ${bad} claim(s) failed.`);
    process.exit(bad === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(`could not run: ${String(err?.message ?? err)}`);
    await cleanup().catch(() => {});
    process.exit(2);
  });
