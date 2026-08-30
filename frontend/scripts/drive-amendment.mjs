/** Drive the amendment engine end to end: detect → confirm → fan-out → tenant acknowledge.
 *
 * WHY THIS EXISTS. `solicitation_amendments` has been empty for the whole life of this sandbox, so
 * the M3 fan-out engine — arguably the highest-consequence customer-facing spine after the build
 * itself — had never actually run. An agency amends a solicitation, and every firm mid-build against
 * it has to be told, has to see WHAT changed, and has to acknowledge it. All of that was code with
 * no execution behind it.
 *
 * The chain, and who drives each leg:
 *
 *   rfp_admin   POST   /api/admin/rfp-curation/[sol]/amendments            → status 'detected'
 *   rfp_admin   POST   …/amendments/[id]  { action: 'confirm' }            → fan-out
 *   (engine)                                                               → one proposal_amendment_flags
 *                                                                            row per ACTIVE proposal,
 *                                                                            one capture:amendment.flagged
 *                                                                            per affected tenant, plus a
 *                                                                            bridge republish for the
 *                                                                            pre-purchase audience
 *   tenant_admin GET   /api/portal/[slug]/proposals/[p]/amendments         → sees the flag
 *   tenant_admin POST  …/amendments { flagId }                             → acknowledged
 *
 * WHAT IS ASSERTED, and what deliberately is not. Every count comes from the server or the database
 * — the flag rows, the event rows, the acknowledged timestamp. Nothing is inferred from a 200. The
 * one thing this does NOT assert is that the amendment is "correct": detection is advisory by
 * design (an admin logs it, or the amendment_monitor agent proposes it), and the product's contract
 * is that a human confirms before anything fans out. So the driver confirms explicitly, as an admin
 * would, rather than asserting that confirmation happened by itself.
 *
 *   node scripts/drive-amendment.mjs <solicitationId>
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const SOL = process.argv[2];
if (!SOL) {
  console.error('usage: drive-amendment.mjs <solicitationId>');
  process.exit(2);
}

// toCamel, matching lib/db.ts — a raw client returns snake_case and every read here would be
// silently undefined. That bug shipped twice this session before it became a habit.
const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 3,
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function signIn(email, password) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  return page;
}

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ── Who is affected, BEFORE anything happens ────────────────────────────────
const targets = await sql`
  SELECT p.id, p.stage, t.slug
    FROM proposals p JOIN tenants t ON t.id = p.tenant_id
   WHERE p.solicitation_id = ${SOL}::uuid AND p.stage <> 'archived'`;
console.log(`solicitation ${SOL}`);
console.log(`  ${targets.length} active proposal(s) built from it: ${targets.map((r) => `${r.slug}/${r.stage}`).join(', ') || '(none)'}\n`);
if (targets.length === 0) {
  console.log('  nothing to fan out to — pick a solicitation with an active proposal');
  await browser.close(); await sql.end(); process.exit(2);
}

const admin = await signIn('eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
console.log('signed in as rfp_admin');

// ── 1. DETECT ───────────────────────────────────────────────────────────────
// A realistic amendment: the kind of change that actually invalidates work in progress. The
// compliance delta is the payload the tenant banner renders, so it carries real requirement text
// rather than a placeholder.
const logRes = await admin.request.post(`${BASE}/api/admin/rfp-curation/${SOL}/amendments`, {
  data: {
    label: 'Amendment 0001',
    summary: 'Response deadline extended 30 days; Technical Volume page limit reduced from 20 to 15; '
           + 'a Data Management Plan is now required as a separate attachment.',
    severity: 'critical',
    complianceDelta: [
      { change: 'changed', requirement: 'page_limit_technical', detail: 'Technical Volume: 20 pages → 15 pages' },
      { change: 'changed', requirement: 'close_date', detail: 'Responses due 30 days later than originally posted' },
      { change: 'added', requirement: 'Data Management Plan', detail: 'New required attachment, 2 pages maximum' },
    ],
  },
});
const logBody = await logRes.json().catch(() => ({}));
const amendmentId = (logBody.data ?? logBody)?.id ?? (logBody.data ?? logBody)?.amendmentId;
check(logRes.ok() && !!amendmentId, 'detected', `${logRes.status()} ${amendmentId ?? JSON.stringify(logBody).slice(0, 120)}`);
if (!amendmentId) { await browser.close(); await sql.end(); process.exit(1); }

const [detected] = await sql`SELECT status, severity FROM solicitation_amendments WHERE id = ${amendmentId}::uuid`;
check(detected?.status === 'detected', 'status is detected (advisory — no fan-out yet)', detected?.status);
const [preFlags] = await sql`SELECT count(*)::int AS n FROM proposal_amendment_flags WHERE amendment_id = ${amendmentId}::uuid`;
check(preFlags.n === 0, 'no flags before confirmation', `${preFlags.n} flag(s)`);

// ── 2. CONFIRM → FAN OUT ────────────────────────────────────────────────────
const confRes = await admin.request.post(`${BASE}/api/admin/rfp-curation/${SOL}/amendments/${amendmentId}`, {
  data: { action: 'confirm' },
});
const confBody = await confRes.json().catch(() => ({}));
const conf = confBody.data ?? confBody;
check(confRes.ok(), 'confirmed', `${confRes.status()} flagged=${conf.flagged} tenants=${conf.tenants}`);

const flags = await sql`
  SELECT f.id, f.acknowledged_at AS "acknowledgedAt", t.slug
    FROM proposal_amendment_flags f JOIN tenants t ON t.id = f.tenant_id
   WHERE f.amendment_id = ${amendmentId}::uuid`;
check(flags.length === targets.length, 'one flag per active proposal',
  `${flags.length} flag(s) for ${targets.length} proposal(s)`);
check(flags.every((f) => !f.acknowledgedAt), 'flags start unacknowledged');

// The customer-facing event is what drives the notification bell — a fan-out that writes rows but
// emits nothing leaves the tenant with a banner they never hear about.
const [ev] = await sql`
  SELECT count(*)::int AS n FROM system_events
   WHERE namespace = 'capture' AND type = 'amendment.flagged'
     AND payload->>'amendmentId' = ${amendmentId}`;
check(ev.n > 0, 'capture:amendment.flagged emitted per tenant', `${ev.n} event(s)`);

// ── 3. RE-CONFIRM IS A NO-OP ────────────────────────────────────────────────
// The compare-and-swap only accepts 'detected'. Re-confirming must not double-flag.
const again = await admin.request.post(`${BASE}/api/admin/rfp-curation/${SOL}/amendments/${amendmentId}`, {
  data: { action: 'confirm' },
});
const [afterAgain] = await sql`SELECT count(*)::int AS n FROM proposal_amendment_flags WHERE amendment_id = ${amendmentId}::uuid`;
check(afterAgain.n === flags.length, 're-confirm does not double-flag', `${again.status()}, still ${afterAgain.n}`);

// ── 4. THE TENANT SEES IT, AND ACKNOWLEDGES ─────────────────────────────────
const slug = targets[0].slug;
const proposalId = targets[0].id;
const buyerPw = slug === 'foundation' ? (process.env.FOUNDATION_PW || 'DemoPass123!') : (process.env.BUYER_PW || 'Passw0rd!2026');
const buyerEmail = slug === 'foundation' ? 'kate.ulepic@foundation3dp.com' : `admin@${slug}.test`;

const buyer = await signIn(buyerEmail, buyerPw);
console.log(`\nsigned in as ${buyerEmail} (${slug})`);

// The route returns { data: { flags: [...] } } — each row carries flagId + the amendment detail.
// An earlier version of this reader looked for `.amendments`, found undefined, fell back to the
// wrapper object and then failed `Array.isArray`, so it would have reported "tenant cannot see it"
// even once the read was working. A probe that cannot pass when the product is right is worse than
// no probe: it manufactures a defect. Read the shape the route actually returns.
const seeRes = await buyer.request.get(`${BASE}/api/portal/${slug}/proposals/${proposalId}/amendments`);
const seeBody = await seeRes.json().catch(() => ({}));
const seen = (seeBody.data ?? seeBody)?.flags ?? [];
const mine = Array.isArray(seen) ? seen.find((a) => a.amendmentId === amendmentId) : null;
check(seeRes.ok() && !!mine, 'tenant sees the amendment on their proposal',
  `${seeRes.status()} ${mine ? `${mine.label} (${mine.severity})` : JSON.stringify(seeBody).slice(0, 140)}`);
if (mine) {
  // The delta is what the banner renders — a flag with no delta tells the tenant something changed
  // without telling them what, which is the failure this engine exists to prevent.
  const delta = Array.isArray(mine.complianceDelta) ? mine.complianceDelta : [];
  check(delta.length === 3, 'the compliance delta survives the round trip', `${delta.length} item(s)`);
}

const myFlag = flags.find((f) => f.slug === slug);
const ackRes = await buyer.request.post(`${BASE}/api/portal/${slug}/proposals/${proposalId}/amendments`, {
  data: { flagId: myFlag.id },
});
check(ackRes.ok(), 'acknowledged', `${ackRes.status()}`);

const [acked] = await sql`
  SELECT acknowledged_at AS "acknowledgedAt", acknowledged_by AS "acknowledgedBy"
    FROM proposal_amendment_flags WHERE id = ${myFlag.id}::uuid`;
check(!!acked?.acknowledgedAt, 'acknowledged_at recorded (not just a 200)',
  acked?.acknowledgedAt ? new Date(acked.acknowledgedAt).toISOString() : 'null');

// The OTHER tenants' flags must be untouched — an acknowledgement is per proposal, not global.
const others = flags.filter((f) => f.id !== myFlag.id);
if (others.length) {
  const still = await sql`
    SELECT count(*)::int AS n FROM proposal_amendment_flags
     WHERE amendment_id = ${amendmentId}::uuid AND id <> ${myFlag.id}::uuid AND acknowledged_at IS NULL`;
  check(still[0].n === others.length, 'other proposals stay unacknowledged', `${still[0].n}/${others.length}`);
}

console.log(`\n${failures === 0 ? '✓ detect → confirm → fan-out → acknowledge' : `✗ ${failures} check(s) failed`}`);
await browser.close();
await sql.end();
process.exit(failures ? 1 : 0);
