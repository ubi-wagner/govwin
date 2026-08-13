/** Proof: sectioned tenant nav — admin sees Pursue/Build/Work/Account; tenant_user sees the subset, no empty headers. */
import { chromium } from 'playwright';
import fs from 'fs';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE='http://localhost:3000';
const OUT='/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/ux/proofnav';
fs.mkdirSync(OUT,{recursive:true}); const S='foundation';
async function login(p,e,pw){ await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
  await p.waitForSelector('#email',{state:'visible',timeout:20000}); await p.fill('#email',e); await p.fill('#password',pw);
  await p.click('button[type="submit"]'); await p.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:20000}).catch(()=>{}); await p.waitForTimeout(1200); }
const A=[]; const ok=(l,c,x='')=>A.push(`${c?'✓':'✗'} ${l}${x?' — '+x:''}`);
async function navText(p){ return (await p.locator('nav').first().innerText().catch(()=>'')); }
async function main(){
  const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
  // tenant_admin
  let ctx=await b.newContext({viewport:{width:1200,height:1000}}); let p=await ctx.newPage();
  await login(p,'kate.ulepic@foundation3dp.com','DemoPass123!');
  await p.goto(`${BASE}/portal/${S}/dashboard`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(700);
  const kn=await navText(p);
  ok('admin nav has all 4 sections', ['PURSUE','BUILD','WORK','ACCOUNT'].every(s=>kn.toUpperCase().includes(s)), JSON.stringify(kn.replace(/\n/g,'·')).slice(0,180));
  await p.screenshot({path:`${OUT}/admin-nav.png`}).catch(()=>{});
  await p.close(); await ctx.close();
  // tenant_user
  ctx=await b.newContext({viewport:{width:1200,height:1000}}); p=await ctx.newPage();
  await login(p,'connor.casey@foundation3dp.com','DemoPass123!');
  await p.goto(`${BASE}/portal/${S}/dashboard`,{waitUntil:'networkidle',timeout:40000}); await p.waitForTimeout(700);
  const cn=await navText(p);
  ok('tenant_user has NO Pursue section (admin-only)', !cn.toUpperCase().includes('PURSUE'));
  ok('tenant_user has Build + Work sections', cn.toUpperCase().includes('BUILD') && cn.toUpperCase().includes('WORK'));
  ok('tenant_user does NOT see admin items (Manage/Buckets/Vaults)', !/Manage|Buckets|Vaults/.test(cn), JSON.stringify(cn.replace(/\n/g,'·')).slice(0,180));
  await p.screenshot({path:`${OUT}/user-nav.png`}).catch(()=>{});
  await p.close(); await ctx.close(); await b.close();
  console.log(A.join('\n')); console.log(A.every(l=>l.startsWith('✓'))?'\n✅ ALL PASS':'\n❌ see failures');
  fs.writeFileSync(`${OUT}/result.txt`,A.join('\n'));
}
main().catch(e=>{console.error(String(e).slice(0,200));process.exit(1);});
