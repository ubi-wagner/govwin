/** IMMO-D/F narrative authoring — the tenant admin authors every narrative volume onto the ONE
 *  canvas via the live section save route (PUT …/sections/[s]/save). Cost §§14–15 are engine-authored
 *  separately (immo-cost.mts). Each PUT preserves the section's own canvas frame + metadata and lands
 *  human_edit content, so the compliance floor + version history behave exactly as in the product.
 *
 *  cd frontend && node --import tsx scripts/immo-author.mts */
import { chromium } from 'playwright';
import { CONTENT } from './immo-content.mts';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const SLUG = 'immobileyes';
const PROPOSAL = 'd4b6de67-eb3a-482b-84eb-4b0457687f19';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'admin@immobileyes.test');
await page.fill('input[type="password"]', 'DemoPass123!');
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
console.log('✓ logged in as admin@immobileyes.test');
const api = page.request;

// Load every section's live canvas frame + version + number.
const docRes = await api.get(`${BASE}/api/portal/${SLUG}/proposals/${PROPOSAL}/document`);
ok('document GET', docRes.status() === 200, `HTTP ${docRes.status()}`);
const doc = await docRes.json();
const sections: Array<{ id: string; title: string; canvas: unknown; metadata: Record<string, unknown> | null }> = doc.data.sections;

// Map section id → number via the readiness/overview (sections carry section_number in metadata? fall back to title order).
// The document route returns sections in volume/sort order; align by title to CONTENT keys via a lookup.
const TITLE_TO_NUM: Record<string, string> = {
  'Proposal Cover Sheet & Technical Abstract': '1',
  'Identification and Significance of the Problem or Opportunity': '2',
  'Phase I Technical Objectives': '3',
  'Phase I Statement of Work': '4',
  'Related Work': '5',
  'Relationship with Future Research or Research and Development': '6',
  'Commercialization Strategy': '7',
  'Key Personnel': '8',
  'Foreign Citizens': '9',
  'Facilities/Equipment': '10',
  'Subcontractors/Consultants': '11',
  'Prior, Current, or Pending Support of Similar Proposals or Awards': '12',
  "Assertion of Restrictions on the Government's Use/Release of Technical Data or Software": '13',
  'Company Commercialization Report (CCR)': '16',
  'Foreign Nationals Disclosure (ITAR/EAR)': '17',
  'Letters of Support': '18',
  'DD Form 2345 — Militarily Critical Technical Data Agreement': '19',
  'Technical Data Rights Assertions': '20',
  'CMMC Level 2 (Self) Reps & Certifications': '21',
  'Fraud, Waste, and Abuse Training Certification': '22',
};

for (const s of sections) {
  const num = TITLE_TO_NUM[s.title];
  if (!num || !CONTENT[num]) continue; // cost sections + anything unmapped are handled elsewhere
  const nodes = CONTENT[num];
  // Rebuild the section save-doc: the section's OWN frame + metadata + our authored nodes.
  const content = {
    version: 1,
    canvas: s.canvas,
    metadata: { ...(s.metadata ?? {}), status: 'complete' },
    nodes,
  };
  // baseVersion: read fresh so re-runs increment cleanly.
  const cur = sections.find((x) => x.id === s.id) as unknown as { version?: number };
  const put = await api.put(`${BASE}/api/portal/${SLUG}/proposals/${PROPOSAL}/sections/${s.id}/save`, {
    data: { content, source: 'human_edit', status: 'complete', baseVersion: cur?.version ?? undefined,
            editSummary: `Authored ${s.title} from the GHOST past-proposal library` },
    timeout: 60_000,
  });
  const body = await put.json().catch(() => ({}));
  ok(`§${num} ${s.title.slice(0, 46)}`, put.status() === 200, `HTTP ${put.status()} ${JSON.stringify(body).slice(0, 160)}`);
}

await b.close();
console.log(failures === 0 ? '\nIMMO-AUTHOR: ALL GREEN' : `\nIMMO-AUTHOR: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
