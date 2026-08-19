/** Drive the Ingest Studio phase machine for OSW26BZ04-DP013 through the product's own gates:
 *  start (extract) → approve → matrix → approve → review → land. Reports what the SYSTEM extracts. */
import { chromium } from 'playwright';
const BASE='http://localhost:3000';
const SOL = process.argv[2] ?? '11263a74-ab09-48bb-ada5-565aa2ee986e';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await(await b.newContext()).newPage();
await page.goto(`${BASE}/login`); await page.fill('input[type="email"]','eric@rfppipeline.com'); await page.fill('input[type="password"]','RFPAdmin2026!');
await Promise.all([page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000}),page.click('button[type="submit"]')]);
const api=page.request;
const g=await api.get(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-phase`);
const gb=await g.json().catch(()=>({}));
console.log('phase GET:', g.status(), JSON.stringify(gb?.data ?? gb).slice(0,500));
for (const action of ['start','approve','start','approve','start','approve']) {
  const r=await api.post(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-phase`,{data:{action},timeout:300000});
  const body=await r.json().catch(()=>({}));
  const d=body?.data ?? body;
  console.log(`${action} → HTTP ${r.status()} phase=${d?.phase ?? d?.currentPhase ?? '?'} ${JSON.stringify(d).slice(0,220)}`);
  if (r.status()!==200) break;
  if ((d?.phase ?? d?.currentPhase) === 'landed') break;
}
await b.close();
