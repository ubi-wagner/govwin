/** Live cross-boundary LEAKAGE negative drive. Kate (Foundation tenant_admin, active) must NOT be
 *  able to read another tenant's data — via a foreign tenant slug (→403) OR via her own slug with a
 *  foreign atom id (→404, the subtle vector). Positive control confirms her own tenant works.
 *  cd frontend && node --import tsx scripts/drive-leakage.mts */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.BASE || 'http://localhost:3000';
const sql = postgres('postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 2 });
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

try {
  // A real foreign atom (rfp-pipeline system tenant, 303 atoms) + its title, to prove it never leaks.
  const [foreign] = await sql<Array<{ id: string; title: string | null }>>`
    SELECT a.id, a.title FROM library_atoms a JOIN tenants t ON t.id=a.tenant_id WHERE t.slug='rfp-pipeline' AND a.title IS NOT NULL LIMIT 1`;
  const foreignTitle = (foreign?.title ?? '').slice(0, 40);

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name=email]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name=password]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]);
  await p.waitForTimeout(1000);

  const hit = (path: string) => p.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, body: (await r.text()).slice(0, 4000) }; }, path);

  // Positive control — her own tenant works.
  const own = await hit('/api/portal/foundation/atoms');
  A('POSITIVE control: kate reads her OWN tenant library (200)', own.status === 200, `status=${own.status}`);

  // Cross-tenant via a FOREIGN slug — the membership gate must 403.
  for (const slug of ['rfp-pipeline', 'entrepreneurs-center', 'youngstown-business-incubator']) {
    const r1 = await hit(`/api/portal/${slug}/atoms`);
    A(`cross-tenant blocked: GET /portal/${slug}/atoms → 403`, r1.status === 403, `status=${r1.status}`);
    const r2 = await hit(`/api/portal/${slug}/atoms/select?kinds=narrative,figure&limit=5`);
    A(`cross-tenant blocked: GET /portal/${slug}/atoms/select → 403`, r2.status === 403, `status=${r2.status}`);
    A(`no foreign atom data in either ${slug} response`, !foreignTitle || (!r1.body.includes(foreignTitle) && !r2.body.includes(foreignTitle)));
  }

  // Subtle vector — kate's OWN valid slug, but a foreign atom id. getAtom must scope by tenant → 404.
  if (foreign?.id) {
    const det = await hit(`/api/portal/foundation/atoms/${foreign.id}`);
    A('foreign atom id under OWN slug does not resolve (404/blocked, not 200)', det.status !== 200, `status=${det.status}`);
    A('foreign atom content did not leak through the detail route', !foreignTitle || !det.body.includes(foreignTitle));
  }
  await b.close();
} catch (e) { console.error('FAILED:', e); ok = false; }
finally { await sql.end({ timeout: 5 }); }
console.log(ok ? '\nPASS — no cross-tenant leakage: every foreign read is blocked, only own-tenant data is served' : '\nFAIL — a cross-boundary read leaked');
process.exit(ok ? 0 : 1);
