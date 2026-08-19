/** Attach the real T3CP source documents to the OSW26BZ04-DP013 solicitation via the product's
 *  admin RFP-upload route (emits finder:rfp.uploaded → OnRfpUploaded → shredder). */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const BASE='http://localhost:3000', U='/root/.claude/uploads/34d597b2-183f-5787-9057-fc7251e3f9ff';
const SOL = process.argv[2] ?? '11263a74-ab09-48bb-ada5-565aa2ee986e';
const FILES: Array<[string,string,string]> = [
  ['717f33f9-topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.PDF','topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.pdf','application/pdf'],
  ['8552063b-OSWT3CP_SBIR_26BZ_R4_v2.pdf','OSWT3CP_SBIR_26BZ_R4_v2.pdf','application/pdf'],
  ['aa916038-DoW_2026_SBIR_BAA_Preface_07152026.pdf','DoW_2026_SBIR_BAA_Preface_07152026.pdf','application/pdf'],
];
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await(await b.newContext()).newPage();
await page.goto(`${BASE}/login`); await page.fill('input[type="email"]','eric@rfppipeline.com'); await page.fill('input[type="password"]','RFPAdmin2026!');
await Promise.all([page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000}),page.click('button[type="submit"]')]);
console.log('✓ logged in as rfp_admin');
const fd=new FormData();
fd.append('solicitationId', SOL);
fd.append('documentTypes', JSON.stringify(['topic','instructions','rfp']));
fd.append('isPrimary','true');
for (const [src,name,type] of FILES) fd.append('files', new File([new Uint8Array(readFileSync(`${U}/${src}`))], name, { type }));
const r=await page.request.post(`${BASE}/api/admin/rfp-upload`,{multipart:fd,timeout:300000});
console.log('upload HTTP', r.status(), (await r.text()).slice(0,300));
await b.close();
