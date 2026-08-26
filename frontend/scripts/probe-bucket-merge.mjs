/** Narrow the bucket-PATCH merge failure to ONE step.
 *
 * The route reads correct and the compiled bundle reads correct: SELECT the stored criteria,
 * shallow-merge the sanitized partial over it, write the result. The SELECT itself is fine — run
 * by hand as govtech_app inside a withTenant transaction it returns the row. And yet the stored
 * value after a {keywords} PATCH is ONLY {keywords}.
 *
 * So stop reasoning and vary one thing at a time:
 *   A. PATCH a key that is NOT in the stored criteria  → does the stored value keep the rest?
 *   B. PATCH a key that IS already stored              → same question, different overlap.
 *   C. PATCH {} (nothing survives sanitize)            → if the row goes to {}, the merge input
 *                                                        was empty, which points at the SELECT
 *                                                        result inside the request, not the merge.
 * Each step prints what is in the database immediately afterwards.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sql = postgres(process.env.DATABASE_URL_OWNER, { max: 2 });

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
await page.fill('input[name="password"]', process.env.FOUNDATION_PW || 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

const API = '/api/portal/foundation/buckets';
const stored = async (id) => {
  const [r] = await sql`SELECT criteria FROM tenant_spotlight_buckets WHERE id = ${id}::uuid`;
  return JSON.stringify(r?.criteria);
};

const seed = { keywords: ['additive'], useTimeline: false, weights: { keyword: 1 }, agencies: ['navy'] };
const r = await page.request.post(BASE + API, { data: { name: 'Merge Probe', criteria: seed } });
const id = (await r.json()).data.id;
console.log('seeded  :', await stored(id));

for (const [label, partial] of [
  ['A  PATCH {naics:["541715"]}      (key NOT already stored)', { naics: ['541715'] }],
  ['B  PATCH {keywords:["zzz"]}      (key already stored)    ', { keywords: ['zzz'] }],
  ['C  PATCH {bogus:1}               (survives sanitize: {}) ', { bogus: 1 }],
]) {
  const res = await page.request.patch(`${BASE}${API}/${id}`, { data: { criteria: partial } });
  console.log(`${label} → ${res.status()}  stored: ${await stored(id)}`);
}

await page.request.delete(`${BASE}${API}/${id}`);
await browser.close();
await sql.end();
