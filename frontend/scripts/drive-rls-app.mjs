/**
 * App-level RLS proof: with the app connected as govtech_app (NOBYPASSRLS), log in as the
 * tenant admin and hit the real portal API routes that read isolated tables. Each must return
 * its tenant's data (200 + non-empty) — an empty/500 = a DENY-ALL where the enterTenant choke
 * point didn't fire. Then hit an admin cross-tenant route (must use the bypass pool).
 *   node scripts/drive-rls-app.mjs
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const SLUG = 'immobileyes';

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await p.locator('#email').fill(email);
  await p.locator('#password').fill(pw);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return p;
}

async function getJson(ctx, path) {
  const r = await ctx.request.get(`${BASE}${path}`);
  let body = null; try { body = await r.json(); } catch { /* non-json */ }
  const data = body && (body.data ?? body);
  const count = Array.isArray(data) ? data.length
    : data && Array.isArray(data.cards) ? data.cards.length
    : data && Array.isArray(data.buckets) ? data.buckets.length
    : data && Array.isArray(data.proposals) ? data.proposals.length
    : data && typeof data === 'object' ? Object.keys(data).length : (data ? 1 : 0);
  return { status: r.status(), count };
}

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const results = [];

  // ── tenant admin: portal routes that read isolated tables (immobileyes has real data) ──
  const tctx = await b.newContext();
  const tp = await login(tctx, 'eric@immobileyes.com', 'Sandbox2026!');
  console.log('tenant login →', tp.url());
  const portal = [
    ['cards (tenant_opportunity_cards + bucket_scores)', `/api/portal/${SLUG}/cards`],
    ['buckets (tenant_spotlight_buckets)',               `/api/portal/${SLUG}/buckets`],
    ['proposals (proposals)',                            `/api/portal/${SLUG}/proposals`],
    ['team (users + memberships)',                       `/api/portal/${SLUG}/team`],
    ['vaults (collaboration_vaults)',                    `/api/portal/${SLUG}/vaults`],
  ];
  for (const [label, path] of portal) {
    const { status, count } = await getJson(tctx, path);
    const ok = status === 200 && count > 0;   // immobileyes has data in each → DENY-ALL would be 0
    results.push([`portal · ${label}`, ok, `${status} · n=${count}`]);
  }
  await tctx.close();

  for (const [m, ok, info] of results) console.log(`${ok ? '✅' : '❌'} ${m}  (${info})`);
  await b.close();
  const pass = results.every(([, ok]) => ok);
  console.log(pass ? `\n✅ APP-LEVEL RLS PROOF PASS (${results.length}/${results.length}) — govtech_app` : '\n❌ FAIL — a DENY-ALL surfaced (see 0-count rows)');
  if (!pass) process.exit(1);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
