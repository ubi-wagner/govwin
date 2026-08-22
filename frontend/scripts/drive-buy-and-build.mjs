/** Carry one solicitation all the way to a tenant's proposal — the WHOLE commercial spine.
 *
 *   node scripts/drive-buy-and-build.mjs <solId> <tenantSlug> <buyerEmail> [buyerPw]
 *
 * The two builds already in this sandbox (immobileyes and foundation) were both provisioned by
 * driving the internals. This drives what a CUSTOMER does, through the routes they actually hit:
 *
 *   1. rfp_admin PUBLISHES the opportunity — the forward-only bridge fans a mirror card to every
 *      tenant (master + mirror; docs/MASTER_MIRROR_OPP_DESIGN.md)
 *   2. rfp_admin ISSUES a one-time comp code (bearer, 1 use, 30-day expiry)
 *   3. the BUYER redeems it against their card → a real $0 `purchases` row, a portal in
 *      `curation_pending`, and a 72h SLA clock
 *   4. rfp_admin opens the PROVISIONING COCKPIT, decides every undecided required item
 *      (build a mold, or mark it completed elsewhere), and hits Complete & Release — which marks
 *      the MASTER built out, broadcasts to every tenant's mirror, then provisions THIS buyer's
 *      private portal and starts their workflow
 *   5. the buyer's proposal exists, with sections for exactly what they were asked to author
 *
 * Every step is an HTTP call as the real actor. Nothing is written by this script except the
 * readings it takes.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const [, , SOL, SLUG, BUYER_EMAIL, BUYER_PW_ARG] = process.argv;
if (!SOL || !SLUG || !BUYER_EMAIL) {
  console.error('usage: drive-buy-and-build.mjs <solId> <tenantSlug> <buyerEmail> [buyerPw]');
  console.error('       VIA_PARTNER=1 buys through a partner-manager DESCENT instead of a direct login');
  process.exit(2);
}
const BUYER_PW = BUYER_PW_ARG || process.env.BUYER_PW || 'Passw0rd!2026';
// A partner manager does not log in AS the company — they sign in to their own console and DESCEND
// into a company they manage, acquiring tenant_admin there for the duration. Same purchase, an
// entirely different way of arriving at it, and the leg the console exists to serve.
const VIA_PARTNER = process.env.VIA_PARTNER === '1';

/** Item names that are obtained, signed or filed elsewhere — never authored in a workspace. */
const MARK_EXTERNAL = new Set([
  'Proposal Cover Sheet & Technical Abstract',
  'Company Commercialization Report (CCR)',
  'Foreign Nationals Disclosure (ITAR/EAR)',
  'DD Form 2345 — Militarily Critical Technical Data Agreement',
  'Reps & Certifications',
  'Fraud, Waste, and Abuse Training Certification',
  'Letters of Support',
  'Technical Data Rights Assertions',
]);

const sql = postgres(process.env.DATABASE_URL_OWNER, { max: 3 });
let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const login = async (email, pw) => {
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', pw);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), p.click('button[type="submit"]')]);
  return p;
};

const [meta] = await sql`
  SELECT o.id AS "oppId", o.title, cs.ingest_phase AS phase, t.id AS "tenantId", t.name AS "tenantName"
  FROM curated_solicitations cs
  -- B46: the push writes cs.opportunity_id and leaves o.solicitation_id NULL, so the
  -- back-link alone finds nothing for a freshly-pushed solicitation. Resolve through EITHER,
  -- the same way lib/opportunity-bridge.ts:88 already does.
  JOIN opportunities o ON o.solicitation_id = cs.id OR cs.opportunity_id = o.id
  CROSS JOIN LATERAL (SELECT id, name FROM tenants WHERE slug = ${SLUG}) t
  WHERE cs.id = ${SOL}::uuid LIMIT 1`;
if (!meta) { console.error(`no opportunity for solicitation ${SOL}, or no tenant ${SLUG}`); process.exit(2); }
console.log(`\n${meta.title}`);
console.log(`  buyer: ${meta.tenantName} (${SLUG})   ingest phase: ${meta.phase}`);

const admin = await login('eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');

// ── 1. publish the opportunity onto every tenant's card list ────────────────
console.log('\n1. rfp_admin publishes the opportunity');
const pub = await admin.request.post(`${BASE}/api/admin/opportunities/${meta.oppId}/publish`, {
  data: { eventType: 'published' },
});
const pubJson = await pub.json();
check(pub.ok(), 'published onto the bridge', pub.ok() ? `${pubJson?.data?.tenantsApplied} tenant(s)` : `${pub.status()} ${pubJson?.code ?? ''}`);
const [card] = await sql`
  SELECT id, lifecycle_status AS "lifecycleStatus" FROM tenant_opportunity_cards
  WHERE tenant_id = ${meta.tenantId}::uuid AND opportunity_id = ${meta.oppId}::uuid`;
check(!!card, `the buyer's mirror card exists`, card?.lifecycleStatus ?? 'missing');

// ── 2. issue a one-time comp code ───────────────────────────────────────────
console.log('\n2. rfp_admin issues a one-time comp code');
const issue = await admin.request.post(`${BASE}/api/admin/promo-codes`, {
  data: { count: 1, issuedTo: BUYER_EMAIL, note: `drive-buy-and-build ${SLUG}` },
});
const issueJson = await issue.json();
const code = issueJson?.data?.codes?.[0]?.code;
check(issue.ok() && !!code, 'code issued', code ? `${code} (1 use, 30d)` : `${issue.status()} ${issueJson?.error ?? ''}`);
if (!code) { await browser.close(); await sql.end(); process.exit(1); }

// ── 3. the buyer redeems it ─────────────────────────────────────────────────
let buyer;
if (VIA_PARTNER) {
  console.log(`\n3. ${BUYER_EMAIL} descends from the partner console into ${SLUG}, then redeems`);
  buyer = await login(BUYER_EMAIL, BUYER_PW);
  // SETTLE FIRST. Auth lands every role on /portal and the route redirects a partner_admin onward
  // to /partner from the server; `waitForURL(not /login)` resolves at the first hop, so reading the
  // URL there measures how fast this script is, not where the user ends up.
  await buyer.waitForLoadState('networkidle').catch(() => {});
  check(new URL(buyer.url()).pathname.startsWith('/partner'),
    'a partner manager lands on their own console, not a tenant portal', new URL(buyer.url()).pathname);
  const stableRes = await buyer.request.get(`${BASE}/api/partner/tenants`);
  const stable = stableRes.ok() ? await stableRes.json().catch(() => ({})) : {};
  const d = stable?.data ?? {};
  const managed = [d.ownOrg, ...(d.companies ?? d.managed ?? d.tenants ?? [])]
    .filter(Boolean).map((c) => `${c.slug}${c.relation ? `(${c.relation})` : ''}`);
  check(managed.length > 0, 'the console lists a stable', managed.join(', ') || `${stableRes.status()}`);
  check(managed.some((m) => m.startsWith(`${SLUG}(`) || m === SLUG),
    `${SLUG} is in the stable — descent only reaches what the console lists`, managed.join(', '));
  // NAVIGATE, don't POST: /api/partner/enter is a GET that rewrites the session and REDIRECTS, so
  // the console links to it. It is the browser following that redirect that carries the new cookie.
  await buyer.goto(`${BASE}/api/partner/enter?slug=${encodeURIComponent(SLUG)}`, { waitUntil: 'networkidle' });
  check(!new URL(buyer.url()).pathname.startsWith('/partner') && !new URL(buyer.url()).pathname.startsWith('/login'),
    `descended into ${SLUG}`, new URL(buyer.url()).pathname);
  // The descent must actually change who the session IS — a banner alone is not authority. A refusal
  // bounces to /partner, so landing INSIDE the portal is the proof.
  await buyer.goto(`${BASE}/portal/${SLUG}`, { waitUntil: 'networkidle' });
  check(new URL(buyer.url()).pathname.startsWith(`/portal/${SLUG}`),
    'inside the managed company as its admin', new URL(buyer.url()).pathname);
} else {
  console.log(`\n3. ${BUYER_EMAIL} redeems it against the card`);
  buyer = await login(BUYER_EMAIL, BUYER_PW);
}
const buy = await buyer.request.post(`${BASE}/api/portal/${SLUG}/purchase`, {
  data: { opportunityId: meta.oppId, promoCode: code, label: meta.title.slice(0, 60) },
});
const buyJson = await buy.json();
check(buy.ok(), 'purchase accepted', buy.ok() ? `portal ${String(buyJson?.data?.portalId).slice(0, 8)}` : `${buy.status()} ${buyJson?.reason ?? buyJson?.code ?? ''}`);
const portalId = buyJson?.data?.portalId;
if (!portalId) { await browser.close(); await sql.end(); process.exit(1); }

const [afterBuy] = await sql`
  SELECT p.status, p.curation_due_at IS NOT NULL AS "hasSla",
         (SELECT count(*)::int FROM purchases pu WHERE pu.tenant_id = ${meta.tenantId}::uuid
            AND pu.promo_code = ${code}) AS "purchaseRows",
         (SELECT used_count FROM promo_codes WHERE code = ${code}) AS "used"
  FROM proposal_portals p WHERE p.id = ${portalId}::uuid`;
check(afterBuy.status === 'curation_pending', 'portal opens awaiting curation', afterBuy.status);
check(afterBuy.hasSla === true, 'the 72h SLA clock is running');
check(afterBuy.purchaseRows === 1, 'a real purchases row was written (comp, $0)', String(afterBuy.purchaseRows));
check(Number(afterBuy.used) === 1, 'the one-time code is spent', `used=${afterBuy.used}`);
const reuse = await buyer.request.post(`${BASE}/api/portal/${SLUG}/purchase`, {
  data: { opportunityId: meta.oppId, promoCode: code },
});
check(!reuse.ok(), 'the spent code cannot be redeemed again', `${reuse.status()} ${(await reuse.json())?.reason ?? ''}`);

// ── 4. the cockpit: decide every item, then Complete & Release ──────────────
console.log('\n4. rfp_admin works the provisioning cockpit');
const readiness = async () => (await (await admin.request.get(`${BASE}/api/admin/provisioning/${portalId}`)).json().catch(() => ({})))?.data?.readiness;
const items = await sql`
  SELECT vri.id, vri.item_name AS name, vri.template_id AS tpl,
         COALESCE((vri.metadata->>'dsipOnly')::boolean, false) AS marked
  FROM volume_required_items vri JOIN solicitation_volumes sv ON sv.id = vri.volume_id
  WHERE sv.solicitation_id = ${SOL}::uuid ORDER BY sv.volume_number, vri.item_number`;
// MARK BY WHAT THE ITEM IS, not by whether it is undecided. `build_molds` hands a mold to every
// authored item it can, including the DD Form 2345 and the Reps & Certifications — which makes them
// "decided" as far as the readiness bar is concerned while still being things nobody writes. The
// readiness bar asks "has a person looked at this"; the mark asks "is this authored here at all",
// and only the second one keeps a certification out of a buyer's section list.
const undecided = items.filter((i) => !i.tpl && !i.marked);
const toMark = items.filter((i) => MARK_EXTERNAL.has(i.name) && !i.marked);
console.log(`   ${items.length} required item(s); ${undecided.length} with no mold; ${toMark.length} to mark completed-elsewhere`);
for (const it of toMark) {
  const r = await admin.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/items/${it.id}`, { data: { disposition: 'external' } });
  check(r.ok(), `marked completed-elsewhere: ${it.name.slice(0, 46)}`, r.ok() ? '' : String(r.status()));
}
for (const it of items.filter((i) => !MARK_EXTERNAL.has(i.name))) {
  if (!it.tpl) console.log(`     · no mold yet, buyer writes it from scratch: ${it.name.slice(0, 50)}`);
}
// A volume with NO required items provisions a placeholder section, so it is decided at volume level.
const emptyVols = await sql`
  SELECT sv.id, sv.volume_number AS num, sv.volume_name AS name FROM solicitation_volumes sv
  WHERE sv.solicitation_id = ${SOL}::uuid
    AND COALESCE((sv.metadata->>'dsipOnly')::boolean, false) = false
    AND NOT EXISTS (SELECT 1 FROM volume_required_items i WHERE i.volume_id = sv.id)`;
for (const v of emptyVols) {
  const r = await admin.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/volumes/${v.id}`, { data: { disposition: 'external' } });
  check(r.ok(), `marked empty volume ${v.num} completed-elsewhere: ${String(v.name).slice(0, 40)}`);
}

const rel = await admin.request.post(`${BASE}/api/admin/provisioning/${portalId}/release`, { data: { confirm: true } });
const relJson = await rel.json();
check(rel.ok(), 'Complete & Release', rel.ok() ? '' : `${rel.status()} ${relJson?.code ?? ''} ${relJson?.error ?? ''}`);

// ── 5. what the buyer got ───────────────────────────────────────────────────
console.log('\n5. what the buyer now has');
const [built] = await sql`
  SELECT p.status,
         (SELECT cs.build_complete FROM curated_solicitations cs WHERE cs.id = ${SOL}::uuid) AS "masterBuilt",
         (SELECT count(*)::int FROM proposals pr WHERE pr.tenant_id = ${meta.tenantId}::uuid
            AND pr.solicitation_id = ${SOL}::uuid) AS proposals
  FROM proposal_portals p WHERE p.id = ${portalId}::uuid`;
check(built.status === 'launched', 'portal launched', built.status);
check(built.masterBuilt === true, 'the MASTER is marked built out (broadcast to every tenant)');
check(built.proposals >= 1, 'the buyer has a proposal', String(built.proposals));

const [prop] = await sql`
  SELECT pr.id, pr.title FROM proposals pr
  WHERE pr.tenant_id = ${meta.tenantId}::uuid AND pr.solicitation_id = ${SOL}::uuid
  ORDER BY pr.created_at DESC LIMIT 1`;
if (prop) {
  const secs = await sql`
    SELECT s.title, s.meta->>'itemType' AS "itemType", s.sort_index AS ix
    FROM proposal_sections s WHERE s.proposal_id = ${prop.id}::uuid ORDER BY s.sort_index`;
  console.log(`\n   proposal ${prop.id}`);
  console.log(`   "${prop.title}" — ${secs.length} section(s) to author:`);
  for (const s of secs) console.log(`     ${String(s.itemType || '-').padEnd(16)} ${String(s.title).slice(0, 58)}`);
  const forms = secs.filter((s) => ['pdf', 'form_other', 'form_sbir_certs', 'form_sf424', 'spreadsheet'].includes(s.itemType));
  check(forms.filter((s) => MARK_EXTERNAL.has(s.title)).length === 0,
    'nothing the admin marked completed-elsewhere reached the buyer as a section');
  // POLL. The release emits the trigger; the worker creates the instance on its next sweep, so
  // reading immediately after the HTTP call returns tells you nothing about whether the workflow
  // started — only about how fast this script is. Give it a real window before concluding.
  let wf = [];
  for (let t = 0; t < 30_000 && wf.length === 0; t += 2000) {
    wf = await sql`
      SELECT workflow_name AS "workflowName", status FROM process_instances
      WHERE tenant_id = ${meta.tenantId}::uuid
        AND (payload->>'proposalId' = ${prop.id} OR payload->>'proposal_id' = ${prop.id}
             OR payload->>'portalId' = ${portalId} OR payload->>'portal_id' = ${portalId})
      ORDER BY created_at DESC`;
    if (wf.length === 0) await new Promise((r) => setTimeout(r, 2000));
  }
  check(wf.length >= 1, 'their build workflow started',
    wf.map((w) => `${w.workflowName}:${w.status}`).join(', ') || 'none within 30s');
}

// ── 6. the manager climbs back out ──────────────────────────────────────────
if (VIA_PARTNER) {
  console.log('\n6. the manager exits back to their console');
  await buyer.goto(`${BASE}/api/partner/exit`, { waitUntil: 'networkidle' });
  check(new URL(buyer.url()).pathname.startsWith('/partner'), 'exited to the console', new URL(buyer.url()).pathname);
  // Ascending must RELEASE the pin, not just move the browser: a still-pinned session would keep
  // routing the manager into the company they just left.
  await buyer.goto(`${BASE}/portal`, { waitUntil: 'networkidle' });
  check(new URL(buyer.url()).pathname.startsWith('/partner'),
    'the descent released — /portal routes them to the console again', new URL(buyer.url()).pathname);
}

console.log(bad === 0 ? '\n✓ code → purchase → cockpit → release → a build the buyer can work' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
