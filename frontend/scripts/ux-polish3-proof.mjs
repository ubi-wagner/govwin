/** Proof: batch-3a — proposal "Manage" segmented control (double tab-row fixed) · cards de-jargon · buckets gated btn. */
import { chromium } from 'playwright';
import fs from 'fs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/ux/proof3';
fs.mkdirSync(OUT, { recursive: true });
const S='foundation', PROP='c3db60b1-2f0e-4bc8-903c-1ec098906c58';
async function login(p,e,pw){ await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
  await p.waitForSelector('#email',{state:'visible',timeout:20000}); await p.fill('#email',e); await p.fill('#password',pw);
  await p.click('button[type="submit"]'); await p.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:20000}).catch(()=>{}); await p.waitForTimeout(1200); }
const A=[]; const ok=(l,c,x='')=>A.push(`${c?'✓':'✗'} ${l}${x?' — '+x:''}`);
async function main(){
  const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
  const t=await b.newContext({viewport:{width:1280,height:1000}});
  let p=await t.newPage(); await login(p,'kate.ulepic@foundation3dp.com','DemoPass123!');
  await p.goto(`${BASE}/portal/${S}/proposals/${PROP}`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(1200);
  const body=await p.locator('body').innerText().catch(()=>'');
  ok('proposal shows the subordinate "Manage" toolset label', /Manage/.test(body));
  await p.screenshot({path:`${OUT}/proposal-manage.png`,fullPage:true}).catch(()=>{});
  await p.goto(`${BASE}/portal/${S}/cards`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(1000);
  const cbody=await p.locator('body').innerText().catch(()=>'');
  ok('cards: jargon gone ("copy docs" absent)', !/copy docs/i.test(cbody));
  ok('cards: clear verb present ("Pin to pursue")', /Pin to pursue/i.test(cbody));
  await p.screenshot({path:`${OUT}/cards.png`}).catch(()=>{});
  await p.goto(`${BASE}/portal/${S}/buckets`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(900);
  await p.screenshot({path:`${OUT}/buckets.png`}).catch(()=>{});
  ok('buckets page renders', /Spotlight Buckets/i.test(await p.locator('body').innerText().catch(()=>'')));
  await p.close(); await t.close(); await b.close();
  console.log(A.join('\n')); console.log(A.every(l=>l.startsWith('✓'))?'\n✅ ALL PASS':'\n❌ see failures');
  fs.writeFileSync(`${OUT}/result.txt`,A.join('\n'));
}
main().catch(e=>{console.error(String(e).slice(0,200));process.exit(1);});
