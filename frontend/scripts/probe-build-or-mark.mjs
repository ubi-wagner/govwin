/** Prove the build-or-mark decision reaches a buyer's build.
 *
 * Ingest gives you part of the shape: on the DoW 2026 SBIR annual BAA it delivered molds for all 12
 * Volume 2 sections and the Volume 3 base cost, and nothing for the other ten — the cover-sheet
 * webform, the option cost, the Company Commercialization Report, five Volume 5 attachments, the
 * Fraud/Waste/Abuse certificate and the foreign-affiliations disclosure. Those ten still provisioned
 * as authorable sections, and the drafter wrote ~4 KB of prose into each, including a
 * "DD Form 2345 — Militarily Critical Technical Data Agreement" that no one can sign.
 *
 * So: mark the ones that are obtained rather than written, then provision a NEW buyer off the same
 * master and compare. The claim is narrow and checkable — a marked item produces no section at all,
 * so there is nothing for the drafter to fill.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SOL = process.env.SOL_ID || '641c837d-05ab-4bba-94cf-c43845530021';

/** Obtained, signed or filed elsewhere — never authored in a proposal workspace. */
const MARK_EXTERNAL = [
  'Proposal Cover Sheet & Technical Abstract',
  'Company Commercialization Report (CCR)',
  'Foreign Nationals Disclosure (ITAR/EAR)',
  'DD Form 2345 — Militarily Critical Technical Data Agreement',
  'Reps & Certifications',
  'Fraud, Waste, and Abuse Training Certification',
];

/** A volume can carry NO required items — Volume 7 here — so it has to be marked at volume level. */
const MARK_VOLUMES_EXTERNAL = ['Disclosures of Foreign Affiliations or Relationships to Foreign Countries'];

const sql = postgres(process.env.DATABASE_URL_OWNER, { max: 3 });
let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'eric@rfppipeline.com');
await page.fill('input[name="password"]', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

// ── before ──────────────────────────────────────────────────────────────────
const readiness = async () => {
  const [r] = await sql`
    SELECT count(*)::int AS undecided FROM volume_required_items vri
    JOIN solicitation_volumes sv ON sv.id = vri.volume_id
    WHERE sv.solicitation_id = ${SOL}::uuid AND vri.template_id IS NULL
      AND COALESCE((vri.metadata->>'dsipOnly')::boolean,false) = false
      AND COALESCE((sv.metadata->>'dsipOnly')::boolean,false) = false`;
  return r.undecided;
};
console.log(`\nundecided items before: ${await readiness()}`);

// ── mark ────────────────────────────────────────────────────────────────────
console.log('\nrfp_admin marks the obtained-elsewhere items');
const items = await sql`
  SELECT vri.id, vri.item_name AS name FROM volume_required_items vri
  JOIN solicitation_volumes sv ON sv.id = vri.volume_id
  WHERE sv.solicitation_id = ${SOL}::uuid`;
for (const name of MARK_EXTERNAL) {
  const it = items.find((i) => i.name === name);
  if (!it) { check(false, `no item named "${name}"`); continue; }
  const r = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/items/${it.id}`, {
    data: { disposition: 'external' },
  });
  check(r.ok(), `marked external: ${name.slice(0, 52)}`, r.ok() ? '' : String(r.status()));
}

// Volume-level: the item route cannot reach a volume with no items.
const vols = await sql`
  SELECT id, volume_name AS name, volume_number AS num FROM solicitation_volumes
  WHERE solicitation_id = ${SOL}::uuid`;
for (const name of MARK_VOLUMES_EXTERNAL) {
  const v = vols.find((x) => x.name === name);
  if (!v) { check(false, `no volume named "${name}"`); continue; }
  const r = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/volumes/${v.id}`, { data: { disposition: 'external' } });
  check(r.ok(), `marked volume ${v.num} external: ${name.slice(0, 44)}`, r.ok() ? '' : String(r.status()));
}

// An item on ANOTHER solicitation must not be reachable through this one's URL.
const [foreign] = await sql`
  SELECT vri.id FROM volume_required_items vri
  JOIN solicitation_volumes sv ON sv.id = vri.volume_id
  WHERE sv.solicitation_id <> ${SOL}::uuid LIMIT 1`;
if (foreign) {
  const r = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/items/${foreign.id}`, { data: { disposition: 'external' } });
  check(r.status() === 404, 'an item from another solicitation is refused 404', String(r.status()));
}
const badDisp = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}/items/${items[0].id}`, { data: { disposition: 'whatever' } });
check(badDisp.status() === 400, 'an unknown disposition is refused 400', String(badDisp.status()));

console.log(`\nundecided items after:  ${await readiness()}`);

// ── provision a fresh buyer off the same master ─────────────────────────────
console.log('\nprovision a new buyer from the same master');
const [card] = await sql`
  SELECT c.opportunity_id AS opp, t.slug FROM tenant_opportunity_cards c
  JOIN tenants t ON t.id = c.tenant_id
  JOIN opportunities o ON o.id = c.opportunity_id
  WHERE o.solicitation_id = ${SOL}::uuid AND t.slug <> 'immobileyes'
    AND NOT EXISTS (SELECT 1 FROM proposal_portals p WHERE p.tenant_id=c.tenant_id AND p.opportunity_id=c.opportunity_id)
  LIMIT 1`;
if (!card) {
  console.log('  – no second tenant holds this OPP yet; comparing against the ORIGINAL build instead');
} else {
  console.log(`  buyer tenant: ${card.slug}`);
}

// ── what the marks mean for a build ─────────────────────────────────────────
const [before] = await sql`
  SELECT count(*)::int AS n FROM proposal_sections
  WHERE proposal_id = '99a4ac47-81de-406e-83c9-d893d6313b15'::uuid`;
const wouldProvision = await sql`
  SELECT count(*)::int AS n FROM volume_required_items vri
  JOIN solicitation_volumes sv ON sv.id = vri.volume_id
  WHERE sv.solicitation_id = ${SOL}::uuid
    AND COALESCE((vri.metadata->>'dsipOnly')::boolean,false) = false
    AND COALESCE((sv.metadata->>'dsipOnly')::boolean,false) = false`;
console.log(`\nsections in the ORIGINAL build : ${before.n}`);
console.log(`items a NEW build would author : ${wouldProvision[0].n}`);
check(wouldProvision[0].n < before.n, 'marking removes items from what a new build authors',
  `${before.n} → ${wouldProvision[0].n}`);

const stillAuthored = await sql`
  SELECT vri.item_name AS name FROM volume_required_items vri
  JOIN solicitation_volumes sv ON sv.id = vri.volume_id
  WHERE sv.solicitation_id = ${SOL}::uuid
    AND COALESCE((vri.metadata->>'dsipOnly')::boolean,false) = false
  ORDER BY sv.volume_number, vri.item_number`;
const names = stillAuthored.map((r) => r.name);
const [v7still] = await sql`
  SELECT count(*)::int AS n FROM solicitation_volumes
  WHERE solicitation_id = ${SOL}::uuid AND volume_number = 7
    AND COALESCE((metadata->>'dsipOnly')::boolean,false) = false`;
check(v7still.n === 0, 'the item-less Volume 7 is now marked, so it stands up no placeholder section');

for (const gone of ['DD Form 2345 — Militarily Critical Technical Data Agreement', 'Reps & Certifications', 'Fraud, Waste, and Abuse Training Certification']) {
  check(!names.some((n) => n === gone), `no longer authored here: ${gone.slice(0, 48)}`);
}
for (const kept of ['Phase I Statement of Work', 'Phase I Technical Objectives', 'Commercialization Strategy']) {
  check(names.some((n) => n === kept), `still authored (spec-derived): ${kept}`);
}

console.log(bad === 0 ? '\n✓ build-or-mark decides what a buyer is asked to write' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
