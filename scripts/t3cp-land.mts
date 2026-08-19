import { chromium } from 'playwright';
const BASE='http://localhost:3000';
const SOL='11263a74-ab09-48bb-ada5-565aa2ee986e';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await(await b.newContext()).newPage();
await page.goto(`${BASE}/login`); await page.fill('input[type="email"]','eric@rfppipeline.com'); await page.fill('input[type="password"]','RFPAdmin2026!');
await Promise.all([page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000}),page.click('button[type="submit"]')]);
const api=page.request;
// What did the extractor actually READ from the source?
const g=await api.get(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-phase`);
const d=(await g.json()).data;
console.log('phase:', d.phase, '· draft:', d.draft?.id ?? 'none');
if (d.draft?.parsed) {
  const p=d.draft.parsed;
  console.log('EXTRACTED compliance:', JSON.stringify(p.compliance ?? p).slice(0,900));
  console.log('EXTRACTED volumes:', JSON.stringify(p.volumes ?? []).slice(0,600));
}
const r=await api.post(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-phase`,{data:{action:'land'},timeout:300000});
console.log('LAND →', r.status(), JSON.stringify(await r.json().catch(()=>({}))).slice(0,400));
await b.close();
