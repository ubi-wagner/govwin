/**
 * Retire a set of library atoms through the product's OWN archive route, as the tenant_admin.
 *
 * Used after re-atomizing a past proposal: the superseded atoms carry the running page furniture
 * the shredder used to keep, so they must leave draft selection. Archive is soft and reversible
 * (docs/ARCHIVABLE_CONTRACT.md) — nothing is deleted, and the route is the same one the library
 * UI's per-item archive button calls.
 *
 * Ids come in on argv, so the caller decides WHICH atoms; this script never queries the database.
 *
 * Run: node scripts/t3cp-archive-atoms.mjs <atomId...>
 */
import { chromium } from '@playwright/test';

const TENANT = process.env.TENANT ?? 'immobileyes';
const IDS = process.argv.slice(2).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
if (!IDS.length) { console.error('usage: t3cp-archive-atoms.mjs <atomId...>'); process.exit(1); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', process.env.EMAIL ?? 'admin@immobileyes.test');
await page.fill('input[type="password"]', process.env.PASSWORD ?? 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);

let archived = 0;
const failures = [];
for (const id of IDS) {
  // The dedicated archive route (POST …/archive {action}) is the canonical path: it sets the
  // `archived_at` watermark via lib/atoms.archiveAtom and emits library:atom.archived. The PATCH
  // route's `status` field is a different thing (draft/approved/archived review state) and does
  // NOT drop an atom out of the library's active reads.
  const res = await page.request.post(`/api/portal/${TENANT}/atoms/${id}/archive`, {
    data: { action: 'archive' }, timeout: 60_000,
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok() && body?.data?.archived) archived++;
  // 409 = already archived. That is the route telling the truth about a no-op, not a failure.
  else if (res.status() !== 409) failures.push({ id, status: res.status(), body: JSON.stringify(body).slice(0, 160) });
}

console.log(`[archive] ${archived}/${IDS.length} atoms archived`);
for (const f of failures.slice(0, 10)) console.log(`  ! ${f.id} → ${f.status} ${f.body}`);
if (failures.length > 10) console.log(`  … and ${failures.length - 10} more`);
await browser.close();
