/**
 * Re-atomize the tenant's past proposals through the product's OWN upload route, as the
 * tenant_admin, from inside the browser — the same FormData the "Add content" card posts.
 *
 * Two passes, exactly as the UI does them:
 *   1. preview — nothing is written; prints what the product plans AND the running page
 *      header/footer it will strip, so the removal is inspected before the library is touched.
 *   2. commit  — the atoms are created by the product.
 *
 * No direct DB writes anywhere: the library has to be rebuilt by the product or it proves nothing.
 *
 * Run: node scripts/t3cp-reatomize.mjs <pdf...>
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { basename } from 'path';

const TENANT = process.env.TENANT ?? 'immobileyes';
const FILES = process.argv.slice(2);
if (!FILES.length) { console.error('usage: t3cp-reatomize.mjs <pdf...>'); process.exit(1); }

const payload = FILES.map((f) => ({
  // Uploads are stored under a hashed prefix; the product only ever sees the real filename,
  // which the DSIP classifier reads (Full_Proposal vs a sidecar).
  name: basename(f).replace(/^[0-9a-f]{8}-/, ''),
  b64: readFileSync(f).toString('base64'),
}));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', process.env.EMAIL ?? 'admin@immobileyes.test');
await page.fill('input[type="password"]', process.env.PASSWORD ?? 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);

const post = (files, tenant, extra) => page.evaluate(async ({ files, tenant, extra }) => {
  const fd = new FormData();
  for (const f of files) {
    const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
    fd.append('files', new File([bin], f.name, { type: 'application/pdf' }));
  }
  fd.append('context', JSON.stringify({ docType: 'past_proposal' }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await fetch(`/api/portal/${tenant}/atoms/atomize-package`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}, { files, tenant, extra });

// ── 1. Preview ───────────────────────────────────────────────────────────────
const pv = await post(payload, TENANT, { preview: '1' });
if (pv.status !== 200) { console.error('[preview] FAILED', pv.status, JSON.stringify(pv.body).slice(0, 400)); process.exit(1); }
for (const d of pv.body.data.docs) {
  console.log(`\n[preview] ${d.file}: ${d.planned.length} atoms, skipped ${d.skipped}${d.error ? ` — ${d.error}` : ''}`);
  if (d.strippedFurniture?.length) {
    console.log('  running furniture removed from every page:');
    for (const f of d.strippedFurniture) console.log(`    · ${f}`);
  } else {
    console.log('  (no running furniture detected)');
  }
  for (const p of d.planned.slice(0, 5)) console.log(`    ${p.title} (${p.wordCount}w)`);
}

// ── 2. Commit ────────────────────────────────────────────────────────────────
const co = await post(payload, TENANT, { packageName: process.env.PKG ?? 'Immobileyes past proposals' });
console.log('\n[commit]', co.status, JSON.stringify(co.body).slice(0, 700));
await browser.close();
