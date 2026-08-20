/** Drive the comp-code path as the two real actors, through the real routes.
 *
 * A comp code IS the payment — redeeming one opens a proposal portal and starts the 72h curation
 * clock without a card — so the only claim worth making is the one measured end to end:
 *
 *   1. rfp_admin issues a one-time code            → /api/admin/promo-codes
 *   2. it shows as OUTSTANDING in the admin list
 *   3. a tenant_admin redeems it in the modal      → /api/portal/<slug>/purchase
 *   4. the SAME code refuses a second redemption, and says so in words a buyer can act on
 *   5. it now reads USED UP, against the company that burned it
 *   6. a revoked code refuses immediately
 *   7. a tenant_user (below tenant_admin) cannot redeem at all
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sql = postgres(process.env.DATABASE_URL_OWNER, { max: 3 });

let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();
const signIn = async (email, pw) => {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
};

// An opportunity Foundation can actually buy: a mirror card with no portal yet.
const [target] = await sql`
  SELECT c.opportunity_id AS id FROM tenant_opportunity_cards c
  JOIN tenants t ON t.id = c.tenant_id AND t.slug = 'foundation'
  WHERE NOT EXISTS (SELECT 1 FROM proposal_portals p
                    WHERE p.tenant_id = c.tenant_id AND p.opportunity_id = c.opportunity_id)
  LIMIT 1`;
if (!target) { console.error('no un-purchased Foundation card to buy'); await sql.end(); process.exit(2); }

// ── 1. issue ────────────────────────────────────────────────────────────────
console.log('\nrfp_admin issues a one-time code');
await signIn('eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
let r = await page.request.post(`${BASE}/api/admin/promo-codes`, {
  data: { count: 2, maxUses: 1, expiresInDays: 30, issuedTo: 'probe — Foundation' },
});
check(r.status() === 201, `POST /api/admin/promo-codes → ${r.status()}`);
const issued = (await r.json()).data.codes;
const [code, spare] = issued.map((c) => c.code);
check(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code), `code is human-typable: ${code}`);
check(issued[0].maxUses === 1 && issued[0].expiresAt, 'single-use with an expiry');

// ── 2. outstanding in the list ──────────────────────────────────────────────
r = await page.request.get(`${BASE}/api/admin/promo-codes`);
const listed = (await r.json()).data.codes.find((c) => c.code === code);
check(listed?.state === 'outstanding', `admin list shows it OUTSTANDING`, listed?.state);

// ── 6. revoke the spare, and prove it is dead ───────────────────────────────
const spareRow = (await r.json?.call(r).catch(() => null)) ?? null; // already consumed; refetch below
r = await page.request.get(`${BASE}/api/admin/promo-codes`);
const spareId = (await r.json()).data.codes.find((c) => c.code === spare)?.id;
r = await page.request.patch(`${BASE}/api/admin/promo-codes`, { data: { id: spareId, action: 'revoke' } });
check(r.ok(), `revoke → ${r.status()}`);
r = await page.request.patch(`${BASE}/api/admin/promo-codes`, { data: { id: spareId, action: 'revoke' } });
check(r.status() === 409, `revoking twice is a 409, not a silent success`, String(r.status()));

// ── 7. a tenant_user cannot redeem ──────────────────────────────────────────
console.log('\nauthority');
await signIn('connor.casey@foundation3dp.com', process.env.FOUNDATION_PW || 'DemoPass123!');
r = await page.request.post(`${BASE}/api/portal/foundation/purchase`, { data: { opportunityId: target.id, promoCode: code } });
check(r.status() === 403, `tenant_user redeeming → ${r.status()} (want 403)`);

// ── 3. the buyer redeems ────────────────────────────────────────────────────
console.log('\ntenant_admin redeems');
await signIn('kate.ulepic@foundation3dp.com', process.env.FOUNDATION_PW || 'DemoPass123!');
r = await page.request.post(`${BASE}/api/portal/foundation/purchase`, { data: { opportunityId: target.id, promoCode: code } });
const body = await r.json().catch(() => ({}));
check(r.ok(), `purchase with the code → ${r.status()}`, JSON.stringify(body).slice(0, 120));
check(Boolean(body.data?.portalId), 'a portal was opened');

// ── 4. the same code refuses a second time, in words ────────────────────────
const [second] = await sql`
  SELECT c.opportunity_id AS id FROM tenant_opportunity_cards c
  JOIN tenants t ON t.id = c.tenant_id AND t.slug = 'foundation'
  WHERE c.opportunity_id <> ${target.id}::uuid
    AND NOT EXISTS (SELECT 1 FROM proposal_portals p
                    WHERE p.tenant_id = c.tenant_id AND p.opportunity_id = c.opportunity_id)
  LIMIT 1`;
if (second) {
  r = await page.request.post(`${BASE}/api/portal/foundation/purchase`, { data: { opportunityId: second.id, promoCode: code } });
  const b2 = await r.json().catch(() => ({}));
  check(r.status() === 400 && b2.code === 'CODE_ALREADY_USED',
    'a spent one-time code is refused as ALREADY USED, not "invalid"', `${r.status()} ${b2.code}`);
  check(/already been used/i.test(b2.error ?? ''), `the message tells the buyer what to do`, b2.error);

  r = await page.request.post(`${BASE}/api/portal/foundation/purchase`, { data: { opportunityId: second.id, promoCode: spare } });
  const b3 = await r.json().catch(() => ({}));
  check(b3.code === 'CODE_ALREADY_USED', 'a REVOKED code is refused too', `${r.status()} ${b3.code}`);
} else {
  console.log('  – no second un-purchased card; skipped the reuse leg');
}

// ── 5. the admin list reflects the burn ─────────────────────────────────────
console.log('\nthe issuer can see what happened');
await signIn('eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
r = await page.request.get(`${BASE}/api/admin/promo-codes`);
const after = (await r.json()).data.codes.find((c) => c.code === code);
check(after?.state === 'exhausted', `now reads USED UP`, after?.state);
check(after?.redeemedByTenant === 'Foundation', `attributed to the company that burned it`, after?.redeemedByTenant ?? 'null');
check(Boolean(after?.firstRedeemedAt), 'and when');

console.log(bad === 0 ? '\n✓ comp-code issue → redeem → refuse-reuse holds end to end' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
