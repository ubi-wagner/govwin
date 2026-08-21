/** Proof re-drive (390×844): confirm the polished operational surfaces now work on mobile. */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/ux/proof';
import fs from 'fs'; fs.mkdirSync(OUT, { recursive: true });
const S = 'foundation', PROP = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
async function login(p, e, pw){ await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
  await p.waitForSelector('#email',{state:'visible',timeout:20000}); await p.fill('#email',e); await p.fill('#password',pw);
  await p.click('button[type="submit"]'); await p.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:20000}).catch(()=>{}); await p.waitForTimeout(1200); }
async function shot(p,n,full=false){ await p.screenshot({path:`${OUT}/${n}.png`,fullPage:full}).catch(()=>{}); console.log('✓',n); }
async function main(){
  const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
  // tenant_admin: compose (stacked) + studio strip (stacked) + stage control
  const t=await b.newContext({viewport:{width:390,height:844},isMobile:true});
  let p=await t.newPage(); await login(p,'kate.ulepic@foundation3dp.com','DemoPass123!');
  await p.goto(`${BASE}/portal/${S}/proposals/${PROP}`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(1000);
  await shot(p,'p1-studio-strip');                        // studio 3-phase should stack
  try{ await p.getByText(/Assign a task/i).first().click({timeout:4000}); await p.waitForTimeout(700);}catch{}
  await shot(p,'p2-compose-stacked');                     // compose selects should stack full-width
  await p.close(); await t.close();
  // rfp_admin: triage queue → mobile cards with actions
  const a=await b.newContext({viewport:{width:390,height:844},isMobile:true});
  p=await a.newPage(); await login(p,'eric@rfppipeline.com',(process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  await p.goto(`${BASE}/admin/rfp-curation`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(1000);
  await shot(p,'p3-triage-cards',true);                  // titles + agency/status + Claim/Open per card
  await p.close(); await a.close();
  await b.close(); console.log('proof done');
}
main().catch(e=>{console.error(String(e).slice(0,200));process.exit(1);});
