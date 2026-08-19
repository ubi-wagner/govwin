/** T3CP-A — curate → approve → PUSH the OSW26BZ04-DP013 (T3CP Patent Holiday) master
 *  solicitation through the product's OWN curation routes/tools, as rfp_admin.
 *
 *  Chain (mirrors components/rfp-curation/curation-workspace.tsx handleAction):
 *    solicitation.claim  →  triage skip_shredder  →  PATCH spotlightSummary
 *    →  lifecycle close_date_change  →  solicitation.request_review
 *    →  solicitation.approve  →  solicitation.push
 *
 *  cd frontend && node --import tsx scripts/t3cp-curate-push.mts <solicitationId> [opportunityId] */
import { chromium, type Browser, type APIRequestContext } from 'playwright';

const BASE = 'http://localhost:3000';
// Take the solicitation from argv like every sibling t3cp-* script — the intake mints fresh ids per
// run, so a baked-in constant is stale the moment the master is re-ingested. The landing opportunity
// is READ OFF the curation detail route below unless it is passed explicitly.
const SOL = process.argv[2] ?? '4e340a58-90ce-47d8-92cd-2bb239119141';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => {
  console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`);
  if (!c) failures++;
};

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
const admin = await login(b, 'eric@rfppipeline.com', 'RFPAdmin2026!');

/** POST /api/tools/<name> exactly as lib/hooks/use-tool.ts does. */
async function tool<T = unknown>(name: string, input: unknown): Promise<{ status: number; body: any }> {
  const r = await admin.post(`${BASE}/api/tools/${name}`, { data: { input } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status(), body };
}

// Status now, so the script is re-runnable from any point in the chain.
const cur = await admin.get(`${BASE}/api/admin/rfp-curation/${SOL}`);
const curBody = await cur.json().catch(() => ({}));
let status: string = curBody?.data?.solicitation?.status ?? '?';
const OPP: string | null = process.argv[3] ?? curBody?.data?.solicitation?.opportunityId ?? null;
ok('landing opportunity resolved', !!OPP, `sol=${SOL} opp=${OPP}`);
if (!OPP) { await b.close(); process.exit(1); }
console.log(`  starting status=${status} · opp=${OPP}`);

// ── 1 · claim (new → claimed) ──
if (status === 'new') {
  const r = await tool('solicitation.claim', { solicitationId: SOL });
  ok('solicitation.claim', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  status = 'claimed';
}

// ── 2 · start curation (claimed → curation_in_progress) via the triage route ──
if (status === 'claimed' || status === 'released_for_analysis' || status === 'ai_analyzed') {
  const r = await admin.post(`${BASE}/api/admin/rfp-curation/${SOL}/triage`, {
    data: { action: 'skip_shredder' },
  });
  const body = await r.json().catch(() => ({}));
  ok('triage skip_shredder → curation_in_progress', r.status() === 200,
    `HTTP ${r.status()} ${JSON.stringify(body).slice(0, 240)}`);
  status = 'curation_in_progress';
}

// ── 3 · spotlight-match summary (push gate 2b) via PATCH ──
const SUMMARY = [
  'DoW SBIR Open Topic "T3CP Patent Holiday" (OSW26BZ04-DP013) — a Direct-to-Phase-II-adjacent open call',
  'that lets a small business bring an ISSUED U.S. PATENT it already owns to a transition partner: the',
  'proposal must identify the patent, show a defense-relevant application, and lay out a Phase I feasibility',
  'path to a fielded capability. Fits companies whose differentiator is protected IP (computer vision,',
  'autonomy, sensing, edge AI) rather than a brand-new research idea. Seven-volume DSIP submission,',
  'Technical Volume NTE 10 pages. Strong match for tenants with granted patents plus prior DoD work.',
].join(' ');
{
  const r = await admin.patch(`${BASE}/api/admin/rfp-curation/${SOL}`, {
    data: { spotlightSummary: SUMMARY },
  });
  const body = await r.json().catch(() => ({}));
  ok('PATCH spotlightSummary saved', r.status() === 200 && !!body?.data?.spotlightSummary,
    `HTTP ${r.status()} ${JSON.stringify(body).slice(0, 240)}`);
}

// ── 4 · expected close date (push gate 2c) via the opportunity lifecycle route ──
{
  const closeDate = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
  const r = await admin.post(`${BASE}/api/admin/opportunities/${OPP}/lifecycle`, {
    data: {
      action: 'close_date_change',
      closeDate,
      reason: 'Expected close — estimate set in curation ahead of release (official DSIP date TBD).',
    },
  });
  const body = await r.json().catch(() => ({}));
  ok(`lifecycle close_date_change → ${closeDate.slice(0, 10)}`, r.status() === 200,
    `HTTP ${r.status()} ${JSON.stringify(body).slice(0, 240)}`);
}

// ── 5 · request review (curation_in_progress → review_requested) ──
if (status === 'curation_in_progress') {
  const r = await tool('solicitation.request_review', { solicitationId: SOL });
  ok('solicitation.request_review', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  status = 'review_requested';
}

// ── 6 · approve (review_requested → approved) ──
if (status === 'review_requested') {
  const r = await tool('solicitation.approve', { solicitationId: SOL });
  ok('solicitation.approve', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  status = 'approved';
}

// ── 7 · PUSH (approved → pushed_to_pipeline + activation + bridge fan-out) ──
if (status === 'approved') {
  const r = await tool('solicitation.push', { solicitationId: SOL });
  ok('solicitation.push', r.status === 200 && r.body?.data?.status === 'pushed_to_pipeline',
    `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  status = 'pushed_to_pipeline';
}

await b.close();
console.log(failures === 0 ? '\nT3CP-A: ALL GREEN' : `\nT3CP-A: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
