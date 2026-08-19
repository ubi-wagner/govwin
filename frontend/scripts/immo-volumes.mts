import { chromium } from 'playwright'; import { writeFileSync } from 'fs';
const BASE='http://localhost:3000', SLUG='immobileyes', P='d4b6de67-eb3a-482b-84eb-4b0457687f19';
const OUT='/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/vols';
// volume → {artifactId, format, filename}
const VOLS = [
  { id:'bccf4534-782f-4b56-b2ec-fa66f29ed1cd', fmt:'pdf',  name:'Immobileyes_GHOST_Vol1_CoverSheet.pdf' },
  { id:'ae36bc17-ed6f-4ca1-b539-8c9c033c2061', fmt:'pdf',  name:'Immobileyes_GHOST_Vol2_Technical.pdf' },
  { id:'f1759bad-e28d-403e-9358-d224ad066d03', fmt:'xlsx', name:'Immobileyes_GHOST_Vol3_Cost.xlsx' },
  { id:'c2f76c0d-c703-4b76-9309-4c2fb82955d8', fmt:'pdf',  name:'Immobileyes_GHOST_Vol4_CCR.pdf' },
  { id:'bde7ae31-7858-40b8-94eb-623e3528b2b4', fmt:'pdf',  name:'Immobileyes_GHOST_Vol5_SupportingDocs.pdf' },
  { id:'69ec6b4a-7228-43d9-9725-90c29dc8b694', fmt:'pdf',  name:'Immobileyes_GHOST_Vol6_FWA.pdf' },
];
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await(await b.newContext()).newPage();
await page.goto(`${BASE}/login`); await page.fill('input[type="email"]','admin@immobileyes.test'); await page.fill('input[type="password"]','DemoPass123!');
await Promise.all([page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000}),page.click('button[type="submit"]')]);
let ok=0;
for (const v of VOLS) {
  const r=await page.request.get(`${BASE}/api/portal/${SLUG}/proposals/${P}/artifacts/${v.id}/export?format=${v.fmt}`);
  if (r.status()!==200){ console.log(`✗ ${v.name} HTTP ${r.status()} ${(await r.text()).slice(0,120)}`); continue; }
  const buf=Buffer.from(await r.body()); writeFileSync(`${OUT}/${v.name}`, buf);
  console.log(`✓ ${v.name} — ${(buf.length/1024).toFixed(0)} KB`); ok++;
}
await b.close();
console.log(ok===VOLS.length ? '\nALL 6 VOLUMES EXPORTED' : `\n${ok}/6 exported`);
