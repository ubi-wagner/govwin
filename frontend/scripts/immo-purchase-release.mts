/** IMMO-B — purchase → release → workflow-setup, three real actors through the LIVE system:
 *  (1) Immobileyes admin comp-code purchase (rfppipelinetest) on the C-UAS card,
 *  (2) rfp_admin Complete & Release from the provisioning cockpit route (PV-3),
 *      incl. the mig-190 amendment REPLAY onto the fresh proposal (mid-window buyer),
 *  (3) Immobileyes admin completes + Accept & Starts the required Workflow Setup (TW-3),
 *      stage gates dated against the extended close (2026-09-24).
 *
 *  cd frontend && node --import tsx scripts/immo-purchase-release.mts */
import { chromium, type Browser, type APIRequestContext } from 'playwright';

const BASE = 'http://localhost:3000';
const OPP = 'e84c5bd2-0a7e-487a-a1fd-c7dc76027f4c';
const SLUG = 'immobileyes';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

async function login(b: Browser, email: string, password: string): Promise<APIRequestContext> {
  const page = await (await b.newContext()).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log(`✓ logged in as ${email}`);
  return page.request;
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// Re-entry: pass an existing portalId to skip purchase+release (already-landed steps).
const existingPortal = process.argv[2] ?? null;
const buyer = await login(b, 'admin@immobileyes.test', 'DemoPass123!');
let portalId: string | null = existingPortal;
if (!existingPortal) {
  // ── 1 · BUYER: comp-code purchase ──
  const pu = await buyer.post(`${BASE}/api/portal/${SLUG}/purchase`, {
    data: { opportunityId: OPP, promoCode: 'rfppipelinetest' },
  });
  const puBody = await pu.json().catch(() => ({}));
  portalId = puBody?.data?.portalId ?? null;
  ok('comp-code purchase accepted', pu.status() === 200 && !!portalId, `HTTP ${pu.status()} ${JSON.stringify(puBody).slice(0, 250)}`);
  if (!portalId) { await b.close(); process.exit(1); }
  console.log(`  portalId=${portalId}`);

  // ── 2 · RFP ADMIN: cockpit Complete & Release ──
  const admin = await login(b, 'eric@rfppipeline.com', 'RFPAdmin2026!');
  const rel = await admin.post(`${BASE}/api/admin/provisioning/${portalId}/release`, { data: {} });
  const relBody = await rel.json().catch(() => ({}));
  const proposalId: string | null = relBody?.data?.proposalId ?? null;
  ok('release provisioned the private portal', rel.status() === 200 && !!proposalId,
    `HTTP ${rel.status()} ${JSON.stringify(relBody).slice(0, 300)}`);
  console.log(`  proposalId=${proposalId} · tasksCreated=${relBody?.data?.tasksCreated}`);
}

// ── 3 · BUYER: required Workflow Setup — review recommendation, complete, Accept & Start ──
const wfGet = await buyer.get(`${BASE}/api/portal/${SLUG}/portals/${portalId}/workflow`);
const wfBody = await wfGet.json().catch(() => ({}));
ok('workflow-setup GET (pending + recommendation offered)', wfGet.status() === 200 && wfBody?.data?.accepted === false,
  `HTTP ${wfGet.status()} accepted=${wfBody?.data?.accepted}`);
const baseCfg = wfBody?.data?.config ?? {};
const stages: Array<Record<string, unknown>> = Array.isArray(baseCfg.stages) && baseCfg.stages.length === 3
  ? baseCfg.stages : [{ key: 'draft', label: 'Draft' }, { key: 'review', label: 'Review' }, { key: 'final', label: 'Final' }];

// The HITL plan: absolute gate dates working back from the extended close (9/24), every ToDo owned.
const PLAN: Record<string, { dueDate: string; todos: Array<Record<string, unknown>> }> = {
  draft:  { dueDate: '2026-09-10', todos: [
    { type: 'acknowledge', title: 'Draft all volumes (V1 cover summaries · V2 white paper · V3 cost · V4 CCR · V5 supporting · V6 FWA)', assigneeRole: 'tenant_admin', nudgeDays: [3] },
  ]},
  review: { dueDate: '2026-09-17', todos: [
    { type: 'acknowledge', title: 'Red-team review: technical vs topic areas of interest + cost vs $200K/$115K caps', assigneeRole: 'tenant_admin', nudgeDays: [2] },
  ]},
  final:  { dueDate: '2026-09-22', todos: [
    { type: 'acknowledge', title: 'Final compliance check + DSIP submission (2 days before close)', assigneeRole: 'tenant_admin', nudgeDays: [1] },
  ]},
};
const cfg = {
  ...baseCfg,
  stages: stages.map((s) => ({ ...s, ...(PLAN[String(s.key)] ?? {}), gateCloser: 'human' })),
};
const acc = await buyer.patch(`${BASE}/api/portal/${SLUG}/portals/${portalId}/workflow`, { data: { config: cfg, accept: true } });
const accBody = await acc.json().catch(() => ({}));
ok('Accept & Start installed the plan', acc.status() === 200 && accBody?.data?.accepted === true,
  `HTTP ${acc.status()} ${JSON.stringify(accBody).slice(0, 250)}`);
console.log(`  stage ToDos created=${accBody?.data?.created}`);

await b.close();
console.log(failures === 0 ? '\nIMMO-B DRIVE: ALL GREEN' : `\nIMMO-B DRIVE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
