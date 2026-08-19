/** IMMO-A — rfp_admin finishes the DON26BX03-NP002 C-UAS master through the LIVE system:
 *  (1) close-date extension via the lifecycle route (audited, customer-visible update),
 *  (2) Amendment 01 logged + confirmed (fans out; replays at provision for mid-window buyers),
 *  (3) Complete Build-Out (readiness bar → build_complete + provisionReady broadcast).
 *
 *  cd frontend && node --import tsx scripts/immo-admin-master.mts */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SOL = 'f26005c6-8dd0-49a5-a665-e5cab42425e0';
const OPP = 'e84c5bd2-0a7e-487a-a1fd-c7dc76027f4c';
const NEW_CLOSE = '2026-09-24T21:00:00.000Z'; // 17:00 ET

let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'eric@rfppipeline.com');
await page.fill('input[type="password"]', 'RFPAdmin2026!');
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
console.log('✓ logged in as eric@rfppipeline.com →', new URL(page.url()).pathname);
const api = page.request;

// ── 1 · Close-date extension (the lifecycle system path) ──
const cd = await api.post(`${BASE}/api/admin/opportunities/${OPP}/lifecycle`, {
  data: {
    action: 'close_date_change', closeDate: NEW_CLOSE,
    reason: 'Amendment 01 — proposal due date extended (component update); build window reopened',
  },
});
ok('close_date_change accepted', cd.status() === 200, `HTTP ${cd.status()} ${(await cd.text()).slice(0, 200)}`);

// ── 2 · Amendment 01: log (detected) → confirm (fan-out + replay-at-provision) ──
const logRes = await api.post(`${BASE}/api/admin/rfp-curation/${SOL}/amendments`, {
  data: {
    label: 'Amendment 01 — Proposal due date extended',
    summary: 'The Navy has extended the DON26BX03-NP002 proposal due date to 24 September 2026, 5:00 p.m. ET. All other terms of the topic and the DoW 2026 SBIR CSO remain unchanged.',
    severity: 'major',
    complianceDelta: [
      { change: 'changed', requirement: 'Proposal Due Date', detail: 'Close extended from 2026-08-13 to 2026-09-24 17:00 ET.' },
    ],
  },
});
const logBody = logRes.status() === 200 ? await logRes.json() : { data: null };
const amendmentId: string | null = logBody?.data?.id ?? logBody?.data?.amendment?.id ?? null;
ok('amendment logged (detected)', logRes.status() === 200 && !!amendmentId, `HTTP ${logRes.status()} ${JSON.stringify(logBody).slice(0, 200)}`);

if (amendmentId) {
  const cf = await api.post(`${BASE}/api/admin/rfp-curation/${SOL}/amendments/${amendmentId}`, { data: { action: 'confirm' } });
  const cfBody = await cf.json().catch(() => ({}));
  ok('amendment confirmed (fan-out ran)', cf.status() === 200 && cfBody?.data?.confirmed === true,
    `HTTP ${cf.status()} ${JSON.stringify(cfBody).slice(0, 200)}`);
}

// ── 3 · Complete Build-Out (readiness bar → broadcast) ──
let cb = await api.post(`${BASE}/api/admin/rfp-curation/${SOL}/complete-buildout`, { data: {} });
if (cb.status() === 409) {
  const gaps = await cb.json().catch(() => ({}));
  console.log('  readiness below bar:', JSON.stringify(gaps?.data?.readiness ?? gaps).slice(0, 500));
  ok('build-out readiness bar met', false, 'route returned NOT_READY — inspect gaps above');
} else {
  const body = await cb.json().catch(() => ({}));
  const r = body?.data;
  ok('complete-buildout accepted', cb.status() === 200 && r?.ok === true, `HTTP ${cb.status()}`);
  if (r) {
    console.log(`  readiness: ready=${r.readiness?.ready} · compliance=${r.readiness?.hasCompliance ?? '?'} · volumes=${r.readiness?.volumeCount ?? '?'} · requiredItems=${r.readiness?.requiredItemCount ?? '?'}`);
    console.log(`  broadcast: opps republished=${r.opportunitiesRepublished} · cards refreshed=${r.cardsRefreshed}`);
    ok('provisionReady broadcast reached tenant mirrors', (r.cardsRefreshed ?? 0) > 0 || (r.opportunitiesRepublished ?? 0) > 0,
      'no cards refreshed (idempotent re-run is OK only if build_complete was already set)');
  }
}

await b.close();
console.log(failures === 0 ? '\nIMMO-A DRIVE: ALL GREEN' : `\nIMMO-A DRIVE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
