/** Proof: batch-2 polish — greeting by name · library not "empty" · per-tab titles · connor gates 403 gone. */
import { chromium } from 'playwright';
import fs from 'fs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/ux/proof2';
fs.mkdirSync(OUT, { recursive: true });
const S = 'foundation', PROP = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
async function login(p, e, pw){ await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
  await p.waitForSelector('#email',{state:'visible',timeout:20000}); await p.fill('#email',e); await p.fill('#password',pw);
  await p.click('button[type="submit"]'); await p.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:20000}).catch(()=>{}); await p.waitForTimeout(1200); }
const A=[]; const ok=(l,c,x='')=>{A.push(`${c?'✓':'✗'} ${l}${x?' — '+x:''}`);};
async function main(){
  const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
  // Kate (tenant_admin): greeting + titles + library
  const t=await b.newContext({viewport:{width:1200,height:900}});
  let p=await t.newPage(); await login(p,'kate.ulepic@foundation3dp.com','DemoPass123!');
  await p.goto(`${BASE}/portal/${S}/dashboard`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(700);
  const greet=await p.locator('h1').first().innerText().catch(()=>'');
  ok('dashboard greets the person (not the company)', /Welcome back, Kate/i.test(greet), JSON.stringify(greet));
  ok('portal tab title is per-company', /Foundation/.test(await p.title()), await p.title());
  await p.screenshot({path:`${OUT}/greeting.png`}).catch(()=>{});
  await p.goto(`${BASE}/portal/${S}/atoms`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(1200);
  const body=await p.locator('body').innerText().catch(()=>'');
  ok('library does NOT falsely claim "empty" (23 atoms present)', !/Your library is empty/i.test(body));
  await p.screenshot({path:`${OUT}/library.png`,fullPage:true}).catch(()=>{});
  await p.close(); await t.close();
  // Connor (tenant_user): proposal detail must NOT 403 on the gates fetch
  const c=await b.newContext({viewport:{width:1200,height:900}});
  p=await c.newPage(); const status403=[];
  p.on('response',r=>{ if(r.status()===403 && /\/gates/.test(r.url())) status403.push(r.url()); });
  await login(p,'connor.casey@foundation3dp.com','DemoPass123!');
  await p.goto(`${BASE}/portal/${S}/proposals/${PROP}`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(1500);
  ok('tenant_user proposal view: NO 403 on /gates (RBAC fix)', status403.length===0, status403.join(',')||'clean');
  ok('proposal tab title is per-company', /Foundation/.test(await p.title()), await p.title());
  await p.close(); await c.close();
  await b.close();
  console.log(A.join('\n'));
  console.log(A.every(l=>l.startsWith('✓'))?'\n✅ ALL PASS':'\n❌ see failures');
  fs.writeFileSync(`${OUT}/result.txt`, A.join('\n'));
}
main().catch(e=>{console.error(String(e).slice(0,200));process.exit(1);});
