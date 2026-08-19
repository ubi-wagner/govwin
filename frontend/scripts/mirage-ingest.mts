/** Ingest the MIRAGE Technical Volume as the GOLD-STANDARD past proposal, through the live product
 *  path (preview → HITL review → commit) as the Immobileyes tenant admin. With the docx-reader
 *  figure fix, its 27 embedded figures now land as image atoms alongside the text atoms. */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const BASE='http://localhost:3000', SLUG='immobileyes';
const FILE='/root/.claude/uploads/34d597b2-183f-5787-9057-fc7251e3f9ff/08f85d62-MIRAGE_OSW26BZ04_DP013_Patent_Holiday_Technical_Volume.docx';
const CTX={ docType:'past_proposal', program:'sbir', phase:'1', agency:'Navy',
  topic:'OSW26BZ04-DP013', sol:'OSW26BZ04', outcome:'gold_standard' };
const NAME='MIRAGE — OSW26BZ04-DP013 T3CP Patent Holiday Technical Volume (GOLD STANDARD)';

function form(preview:boolean){
  const fd=new FormData();
  fd.append('context', JSON.stringify(CTX)); fd.append('packageName', NAME);
  if (preview) fd.append('preview','1');
  const buf=readFileSync(FILE);
  fd.append('files', new File([new Uint8Array(buf)], 'MIRAGE_OSW26BZ04_DP013_Technical_Volume.docx',
    { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  return fd;
}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await(await b.newContext()).newPage();
await page.goto(`${BASE}/login`); await page.fill('input[type="email"]','admin@immobileyes.test'); await page.fill('input[type="password"]','DemoPass123!');
await Promise.all([page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000}),page.click('button[type="submit"]')]);
console.log('✓ logged in as admin@immobileyes.test');
const api=page.request;
// PREVIEW gate (HITL: see what would be created before anything writes)
const pv=await api.post(`${BASE}/api/portal/${SLUG}/atoms/atomize-package`,{multipart:form(true),timeout:300000});
if (pv.status()!==200){ console.log('✗ preview HTTP',pv.status(),(await pv.text()).slice(0,300)); process.exit(1); }
const pd=(await pv.json()).data;
console.log(`PREVIEW: ${pd.totalPlanned} atoms planned from ${pd.docs[0].file} (${pd.docs[0].format})`);
console.log('  first titles:', pd.docs[0].planned.slice(0,6).map((p:any)=>`${p.title}(${p.wordCount}w)`).join(' · '));
// COMMIT
const cm=await api.post(`${BASE}/api/portal/${SLUG}/atoms/atomize-package`,{multipart:form(false),timeout:300000});
if (cm.status()!==200){ console.log('✗ commit HTTP',cm.status(),(await cm.text()).slice(0,300)); process.exit(1); }
const cd=(await cm.json()).data;
console.log(`✓ COMMITTED: ${cd.totalAtoms} atoms · cocoon ${cd.docs[0].cocoonId}`);
await b.close();
