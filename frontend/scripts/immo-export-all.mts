import { chromium } from 'playwright'; import { writeFileSync } from 'fs';
const BASE='http://localhost:3000', SLUG='immobileyes', P='d4b6de67-eb3a-482b-84eb-4b0457687f19';
const OUT='/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await(await b.newContext()).newPage();
await page.goto(`${BASE}/login`); await page.fill('input[type="email"]','admin@immobileyes.test'); await page.fill('input[type="password"]','DemoPass123!');
await Promise.all([page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000}),page.click('button[type="submit"]')]);
const api = page.request;
// readiness
const r=(await(await api.get(`${BASE}/api/portal/${SLUG}/proposals/${P}/readiness`)).json()).data;
console.log(`readiness ready=${r.ready} blockers=${r.blockerCount} cost=${JSON.stringify(r.summary.cost)} vol=${JSON.stringify(r.summary.volumes)}`);
// whole proposal: pdf + docx
for (const fmt of ['pdf','docx']) {
  const pk=await api.post(`${BASE}/api/portal/${SLUG}/proposals/${P}/package?format=${fmt}`,{});
  const buf=Buffer.from(await pk.body()); writeFileSync(`${OUT}/Immobileyes_GHOST_DON26BX03-NP002.${fmt}`, buf);
  console.log(`proposal.${fmt}: ${(buf.length/1024).toFixed(0)} KB · compliance ${pk.headers()['x-compliance-violations']}`);
}
// find the cost artifact id
const docres = await api.get(`${BASE}/api/portal/${SLUG}/proposals/${P}/document`);
// artifacts aren't in /document; query via a small readiness-independent endpoint — use the known id fallback
const COST_ARTIFACT='f1759bad-e28d-403e-9358-d224ad066d03';
for (const fmt of ['xlsx','docx','pdf']) {
  const ex=await api.get(`${BASE}/api/portal/${SLUG}/proposals/${P}/artifacts/${COST_ARTIFACT}/export?format=${fmt}`);
  if (ex.status()!==200){ console.log(`cost.${fmt} FAILED HTTP ${ex.status()} ${(await ex.text()).slice(0,120)}`); continue; }
  const buf=Buffer.from(await ex.body()); writeFileSync(`${OUT}/Immobileyes_GHOST_CostVolume.${fmt}`, buf);
  console.log(`costvolume.${fmt}: ${(buf.length/1024).toFixed(0)} KB`);
}
await b.close();
