/**
 * build-tvsf-opp.mjs — build the Ohio TVSF Round-45 OPPORTUNITY CARD from scratch, driving the
 * REAL admin process end-to-end (the way an RFP admin would):
 *   1. seed the opportunity + curated_solicitation (the ingest output from Paul Jackson/EC's
 *      TVSF_Outline_Template — captured as docs/TVSF_SPEC.md + the Round-45 DMVEC preset),
 *   2. POST /api/admin/rfp-curation/[solId]/apply-preset  → compliance + 3 volumes + items,
 *   3. POST /api/admin/opportunities/[oppId]/publish       → publishAndFanOut → bridge + cards.
 * The Budget volume (Vol 2, tvsf_budget) will provision as the OTF state-budget cost FORM.
 *
 *   DATABASE_URL=… node scripts/build-tvsf-opp.mjs
 */
import postgres from '/home/user/govwin/frontend/node_modules/postgres/src/index.js';
import pw from '/home/user/govwin/frontend/node_modules/playwright/index.js';
const { chromium } = pw;

const CONN = process.env.DATABASE_URL || 'postgres://claude@127.0.0.1:5433/govtech_intel';
const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sql = postgres(CONN, { max: 2 });

const OPP_ID = '7f3a1c9e-2b64-4d15-9e83-0a1b2c3d4e5f';
const SOL_ID = '6e2b0d8f-1a53-4c04-8d72-9f0e1d2c3b4a';
const PRESET = '3b279941-5736-47cb-9fa0-aa3f18353a83'; // Ohio TVSF Round 45 (DMVEC)
const now = new Date().toISOString();
const FAILS = [];
const ok = (c, m) => { console.log('[tvsf]', c ? 'PASS' : 'FAIL', m); if (!c) FAILS.push(m); };

const login = async (ctx, e, pwd) => {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(400);
  await p.fill('input[type="email"]', e); await p.fill('input[type="password"]', pwd);
  await Promise.all([p.waitForLoadState('networkidle').catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(800); return p;
};

try {
  // ── 1. Ingest output: the opportunity + its curated solicitation ──
  await sql`
    INSERT INTO opportunities (id, source, source_id, title, agency, program_type, phase_type,
      topic_number, topic_status, lifecycle_status, submission_stage, is_active,
      tech_focus_areas, topic_metadata, dates_estimated, description, created_at, updated_at)
    VALUES (${OPP_ID}, 'manual', 'tvsf-r45-2026',
      'Ohio TVSF Round 45 — Technology Validation & Startup Fund (DMVEC / Entrepreneurs'' Center)',
      'Ohio Third Frontier', 'tvsf', 'other', 'TVSF-R45', 'open', 'open', 'open', true,
      '{}', '{}'::jsonb, false,
      'Ohio Third Frontier TVSF (Technology Validation and Startup Fund), Round 45, administered through DMVEC / the Entrepreneurs Center. 7-page narrative (Q1-14) plus a $200k spend-type Budget plus two required letters.',
      ${now}, ${now})
    ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO curated_solicitations (id, opportunity_id, namespace, status, annotations,
      solicitation_type, solicitation_title, solicitation_number, round_number, round_label,
      intake_meta, created_at, updated_at)
    VALUES (${SOL_ID}, ${OPP_ID}, 'pending', 'approved', '[]'::jsonb,
      'single', 'Ohio TVSF Round 45 — Technology Validation & Startup Fund', 'TVSF-R45', 45, 'Round 45',
      ${sql.json({ source: 'TVSF_Outline_Template_10_31_25 (DMVEC/EC) → docs/TVSF_SPEC.md', preset: 'Ohio TVSF Round 45 (DMVEC)' })},
      ${now}, ${now})
    ON CONFLICT (id) DO NOTHING`;
  // resolve the circular FK so apply-preset's topic↔solicitation check passes
  await sql`UPDATE opportunities SET solicitation_id = ${SOL_ID} WHERE id = ${OPP_ID}`;
  ok(true, 'seeded opportunity + curated_solicitation (Ohio TVSF Round 45)');

  // ── 2 & 3: drive the real admin routes as eric (rfp_admin) ──
  const b = await chromium.launch({ executablePath: EXE });
  const ectx = await b.newContext(); await login(ectx, 'eric@rfppipeline.com', 'RFPAdmin2026!');

  const ap = await ectx.request.post(`${BASE}/api/admin/rfp-curation/${SOL_ID}/apply-preset`, {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ topicIds: [OPP_ID], presetId: PRESET }),
  });
  const apj = await ap.json().catch(() => ({}));
  ok(ap.ok(), `apply-preset (Round-45 compliance + volumes) [${ap.status()}] ${JSON.stringify(apj.data ?? apj.error ?? '')}`);

  const pub = await ectx.request.post(`${BASE}/api/admin/opportunities/${OPP_ID}/publish`, {
    headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ eventType: 'created' }),
  });
  const pubj = await pub.json().catch(() => ({}));
  ok(pub.ok(), `publish → bridge + cards fan-out [${pub.status()}] ${JSON.stringify(pubj.data ?? pubj.error ?? '')}`);

  await b.close();

  // ── verify the card + compliance structure ──
  const [comp] = await sql`SELECT page_limit_technical, custom_variables FROM solicitation_compliance WHERE solicitation_id=${SOL_ID} AND topic_id=${OPP_ID}`;
  ok(comp?.page_limit_technical === 7, `compliance: 7-page narrative limit [${comp?.page_limit_technical}]`);
  const vols = await sql`SELECT volume_number, volume_name, volume_format FROM solicitation_volumes WHERE topic_id=${OPP_ID} ORDER BY volume_number`;
  ok(vols.length === 3, `3 volumes provisioned: ${vols.map(v => `${v.volume_number}.${v.volume_name}[${v.volume_format}]`).join(' · ')}`);
  const budget = vols.find(v => /budget/i.test(v.volume_name));
  // volume_format is CHECK-constrained to {dsip_standard,l_and_m,custom}, so the preset's tvsf_budget
  // hint is coerced to 'custom'; the OTF cost form still resolves via agency (Ohio Third Frontier) + program (tvsf).
  ok(!!budget, `Budget volume present [${budget?.volume_format}] — OTF form resolves via agency/program`);
  const [items] = await sql`SELECT count(*)::int AS n FROM volume_required_items WHERE volume_id IN (SELECT id FROM solicitation_volumes WHERE topic_id=${OPP_ID})`;
  ok(items.n >= 18, `required items: ${items.n} (Abstract + Q1–14 + Budget + 2 letters)`);
  const [cards] = await sql`SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE opportunity_id=${OPP_ID}`;
  ok(cards.n > 0, `OPP card fanned to ${cards.n} tenant(s) via the bridge`);
  const [bridge] = await sql`SELECT count(*)::int AS n FROM opportunity_bridge WHERE opportunity_id=${OPP_ID}`;
  ok(bridge.n > 0, `bridge version(s): ${bridge.n}`);
} catch (e) {
  console.log('[tvsf] ERROR', e.message); FAILS.push('exc:' + e.message);
} finally {
  await sql.end();
  console.log('\n[tvsf] SUMMARY', FAILS.length === 0 ? 'ALL PASS — Ohio TVSF Round-45 OPP card built end-to-end (opp → apply-preset → publish → card)' : ('FAILS=' + JSON.stringify(FAILS)));
  process.exit(FAILS.length === 0 ? 0 : 1);
}
