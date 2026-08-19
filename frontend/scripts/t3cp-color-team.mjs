/**
 * Run the AI color-team review over a build and READ BACK what it produced, as the buying
 * tenant_admin, through the product's own routes.
 *
 * The point is the read-back. A review that dispatches and reports "requested: true" proves
 * nothing — an earlier pass on this build had 44 review tasks queued and 36 of them rate-limited
 * into failure, with the failures surfaced nowhere. So this reports, per section: the task status,
 * and the findings that actually landed as proposal_comments.
 *
 * Run: PROP=<proposalId> node scripts/t3cp-color-team.mjs
 */
import { chromium } from '@playwright/test';

const TENANT = process.env.TENANT ?? 'immobileyes';
const PROP = process.env.PROP;
if (!PROP) { console.error('PROP=<proposalId> required'); process.exit(1); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', process.env.EMAIL ?? 'admin@immobileyes.test');
await page.fill('input[type="password"]', process.env.PASSWORD ?? 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);

const before = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/ai-review`);
console.log('[before]', before.status(), JSON.stringify(await before.json().catch(() => ({}))).slice(0, 400), '\n');

const req = await page.request.post(`/api/portal/${TENANT}/proposals/${PROP}/ai-review`, {
  data: {}, timeout: 300_000,
});
console.log('[request]', req.status(), JSON.stringify(await req.json().catch(() => ({}))).slice(0, 300), '\n');

// Poll the product's own status endpoint until the queue drains (or stops moving).
let last = '';
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 6000));
  const st = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/ai-review`);
  if (!st.ok()) continue;
  const d = (await st.json()).data;
  const line = JSON.stringify(d.summary ?? d);
  if (line === last && i > 3) break;
  last = line;
}
const fin = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/ai-review`);
const data = (await fin.json()).data;
console.log('[status]', JSON.stringify(data).slice(0, 1200), '\n');

// What actually LANDED — the findings a builder can read on the page.
const comments = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/comments`);
if (comments.ok()) {
  const cb = (await comments.json()).data;
  const rows = (Array.isArray(cb) ? cb : cb.comments) ?? [];
  const ai = rows.filter((c) => /ai|review|color/i.test(c.authorName ?? c.author ?? c.source ?? ''));
  console.log(`[findings] ${rows.length} comments on the build, ${ai.length} from the review`);
  for (const c of ai.slice(0, 12)) {
    console.log(`   · ${(c.sectionTitle ?? c.sectionId ?? '').toString().slice(0, 40)}: ${(c.body ?? c.content ?? '').toString().slice(0, 150)}`);
  }
} else {
  console.log('[findings] comments', comments.status());
}
await browser.close();
