/** T3CP-2 · Advance landed → molds through the product gate, which dispatches the skeleton_architect
 *  cohort via the workflow engine. Then verify a real per-volume template exists for ALL SEVEN. */
import { chromium } from 'playwright';
const BASE='http://localhost:3000', SOL='11263a74-ab09-48bb-ada5-565aa2ee986e';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await(await b.newContext()).newPage();
await page.goto(`${BASE}/login`); await page.fill('input[type="email"]','eric@rfppipeline.com'); await page.fill('input[type="password"]','RFPAdmin2026!');
await Promise.all([page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000}),page.click('button[type="submit"]')]);
const api=page.request;
const g=await api.get(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-phase`);
console.log('phase before:', (await g.json()).data?.phase);
const r=await api.post(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-phase`,{data:{action:'approve'},timeout:300000});
console.log('approve → HTTP', r.status(), JSON.stringify(await r.json().catch(()=>({}))).slice(0,200));
await b.close();
