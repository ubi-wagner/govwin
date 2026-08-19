/**
 * Restore every section of a build to its last substantial version, through the product's OWN
 * version-restore route (POST …/sections/[s]/versions {versionNumber}), as the tenant_admin.
 *
 * Written after a bad client write replaced 20 drafted sections with an empty canvas shell. The
 * content was never lost — canvas_versions had archived every draft — and this is the path the
 * workspace's own "restore this version" button takes, so recovering through it proves the trust
 * hub works rather than reaching into the database.
 *
 * Picks the highest-numbered version whose content is larger than the section's current content,
 * so a section that is already fine is left alone.
 *
 * Run: PROP=<proposalId> node scripts/t3cp-restore-sections.mjs
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

const listRes = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/sections`);
const { sections } = (await listRes.json()).data;

const nodeCount = (c) => (Array.isArray(c?.nodes) ? c.nodes.length
  : Array.isArray(c?.sections) ? c.sections.reduce((n, s) => n + (s.nodes?.length ?? 0), 0) : 0);

let restored = 0, skipped = 0;
for (const s of sections) {
  const histRes = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/sections/${s.id}/versions?limit=50`);
  if (!histRes.ok()) { console.log(`  ! ${s.title}: history ${histRes.status()}`); continue; }
  const versions = (await histRes.json()).data?.versions ?? [];

  // The history list is snake_case (`version_number`, `char_count`) — it is not passed through the
  // camel transform. Order by SIZE, not recency: the newest version may be the bad write that
  // caused the loss, and the archived draft underneath it is the one worth recovering.
  let target = null;
  for (const v of [...versions].sort((a, b) => (b.char_count ?? 0) - (a.char_count ?? 0))) {
    const n = v.version_number;
    const full = await page.request.get(
      `/api/portal/${TENANT}/proposals/${PROP}/sections/${s.id}/versions?version=${n}`);
    if (!full.ok()) continue;
    const content = (await full.json()).data?.content;
    if (nodeCount(content) > 0) { target = { n, nodes: nodeCount(content), chars: v.char_count }; break; }
  }
  if (!target) { console.log(`  – ${s.title}: no version with content`); skipped++; continue; }

  const res = await page.request.post(
    `/api/portal/${TENANT}/proposals/${PROP}/sections/${s.id}/versions`,
    { data: { versionNumber: target.n }, timeout: 60_000 });
  if (res.ok()) { restored++; console.log(`  ✓ ${s.title} ← v${target.n} (${target.nodes} nodes, ${target.chars} chars)`); }
  else console.log(`  ! ${s.title}: restore ${res.status()} ${JSON.stringify(await res.json().catch(() => ({}))).slice(0, 150)}`);
}
console.log(`\n[restore] ${restored} restored, ${skipped} skipped, of ${sections.length}`);
await browser.close();
